import { RestorationOptions, SpectralSelection } from '../../shared/types';
import { computeBiquad, processBiquadChannel } from './biquad';
import { PcmAudioData, clonePcm, getFrameCount } from './pcmBuffer';

/**
 * In-place Radix-2 Cooley-Tukey FFT.
 * `re` and `im` must have power-of-2 length.
 */
export function fft(re: Float32Array, im: Float32Array, inverse = false): void {
  const n = re.length;
  if (n <= 1) return;

  // Bit-reversal permutation
  let j = 0;
  for (let i = 0; i < n; i++) {
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
    let m = n >> 1;
    while (m >= 1 && j >= m) {
      j -= m;
      m >>= 1;
    }
    j += m;
  }

  const sign = inverse ? 1 : -1;
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const theta = (sign * 2 * Math.PI) / size;
    const wStepRe = Math.cos(theta);
    const wStepIm = Math.sin(theta);

    for (let i = 0; i < n; i += size) {
      let wRe = 1;
      let wIm = 0;
      for (let k = 0; k < half; k++) {
        const evenIdx = i + k;
        const oddIdx = evenIdx + half;
        const tRe = wRe * re[oddIdx] - wIm * im[oddIdx];
        const tIm = wRe * im[oddIdx] + wIm * re[oddIdx];

        re[oddIdx] = re[evenIdx] - tRe;
        im[oddIdx] = im[evenIdx] - tIm;
        re[evenIdx] += tRe;
        im[evenIdx] += tIm;

        const nextWRe = wRe * wStepRe - wIm * wStepIm;
        wIm = wRe * wStepIm + wIm * wStepRe;
        wRe = nextWRe;
      }
    }
  }

  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

export interface SpectrogramData {
  width: number;
  height: number;
  durationSec: number;
  sampleRate: number;
  minFreqHz: number;
  maxFreqHz: number;
  magnitudesDb: Float32Array; // row-major [timeCol * height + freqRow]
}

/**
 * Generates a logarithmic-frequency spectrogram for Mode 3 (Spectral Editor).
 */
export function computeSpectrogram(
  data: PcmAudioData,
  fftSize = 2048,
  targetCols = 600,
  targetRows = 256
): SpectrogramData {
  const frames = getFrameCount(data);
  const sr = data.sampleRate;
  const minFreqHz = 20;
  const maxFreqHz = Math.min(20000, sr * 0.49);

  if (frames === 0 || data.channels.length === 0) {
    return {
      width: 1,
      height: targetRows,
      durationSec: 0,
      sampleRate: sr,
      minFreqHz,
      maxFreqHz,
      magnitudesDb: new Float32Array(targetRows).fill(-100),
    };
  }

  // Mono mixdown for spectral display
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (const ch of data.channels) s += ch[i];
    mono[i] = s / data.channels.length;
  }

  const cols = Math.max(16, Math.min(targetCols, Math.max(16, Math.floor(frames / 128))));
  const hop = Math.max(1, Math.floor(Math.max(1, frames - fftSize) / cols));
  const hann = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
  }

  const re = new Float32Array(fftSize);
  const im = new Float32Array(fftSize);
  const halfBins = fftSize / 2;
  const magnitudesDb = new Float32Array(cols * targetRows);

  // Precompute log-frequency bin mapping
  const rowToBin = new Float32Array(targetRows);
  const logMin = Math.log10(minFreqHz);
  const logMax = Math.log10(maxFreqHz);
  for (let r = 0; r < targetRows; r++) {
    const frac = r / (targetRows - 1);
    const freq = Math.pow(10, logMin + frac * (logMax - logMin));
    rowToBin[r] = Math.min(halfBins - 1.001, Math.max(0, (freq * fftSize) / sr));
  }

  for (let col = 0; col < cols; col++) {
    const start = Math.min(Math.max(0, frames - fftSize), col * hop);
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < fftSize && start + i < frames; i++) {
      re[i] = mono[start + i] * hann[i];
    }
    fft(re, im, false);

    for (let r = 0; r < targetRows; r++) {
      const binPos = rowToBin[r];
      const b0 = Math.floor(binPos);
      const b1 = Math.min(halfBins - 1, b0 + 1);
      const frac = binPos - b0;
      const m0 = Math.hypot(re[b0], im[b0]);
      const m1 = Math.hypot(re[b1], im[b1]);
      const mag = (m0 * (1 - frac) + m1 * frac) / (fftSize * 0.25);
      magnitudesDb[col * targetRows + r] = Math.max(-100, 20 * Math.log10(Math.max(1e-6, mag)));
    }
  }

  return {
    width: cols,
    height: targetRows,
    durationSec: frames / sr,
    sampleRate: sr,
    minFreqHz,
    maxFreqHz,
    magnitudesDb,
  };
}

