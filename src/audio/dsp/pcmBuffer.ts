/**
 * Decoupled multi-channel 32-bit float PCM buffer representation and
 * sample-accurate, non-destructive editing operations.
 */

export interface PcmAudioData {
  sampleRate: number;
  channels: Float32Array[];
}

export function clonePcm(data: PcmAudioData): PcmAudioData {
  return {
    sampleRate: data.sampleRate,
    channels: data.channels.map((ch) => new Float32Array(ch)),
  };
}

export function getFrameCount(data: PcmAudioData): number {
  return data.channels.length > 0 ? data.channels[0].length : 0;
}

export function getDurationSec(data: PcmAudioData): number {
  return data.sampleRate > 0 ? getFrameCount(data) / data.sampleRate : 0;
}

export function clampFrameRange(
  data: PcmAudioData,
  startSec: number,
  endSec: number
): { startFrame: number; endFrame: number } {
  const total = getFrameCount(data);
  const startFrame = Math.max(0, Math.min(total, Math.round(startSec * data.sampleRate)));
  const endFrame = Math.max(startFrame, Math.min(total, Math.round(endSec * data.sampleRate)));
  return { startFrame, endFrame };
}

export function slicePcm(data: PcmAudioData, startSec: number, endSec: number): PcmAudioData {
  const { startFrame, endFrame } = clampFrameRange(data, startSec, endSec);
  return {
    sampleRate: data.sampleRate,
    channels: data.channels.map((ch) => ch.slice(startFrame, endFrame)),
  };
}

export function deleteRangePcm(
  data: PcmAudioData,
  startSec: number,
  endSec: number
): { result: PcmAudioData; removed: PcmAudioData } {
  const { startFrame, endFrame } = clampFrameRange(data, startSec, endSec);
  const total = getFrameCount(data);
  const removed = slicePcm(data, startSec, endSec);
  const newLen = total - (endFrame - startFrame);
  const channels = data.channels.map((ch) => {
    const out = new Float32Array(newLen);
    out.set(ch.subarray(0, startFrame), 0);
    out.set(ch.subarray(endFrame), startFrame);
    return out;
  });
  return { result: { sampleRate: data.sampleRate, channels }, removed };
}

export function trimPcm(data: PcmAudioData, startSec: number, endSec: number): PcmAudioData {
  return slicePcm(data, startSec, endSec);
}

export function insertPcm(
  target: PcmAudioData,
  clipboard: PcmAudioData,
  atSec: number
): PcmAudioData {
  const clip =
    clipboard.sampleRate === target.sampleRate
      ? clipboard
      : resamplePcm(clipboard, target.sampleRate);
  const total = getFrameCount(target);
  const clipLen = getFrameCount(clip);
  const insertFrame = Math.max(0, Math.min(total, Math.round(atSec * target.sampleRate)));
  const outChannelsCount = Math.max(target.channels.length, clip.channels.length);
  const channels: Float32Array[] = [];

  for (let c = 0; c < outChannelsCount; c++) {
    const src = target.channels[c % target.channels.length];
    const ins = clip.channels[c % clip.channels.length];
    const out = new Float32Array(total + clipLen);
    out.set(src.subarray(0, insertFrame), 0);
    out.set(ins, insertFrame);
    out.set(src.subarray(insertFrame), insertFrame + clipLen);
    channels.push(out);
  }
  return { sampleRate: target.sampleRate, channels };
}

export function joinPcm(parts: PcmAudioData[]): PcmAudioData {
  if (parts.length === 0) {
    return { sampleRate: 48000, channels: [new Float32Array(0), new Float32Array(0)] };
  }
  const sampleRate = parts[0].sampleRate;
  const normalized = parts.map((p) => (p.sampleRate === sampleRate ? p : resamplePcm(p, sampleRate)));
  const maxCh = Math.max(...normalized.map((p) => p.channels.length));
  const totalFrames = normalized.reduce((acc, p) => acc + getFrameCount(p), 0);
  const channels: Float32Array[] = [];

  for (let c = 0; c < maxCh; c++) {
    const out = new Float32Array(totalFrames);
    let offset = 0;
    for (const p of normalized) {
      const ch = p.channels[c % p.channels.length];
      out.set(ch, offset);
      offset += ch.length;
    }
    channels.push(out);
  }
  return { sampleRate, channels };
}

export function splitPcm(
  data: PcmAudioData,
  splitSec: number
): [PcmAudioData, PcmAudioData] {
  const duration = getDurationSec(data);
  const clamped = Math.max(0, Math.min(duration, splitSec));
  return [slicePcm(data, 0, clamped), slicePcm(data, clamped, duration)];
}

