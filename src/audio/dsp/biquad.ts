import {
  EqBand,
  EqFilterType,
  GraphicEqSettings,
  ParametricEqSettings,
} from '../../shared/types';
import { GRAPHIC_EQ_FREQS } from '../../shared/presets';
import { PcmAudioData, clonePcm } from './pcmBuffer';

export interface BiquadCoefficients {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

export function computeBiquad(
  type: EqFilterType,
  sampleRate: number,
  frequency: number,
  gainDb: number,
  q: number
): BiquadCoefficients {
  const f = Math.max(10, Math.min(sampleRate * 0.48, frequency));
  const w0 = (2 * Math.PI * f) / sampleRate;
  const cosW0 = Math.cos(w0);
  const sinW0 = Math.sin(w0);
  const safeQ = Math.max(0.1, Math.min(25, q));
  const alpha = sinW0 / (2 * safeQ);
  const A = Math.pow(10, gainDb / 40);

  let b0 = 1,
    b1 = 0,
    b2 = 0,
    a0 = 1,
    a1 = 0,
    a2 = 0;

  switch (type) {
    case 'lowpass':
      b0 = (1 - cosW0) / 2;
      b1 = 1 - cosW0;
      b2 = (1 - cosW0) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cosW0;
      a2 = 1 - alpha;
      break;
    case 'highpass':
      b0 = (1 + cosW0) / 2;
      b1 = -(1 + cosW0);
      b2 = (1 + cosW0) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cosW0;
      a2 = 1 - alpha;
      break;
    case 'notch':
      b0 = 1;
      b1 = -2 * cosW0;
      b2 = 1;
      a0 = 1 + alpha;
      a1 = -2 * cosW0;
      a2 = 1 - alpha;
      break;
    case 'peaking':
      b0 = 1 + alpha * A;
      b1 = -2 * cosW0;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cosW0;
      a2 = 1 - alpha / A;
      break;
    case 'lowshelf': {
      const twoSqrtAAlpha = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 - (A - 1) * cosW0 + twoSqrtAAlpha);
      b1 = 2 * A * (A - 1 - (A + 1) * cosW0);
      b2 = A * (A + 1 - (A - 1) * cosW0 - twoSqrtAAlpha);
      a0 = A + 1 + (A - 1) * cosW0 + twoSqrtAAlpha;
      a1 = -2 * (A - 1 + (A + 1) * cosW0);
      a2 = A + 1 + (A - 1) * cosW0 - twoSqrtAAlpha;
      break;
    }
    case 'highshelf': {
      const twoSqrtAAlpha = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 + (A - 1) * cosW0 + twoSqrtAAlpha);
      b1 = -2 * A * (A - 1 + (A + 1) * cosW0);
      b2 = A * (A + 1 + (A - 1) * cosW0 - twoSqrtAAlpha);
      a0 = A + 1 - (A - 1) * cosW0 + twoSqrtAAlpha;
      a1 = 2 * (A - 1 - (A + 1) * cosW0);
      a2 = A + 1 - (A - 1) * cosW0 - twoSqrtAAlpha;
      break;
    }
  }

  return {
    b0: b0 / a0,
    b1: b1 / a0,
    b2: b2 / a0,
    a1: a1 / a0,
    a2: a2 / a0,
  };
}

export function processBiquadChannel(ch: Float32Array, c: BiquadCoefficients): void {
  let z1 = 0;
  let z2 = 0;
  for (let i = 0; i < ch.length; i++) {
    const x = ch[i];
    const y = c.b0 * x + z1;
    z1 = c.b1 * x - c.a1 * y + z2;
    z2 = c.b2 * x - c.a2 * y;
    ch[i] = y;
  }
}

export function biquadMagnitudeDb(
  c: BiquadCoefficients,
  freqHz: number,
  sampleRate: number
): number {
  const w = (2 * Math.PI * freqHz) / sampleRate;
  const cosW = Math.cos(w);
  const sinW = Math.sin(w);
  const cos2W = Math.cos(2 * w);
  const sin2W = Math.sin(2 * w);

  const numRe = c.b0 + c.b1 * cosW + c.b2 * cos2W;
  const numIm = -c.b1 * sinW - c.b2 * sin2W;
  const denRe = 1 + c.a1 * cosW + c.a2 * cos2W;
  const denIm = -c.a1 * sinW - c.a2 * sin2W;

  const numMagSq = numRe * numRe + numIm * numIm;
  const denMagSq = denRe * denRe + denIm * denIm;
  const mag = Math.sqrt(numMagSq / Math.max(1e-18, denMagSq));
  return 20 * Math.log10(Math.max(1e-6, mag));
}

export function evaluateEqResponseCurve(
  parametric: ParametricEqSettings,
  graphic: GraphicEqSettings,
  sampleRate: number,
  frequencies: number[]
): number[] {
  const coeffs: BiquadCoefficients[] = [];
  if (parametric.enabled) {
    for (const band of parametric.bands.slice(0, parametric.bandCount)) {
      if (!band.enabled) continue;
      if ((band.type === 'peaking' || band.type === 'lowshelf' || band.type === 'highshelf') && Math.abs(band.gainDb) < 0.01) {
        continue;
      }
      coeffs.push(computeBiquad(band.type, sampleRate, band.frequency, band.gainDb, band.q));
    }
  }
  if (graphic.enabled) {
    for (let i = 0; i < GRAPHIC_EQ_FREQS.length; i++) {
      const gain = graphic.bandsDb[i] ?? 0;
      if (Math.abs(gain) < 0.05) continue;
      coeffs.push(computeBiquad('peaking', sampleRate, GRAPHIC_EQ_FREQS[i], gain, 1.41));
    }
  }

  return frequencies.map((f) => {
    let totalDb = 0;
    for (const c of coeffs) {
      totalDb += biquadMagnitudeDb(c, f, sampleRate);
    }
    return totalDb;
  });
}

export function applyGraphicEqPcm(data: PcmAudioData, eq: GraphicEqSettings): PcmAudioData {
  if (!eq.enabled) return data;
  const out = clonePcm(data);
  for (let i = 0; i < GRAPHIC_EQ_FREQS.length; i++) {
    const gain = eq.bandsDb[i] ?? 0;
    if (Math.abs(gain) < 0.05) continue;
    const c = computeBiquad('peaking', out.sampleRate, GRAPHIC_EQ_FREQS[i], gain, 1.41);
    for (const ch of out.channels) processBiquadChannel(ch, c);
  }
  return out;
}

export function applyParametricEqPcm(data: PcmAudioData, eq: ParametricEqSettings): PcmAudioData {
  if (!eq.enabled) return data;
  const out = clonePcm(data);
  const bands: EqBand[] = eq.bands.slice(0, eq.bandCount);
  for (const band of bands) {
    if (!band.enabled) continue;
    if ((band.type === 'peaking' || band.type === 'lowshelf' || band.type === 'highshelf') && Math.abs(band.gainDb) < 0.05) {
      continue;
    }
    const c = computeBiquad(band.type, out.sampleRate, band.frequency, band.gainDb, band.q);
    for (const ch of out.channels) processBiquadChannel(ch, c);
  }
  return out;
}