/**
 * Attenuate or clean a specific 2D time + frequency selection in the Spectral Editor (Mode 3).
 */
export function attenuateSpectralRegion(
  data: PcmAudioData,
  selection: SpectralSelection,
  attenuationDb = -36
): PcmAudioData {
  const out = clonePcm(data);
  const sr = out.sampleRate;
  const frames = getFrameCount(out);
  const fftSize = 2048;
  const hop = fftSize / 4;

  const startFrame = Math.max(0, Math.round(selection.startSec * sr));
  const endFrame = Math.min(frames, Math.round(selection.endSec * sr));
  if (endFrame <= startFrame) return out;

  const lowBin = Math.max(1, Math.floor((selection.lowHz * fftSize) / sr));
  const highBin = Math.min(fftSize / 2 - 1, Math.ceil((selection.highHz * fftSize) / sr));
  const attenGain = Math.pow(10, attenuationDb / 20);

  const hann = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
  }

  for (let c = 0; c < out.channels.length; c++) {
    const src = data.channels[c];
    const dst = new Float32Array(frames);
    const norm = new Float32Array(frames);
    const re = new Float32Array(fftSize);
    const im = new Float32Array(fftSize);

    for (let pos = 0; pos < frames; pos += hop) {
      re.fill(0);
      im.fill(0);
      for (let i = 0; i < fftSize && pos + i < frames; i++) {
        re[i] = src[pos + i] * hann[i];
      }
      const centerFrame = pos + fftSize / 2;
      const inTime = centerFrame >= startFrame && centerFrame <= endFrame;

      if (inTime) {
        fft(re, im, false);
        for (let b = lowBin; b <= highBin; b++) {
          re[b] *= attenGain;
          im[b] *= attenGain;
          const mirror = fftSize - b;
          if (mirror < fftSize) {
            re[mirror] *= attenGain;
            im[mirror] *= attenGain;
          }
        }
        fft(re, im, true);
      } else {
        for (let i = 0; i < fftSize && pos + i < frames; i++) {
          re[i] = src[pos + i] * hann[i];
        }
      }

      for (let i = 0; i < fftSize && pos + i < frames; i++) {
        dst[pos + i] += re[i] * hann[i];
        norm[pos + i] += hann[i] * hann[i];
      }
    }

    for (let i = 0; i < frames; i++) {
      out.channels[c][i] = norm[i] > 1e-6 ? dst[i] / norm[i] : src[i];
    }
  }
  return out;
}

/**
 * Spectral noise subtraction using estimated lowest-energy frames as noise print.
 */