export function silenceRangePcm(data: PcmAudioData, startSec: number, endSec: number): PcmAudioData {
  const out = clonePcm(data);
  const { startFrame, endFrame } = clampFrameRange(out, startSec, endSec);
  for (const ch of out.channels) {
    ch.fill(0, startFrame, endFrame);
  }
  return out;
}

export function applyGainPcm(
  data: PcmAudioData,
  gainDb: number,
  startSec?: number,
  endSec?: number
): PcmAudioData {
  const out = clonePcm(data);
  const linear = Math.pow(10, gainDb / 20);
  const { startFrame, endFrame } = clampFrameRange(
    out,
    startSec ?? 0,
    endSec ?? getDurationSec(out)
  );
  for (const ch of out.channels) {
    for (let i = startFrame; i < endFrame; i++) {
      ch[i] *= linear;
    }
  }
  return out;
}

export function normalizePcm(
  data: PcmAudioData,
  targetDb = -0.5,
  startSec?: number,
  endSec?: number
): PcmAudioData {
  const out = clonePcm(data);
  const { startFrame, endFrame } = clampFrameRange(
    out,
    startSec ?? 0,
    endSec ?? getDurationSec(out)
  );
  let maxAbs = 0;
  for (const ch of out.channels) {
    for (let i = startFrame; i < endFrame; i++) {
      const a = Math.abs(ch[i]);
      if (a > maxAbs) maxAbs = a;
    }
  }
  if (maxAbs < 1e-9) return out;
  const targetLinear = Math.pow(10, targetDb / 20);
  const gain = targetLinear / maxAbs;
  for (const ch of out.channels) {
    for (let i = startFrame; i < endFrame; i++) {
      ch[i] *= gain;
    }
  }
  return out;
}

export function invertPhasePcm(
  data: PcmAudioData,
  startSec?: number,
  endSec?: number
): PcmAudioData {
  const out = clonePcm(data);
  const { startFrame, endFrame } = clampFrameRange(
    out,
    startSec ?? 0,
    endSec ?? getDurationSec(out)
  );
  for (const ch of out.channels) {
    for (let i = startFrame; i < endFrame; i++) {
      ch[i] = -ch[i];
    }
  }
  return out;
}

export function reversePcm(
  data: PcmAudioData,
  startSec?: number,
  endSec?: number
): PcmAudioData {
  const out = clonePcm(data);
  const { startFrame, endFrame } = clampFrameRange(
    out,
    startSec ?? 0,
    endSec ?? getDurationSec(out)
  );
  for (const ch of out.channels) {
    let l = startFrame;
    let r = endFrame - 1;
    while (l < r) {
      const tmp = ch[l];
      ch[l] = ch[r];
      ch[r] = tmp;
      l++;
      r--;
    }
  }
  return out;
}

export function fadePcm(
  data: PcmAudioData,
  direction: 'in' | 'out',
  startSec: number,
  endSec: number,
  curve: 'linear' | 'equal-power' | 'exponential' = 'equal-power'
): PcmAudioData {
  const out = clonePcm(data);
  const { startFrame, endFrame } = clampFrameRange(out, startSec, endSec);
  const len = endFrame - startFrame;
  if (len <= 1) return out;

  for (const ch of out.channels) {
    for (let i = 0; i < len; i++) {
      const t = i / (len - 1);
      const u = direction === 'in' ? t : 1 - t;
      let gain = u;
      if (curve === 'equal-power') {
        gain = Math.sin(u * Math.PI * 0.5);
      } else if (curve === 'exponential') {
        gain = u * u;
      }
      ch[startFrame + i] *= gain;
    }
  }
  return out;
}

export function crossfadeJoinPcm(
  first: PcmAudioData,
  second: PcmAudioData,
  crossfadeSec: number
): PcmAudioData {
  const sr = first.sampleRate;
  const b = second.sampleRate === sr ? second : resamplePcm(second, sr);
  const lenA = getFrameCount(first);
  const lenB = getFrameCount(b);
  const xfadeFrames = Math.max(
    0,
    Math.min(lenA, lenB, Math.round(crossfadeSec * sr))
  );
  if (xfadeFrames === 0) return joinPcm([first, b]);

  const chCount = Math.max(first.channels.length, b.channels.length);
  const totalLen = lenA + lenB - xfadeFrames;
  const channels: Float32Array[] = [];

  for (let c = 0; c < chCount; c++) {
    const chA = first.channels[c % first.channels.length];
    const chB = b.channels[c % b.channels.length];
    const out = new Float32Array(totalLen);
    const xStart = lenA - xfadeFrames;
    out.set(chA.subarray(0, xStart), 0);
    for (let i = 0; i < xfadeFrames; i++) {
      const t = i / (xfadeFrames - 1 || 1);
      const gainA = Math.cos(t * Math.PI * 0.5);
      const gainB = Math.sin(t * Math.PI * 0.5);
      out[xStart + i] = chA[xStart + i] * gainA + chB[i] * gainB;
    }
    out.set(chB.subarray(xfadeFrames), lenA);
    channels.push(out);
  }
  return { sampleRate: sr, channels };
}