export function applySpectralNoiseReduction(
  data: PcmAudioData,
  amount = 0.5
): PcmAudioData {
  if (amount <= 0.01) return data;
  const out = clonePcm(data);
  const frames = getFrameCount(out);
  const fftSize = 1024;
  const hop = fftSize / 4;
  if (frames < fftSize) return out;

  const hann = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
  }

  for (let c = 0; c < out.channels.length; c++) {
    const src = data.channels[c];
    const halfBins = fftSize / 2 + 1;

    // Step 1: Collect frame energies to estimate noise floor automatically
    const frameMags: Float32Array[] = [];
    const frameEnergies: Array<{ idx: number; energy: number }> = [];
    const re = new Float32Array(fftSize);
    const im = new Float32Array(fftSize);

    for (let pos = 0, fIdx = 0; pos + fftSize <= frames; pos += hop, fIdx++) {
      re.fill(0);
      im.fill(0);
      let energy = 0;
      for (let i = 0; i < fftSize; i++) {
        const s = src[pos + i] * hann[i];
        re[i] = s;
        energy += s * s;
      }
      fft(re, im, false);
      const mags = new Float32Array(halfBins);
      for (let b = 0; b < halfBins; b++) {
        mags[b] = Math.hypot(re[b], im[b]);
      }
      frameMags.push(mags);
      frameEnergies.push({ idx: fIdx, energy });
    }

    if (frameEnergies.length === 0) continue;
    const sorted = [...frameEnergies].sort((a, b) => a.energy - b.energy);
    const quietCount = Math.max(1, Math.floor(sorted.length * 0.12));
    const noiseProfile = new Float32Array(halfBins);
    for (let k = 0; k < quietCount; k++) {
      const m = frameMags[sorted[k].idx];
      for (let b = 0; b < halfBins; b++) noiseProfile[b] += m[b];
    }
    for (let b = 0; b < halfBins; b++) noiseProfile[b] /= quietCount;

    // Step 2: Wiener-style spectral gain suppression
    const dst = new Float32Array(frames);
    const norm = new Float32Array(frames);
    const overSub = 1.0 + amount * 2.2;
    const spectralFloor = 0.08 + (1 - amount) * 0.25;

    for (let pos = 0; pos + fftSize <= frames; pos += hop) {
      re.fill(0);
      im.fill(0);
      for (let i = 0; i < fftSize; i++) re[i] = src[pos + i] * hann[i];
      fft(re, im, false);

      for (let b = 0; b < halfBins; b++) {
        const mag = Math.hypot(re[b], im[b]);
        const noise = noiseProfile[b] * overSub;
        const gain = mag > 1e-9 ? Math.max(spectralFloor, (mag - noise) / mag) : spectralFloor;
        re[b] *= gain;
        im[b] *= gain;
        if (b > 0 && b < fftSize / 2) {
          re[fftSize - b] *= gain;
          im[fftSize - b] *= gain;
        }
      }

      fft(re, im, true);
      for (let i = 0; i < fftSize; i++) {
        dst[pos + i] += re[i] * hann[i];
        norm[pos + i] += hann[i] * hann[i];
      }
    }

    for (let i = 0; i < frames; i++) {
      out.channels[c][i] = norm[i] > 1e-6 ? dst[i] / norm[i] : src[i];
    }
  }
  return out;
}

/**
 * Notch out 50Hz or 60Hz mains hum and harmonics.
 */
export function applyHumRemoval(
  data: PcmAudioData,
  baseHz: 50 | 60,
  harmonics = 3
): PcmAudioData {
  const out = clonePcm(data);
  for (let h = 1; h <= harmonics; h++) {
    const freq = baseHz * h;
    if (freq >= out.sampleRate * 0.45) break;
    const notch = computeBiquad('notch', out.sampleRate, freq, 0, 6);
    for (const ch of out.channels) processBiquadChannel(ch, notch);
  }
  return out;
}

/**
 * Click / crackle repair via local second-difference transient outlier detection and cubic interpolation.
 */
export function applyDeClick(data: PcmAudioData, amount = 0.5): PcmAudioData {
  if (amount <= 0.01) return data;
  const out = clonePcm(data);
  const thresholdMul = 8 - amount * 4.5; // higher amount = more sensitive

  for (const ch of out.channels) {
    const win = 32;
    for (let i = win; i < ch.length - win; i++) {
      let localAbsMean = 0;
      for (let k = i - 16; k < i + 16; k++) {
        if (k !== i) localAbsMean += Math.abs(ch[k]);
      }
      localAbsMean = Math.max(1e-4, localAbsMean / 31);
      const secondDiff = Math.abs(ch[i] - 0.5 * (ch[i - 1] + ch[i + 1]));
      if (secondDiff > localAbsMean * thresholdMul && Math.abs(ch[i]) > 0.08) {
        ch[i] = 0.5 * (ch[i - 1] + ch[i + 1]);
      }
    }
  }
  return out;
}