export function stripSilencePcm(
  data: PcmAudioData,
  thresholdDb = -45,
  minSilenceSec = 0.25,
  paddingSec = 0.03
): { result: PcmAudioData; removedSeconds: number } {
  const total = getFrameCount(data);
  if (total === 0) return { result: clonePcm(data), removedSeconds: 0 };

  const thresholdLin = Math.pow(10, thresholdDb / 20);
  const minSilentFrames = Math.max(1, Math.round(minSilenceSec * data.sampleRate));
  const padFrames = Math.round(paddingSec * data.sampleRate);
  const windowSize = Math.max(64, Math.round(0.01 * data.sampleRate));

  const keepMask = new Uint8Array(total);
  keepMask.fill(1);

  let runStart = -1;
  for (let i = 0; i < total; i += windowSize) {
    const end = Math.min(total, i + windowSize);
    let peak = 0;
    for (const ch of data.channels) {
      for (let j = i; j < end; j++) {
        const v = Math.abs(ch[j]);
        if (v > peak) peak = v;
      }
    }
    if (peak < thresholdLin) {
      if (runStart === -1) runStart = i;
    } else {
      if (runStart !== -1 && i - runStart >= minSilentFrames) {
        const cutStart = Math.min(total, runStart + padFrames);
        const cutEnd = Math.max(cutStart, i - padFrames);
        keepMask.fill(0, cutStart, cutEnd);
      }
      runStart = -1;
    }
  }
  if (runStart !== -1 && total - runStart >= minSilentFrames) {
    const cutStart = Math.min(total, runStart + padFrames);
    keepMask.fill(0, cutStart, total);
  }

  let keptCount = 0;
  for (let i = 0; i < total; i++) {
    if (keepMask[i] === 1) keptCount++;
  }

  const channels = data.channels.map((ch) => {
    const out = new Float32Array(keptCount);
    let w = 0;
    for (let i = 0; i < total; i++) {
      if (keepMask[i] === 1) {
        out[w++] = ch[i];
      }
    }
    return out;
  });

  return {
    result: { sampleRate: data.sampleRate, channels },
    removedSeconds: (total - keptCount) / data.sampleRate,
  };
}

export function detectPeaksPcm(
  data: PcmAudioData,
  thresholdDb = -3,
  minSpacingSec = 0.05
): Array<{ timeSec: number; db: number }> {
  const total = getFrameCount(data);
  const thr = Math.pow(10, thresholdDb / 20);
  const minGap = Math.max(1, Math.round(minSpacingSec * data.sampleRate));
  const peaks: Array<{ timeSec: number; db: number }> = [];
  let lastIdx = -minGap;

  for (let i = 0; i < total; i++) {
    let samplePeak = 0;
    for (const ch of data.channels) {
      const a = Math.abs(ch[i]);
      if (a > samplePeak) samplePeak = a;
    }
    if (samplePeak >= thr && i - lastIdx >= minGap) {
      // Find local maximum in small window
      let bestIdx = i;
      let bestVal = samplePeak;
      const look = Math.min(total, i + Math.round(0.01 * data.sampleRate));
      for (let j = i + 1; j < look; j++) {
        let p = 0;
        for (const ch of data.channels) {
          const a = Math.abs(ch[j]);
          if (a > p) p = a;
        }
        if (p > bestVal) {
          bestVal = p;
          bestIdx = j;
        }
      }
      peaks.push({
        timeSec: bestIdx / data.sampleRate,
        db: 20 * Math.log10(Math.max(bestVal, 1e-12)),
      });
      lastIdx = bestIdx;
      i = bestIdx + minGap - 1;
    }
  }
  return peaks;
}

/**
 * Linear/cubic Hermite resampling for sample rate conversion and speed/pitch varispeed.
 */
export function resamplePcm(data: PcmAudioData, targetSampleRate: number): PcmAudioData {
  if (data.sampleRate === targetSampleRate) return clonePcm(data);
  const ratio = data.sampleRate / targetSampleRate;
  const srcLen = getFrameCount(data);
  const dstLen = Math.max(1, Math.round(srcLen / ratio));
  const channels = data.channels.map((src) => {
    const dst = new Float32Array(dstLen);
    for (let i = 0; i < dstLen; i++) {
      const pos = i * ratio;
      const idx = Math.floor(pos);
      const frac = pos - idx;
      const xm1 = src[Math.max(0, idx - 1)] ?? 0;
      const x0 = src[Math.min(srcLen - 1, idx)] ?? 0;
      const x1 = src[Math.min(srcLen - 1, idx + 1)] ?? 0;
      const x2 = src[Math.min(srcLen - 1, idx + 2)] ?? 0;
      const c = (x1 - xm1) * 0.5;
      const v = x0 - x1;
      const w = c + v;
      const a = w + v + (x2 - x0) * 0.5;
      const bNeg = w + a;
      dst[i] = ((a * frac - bNeg) * frac + c) * frac + x0;
    }
    return dst;
  });
  return { sampleRate: targetSampleRate, channels };
}

/**
 * Change playback speed (affects both duration and pitch) or
 * WSOLA time-stretch (changes duration/tempo while preserving pitch).
 */
export function changeSpeedPcm(data: PcmAudioData, speedFactor: number): PcmAudioData {
  const factor = Math.max(0.25, Math.min(4.0, speedFactor));
  if (Math.abs(factor - 1) < 1e-5) return clonePcm(data);
  const fakeRate = Math.round(data.sampleRate * factor);
  const resampled = resamplePcm({ sampleRate: fakeRate, channels: data.channels }, data.sampleRate);
  return { sampleRate: data.sampleRate, channels: resampled.channels };
}

/**
 * WSOLA (Waveform Similarity Overlap-Add) time-stretch preserving pitch.
 * tempoFactor > 1 speeds up (shorter duration); < 1 slows down (longer duration).
 */
export function timeStretchPcm(data: PcmAudioData, tempoFactor: number): PcmAudioData {
  const factor = Math.max(0.4, Math.min(2.5, tempoFactor));
  if (Math.abs(factor - 1) < 1e-4) return clonePcm(data);

  const srcLen = getFrameCount(data);
  const winSize = Math.round(0.04 * data.sampleRate); // 40ms window
  const synHop = Math.round(winSize * 0.5);
  const anaHop = Math.max(1, Math.round(synHop * factor));
  const searchRadius = Math.round(0.012 * data.sampleRate);
  const outLen = Math.max(winSize, Math.round(srcLen / factor));

  if (srcLen < winSize * 2) {
    return changeSpeedPcm(data, factor);
  }

  // Hann window
  const hann = new Float32Array(winSize);
  for (let i = 0; i < winSize; i++) {
    hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (winSize - 1)));
  }

  const chCount = data.channels.length;
  const outChannels = data.channels.map(() => new Float32Array(outLen));
  const norm = new Float32Array(outLen);

  let inPos = 0;
  let outPos = 0;

  while (outPos + winSize <= outLen && inPos + winSize <= srcLen) {
    let bestInPos = inPos;
    if (outPos > 0) {
      // Find best cross-correlation alignment in channel 0
      const refCh = outChannels[0];
      const srcCh = data.channels[0];
      const overlap = synHop;
      let bestScore = -Infinity;
      const minCand = Math.max(0, inPos - searchRadius);
      const maxCand = Math.min(srcLen - winSize, inPos + searchRadius);

      for (let cand = minCand; cand <= maxCand; cand += 4) {
        let dot = 0;
        for (let k = 0; k < overlap; k += 2) {
          dot += refCh[outPos + k] * srcCh[cand + k];
        }
        if (dot > bestScore) {
          bestScore = dot;
          bestInPos = cand;
        }
      }
    }

    for (let c = 0; c < chCount; c++) {
      const src = data.channels[c];
      const dst = outChannels[c];
      for (let i = 0; i < winSize; i++) {
        dst[outPos + i] += src[bestInPos + i] * hann[i];
      }
    }
    for (let i = 0; i < winSize; i++) {
      norm[outPos + i] += hann[i];
    }

    inPos += anaHop;
    outPos += synHop;
  }

  for (let c = 0; c < chCount; c++) {
    const dst = outChannels[c];
    for (let i = 0; i < outLen; i++) {
      if (norm[i] > 1e-4) dst[i] /= norm[i];
    }
  }

  return { sampleRate: data.sampleRate, channels: outChannels };
}