/**
 * Full restoration pipeline combining de-hum, de-pop, de-click, spectral noise reduction,
 * de-reverb transient tightening, breath softening, and voice clarity boost.
 */
export function applyRestorationPipeline(
  data: PcmAudioData,
  opts: RestorationOptions
): PcmAudioData {
  let out = clonePcm(data);

  // 1. De-pop / rumble subsonic high-pass
  if (opts.dePopAmount > 0.02) {
    const cutoff = 55 + opts.dePopAmount * 45;
    const hp = computeBiquad('highpass', out.sampleRate, cutoff, 0, 0.707);
    for (const ch of out.channels) processBiquadChannel(ch, hp);
  }

  // 2. 50Hz / 60Hz hum removal
  if (opts.humFreqHz === 50 || opts.humFreqHz === 60) {
    out = applyHumRemoval(out, opts.humFreqHz, opts.humHarmonics);
  }

  // 3. De-click
  if (opts.deClickAmount > 0.02) {
    out = applyDeClick(out, opts.deClickAmount);
  }

  // 4. Spectral noise reduction
  if (opts.noiseReductionAmount > 0.02) {
    out = applySpectralNoiseReduction(out, opts.noiseReductionAmount);
  }

  // 5. De-reverb (dynamic decay tail attenuation based on short-term vs long-term envelope)
  if (opts.deReverbAmount > 0.02) {
    const sr = out.sampleRate;
    const fastCoef = Math.exp(-1 / (0.008 * sr));
    const slowCoef = Math.exp(-1 / (0.16 * sr));
    const frames = getFrameCount(out);
    let fastEnv = 0;
    let slowEnv = 0;
    for (let i = 0; i < frames; i++) {
      let peak = 0;
      for (const ch of out.channels) {
        const a = Math.abs(ch[i]);
        if (a > peak) peak = a;
      }
      fastEnv = fastCoef * fastEnv + (1 - fastCoef) * peak;
      slowEnv = slowCoef * slowEnv + (1 - slowCoef) * peak;
      if (slowEnv > fastEnv * 1.35 && slowEnv > 1e-4) {
        const tailRatio = fastEnv / slowEnv;
        const gain = Math.max(1 - opts.deReverbAmount * 0.75, tailRatio);
        for (const ch of out.channels) ch[i] *= gain;
      }
    }
  }

  // 6. Breath softening (attenuates quiet high-frequency unvoiced inhalations between -45dB and -26dB)
  if (opts.breathReductionAmount > 0.02) {
    const sr = out.sampleRate;
    const frames = getFrameCount(out);
    let env = 0;
    const coef = Math.exp(-1 / (0.025 * sr));
    for (let i = 0; i < frames; i++) {
      let p = 0;
      for (const ch of out.channels) p = Math.max(p, Math.abs(ch[i]));
      env = coef * env + (1 - coef) * p;
      const db = 20 * Math.log10(Math.max(env, 1e-6));
      if (db < -28 && db > -52) {
        const atten = 1 - opts.breathReductionAmount * 0.65;
        for (const ch of out.channels) ch[i] *= atten;
      }
    }
  }

  // 7. Speech intelligibility / clarity boost (2.8 kHz presence + 9 kHz air)
  if (opts.clarityAmount > 0.02) {
    const pres = computeBiquad('peaking', out.sampleRate, 2800, opts.clarityAmount * 4.5, 1.2);
    const mud = computeBiquad('peaking', out.sampleRate, 320, -opts.clarityAmount * 2.5, 1.4);
    for (const ch of out.channels) {
      processBiquadChannel(ch, mud);
      processBiquadChannel(ch, pres);
    }
  }

  return out;
}