/**
 * Pitch shift in semitones while preserving original duration (resample + WSOLA).
 */
export function pitchShiftPcm(data: PcmAudioData, semitones: number): PcmAudioData {
  if (Math.abs(semitones) < 1e-3) return clonePcm(data);
  const pitchRatio = Math.pow(2, semitones / 12);
  // Step 1: time-stretch by 1 / pitchRatio so after varispeed duration matches original
  const stretched = timeStretchPcm(data, 1 / pitchRatio);
  // Step 2: varispeed by pitchRatio
  return changeSpeedPcm(stretched, pitchRatio);
}

/**
 * Encode PcmAudioData directly to a 32-bit float or 16/24-bit PCM WAV Buffer (useful for IPC / FFmpeg / tests).
 */
export function encodeWavBytes(data: PcmAudioData, bitDepth: 16 | 24 | 32 = 32): Uint8Array {
  const numChannels = data.channels.length;
  const numFrames = getFrameCount(data);
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = numFrames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, bitDepth === 32 ? 3 : 1, true); // IEEE float for 32-bit, PCM for 16/24
  view.setUint16(22, numChannels, true);
  view.setUint32(24, data.sampleRate, true);
  view.setUint32(28, data.sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = data.channels[c][i];
      if (bitDepth === 32) {
        view.setFloat32(offset, sample, true);
      } else if (bitDepth === 16) {
        const clamped = Math.max(-1, Math.min(1, sample));
        view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
      } else {
        const clamped = Math.max(-1, Math.min(1, sample));
        const val = Math.round(clamped < 0 ? clamped * 0x800000 : clamped * 0x7fffff);
        view.setUint8(offset, val & 0xff);
        view.setUint8(offset + 1, (val >> 8) & 0xff);
        view.setUint8(offset + 2, (val >> 16) & 0xff);
      }
      offset += bytesPerSample;
    }
  }
  return new Uint8Array(buffer);
}

export function decodeWavBytes(bytes: Uint8Array): PcmAudioData {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 44) throw new Error('Invalid WAV header');

  const readStr = (o: number, n: number) => {
    let s = '';
    for (let i = 0; i < n; i++) s += String.fromCharCode(view.getUint8(o + i));
    return s;
  };
  if (readStr(0, 4) !== 'RIFF' || readStr(8, 4) !== 'WAVE') {
    throw new Error('Not a RIFF/WAVE file');
  }

  let offset = 12;
  let audioFormat = 1;
  let numChannels = 2;
  let sampleRate = 48000;
  let bitDepth = 16;
  let dataOffset = 0;
  let dataSize = 0;

  while (offset + 8 <= bytes.byteLength) {
    const chunkId = readStr(offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    if (chunkId === 'fmt ') {
      audioFormat = view.getUint16(offset + 8, true);
      numChannels = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
      bitDepth = view.getUint16(offset + 22, true);
      if (audioFormat === 0xfffe && chunkSize >= 40) {
        audioFormat = view.getUint16(offset + 32, true);
      }
    } else if (chunkId === 'data') {
      dataOffset = offset + 8;
      dataSize = Math.min(chunkSize, bytes.byteLength - dataOffset);
      break;
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }

  if (!dataOffset) throw new Error('WAV data chunk not found');

  const bytesPerSample = bitDepth / 8;
  const numFrames = Math.floor(dataSize / (numChannels * bytesPerSample));
  const channels = Array.from({ length: numChannels }, () => new Float32Array(numFrames));

  let pos = dataOffset;
  for (let i = 0; i < numFrames; i++) {
    for (let c = 0; c < numChannels; c++) {
      let val = 0;
      if (audioFormat === 3 && bitDepth === 32) {
        val = view.getFloat32(pos, true);
      } else if (bitDepth === 16) {
        val = view.getInt16(pos, true) / 32768;
      } else if (bitDepth === 24) {
        const b0 = view.getUint8(pos);
        const b1 = view.getUint8(pos + 1);
        const b2 = view.getUint8(pos + 2);
        let raw = b0 | (b1 << 8) | (b2 << 16);
        if (raw & 0x800000) raw |= ~0xffffff;
        val = raw / 8388608;
      } else if (bitDepth === 32) {
        val = view.getInt32(pos, true) / 2147483648;
      } else if (bitDepth === 8) {
        val = (view.getUint8(pos) - 128) / 128;
      }
      channels[c][i] = val;
      pos += bytesPerSample;
    }
  }

  return { sampleRate, channels };
}
