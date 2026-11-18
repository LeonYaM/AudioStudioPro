import { MeteringSnapshot } from '../../shared/types';
import { PcmAudioData, getFrameCount } from './pcmBuffer';

export function linearToDb(linear: number): number {
  if (linear <= 1e-12) return -120;
  return 20 * Math.log10(linear);
}

export function dbToLinear(db: number): number {
  if (db <= -120) return 0;
  return Math.pow(10, db / 20);
}

/**
 * ITU-R BS.1770-4 K-weighting biquad coefficients for arbitrary sample rates.
 * Stage 1: Pre-filter high shelf (+4 dB around 1681 Hz)
 * Stage 2: RLB high-pass filter (~38 Hz)
 */
interface BiquadCoeffs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

function getKWeightingFilters(sampleRate: number): [BiquadCoeffs, BiquadCoeffs] {
  // Stage 1: High shelf (+4 dB)
  const db = 3.999843853973347;
  const f0 = 1681.974450955533;
  const Q = 0.7071752369554196;
  const K1 = Math.tan((Math.PI * f0) / sampleRate);
  const Vh = Math.pow(10, db / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  const a0_1 = 1 + K1 / Q + K1 * K1;
  const shelf: BiquadCoeffs = {
    b0: (Vh + (Vb * K1) / Q + K1 * K1) / a0_1,
    b1: (2 * (K1 * K1 - Vh)) / a0_1,
    b2: (Vh - (Vb * K1) / Q + K1 * K1) / a0_1,
    a1: (2 * (K1 * K1 - 1)) / a0_1,
    a2: (1 - K1 / Q + K1 * K1) / a0_1,
  };

  // Stage 2: High-pass RLB
  const f0_hp = 38.13547087602444;
  const Q_hp = 0.5003270373238773;
  const K2 = Math.tan((Math.PI * f0_hp) / sampleRate);
  const a0_2 = 1 + K2 / Q_hp + K2 * K2;
  const hp: BiquadCoeffs = {
    b0: 1 / a0_2,
    b1: -2 / a0_2,
    b2: 1 / a0_2,
    a1: (2 * (K2 * K2 - 1)) / a0_2,
    a2: (1 - K2 / Q_hp + K2 * K2) / a0_2,
  };

  return [shelf, hp];
}

function applyBiquadInPlace(buf: Float32Array, c: BiquadCoeffs): void {
  let z1 = 0;
  let z2 = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i];
    const y = c.b0 * x + z1;
    z1 = c.b1 * x - c.a1 * y + z2;
    z2 = c.b2 * x - c.a2 * y;
    buf[i] = y;
  }
}

/**
 * Computes True Peak via 4x cubic Hermite oversampling, Sample Peak, RMS,
 * Phase Correlation, and ITU-R BS.1770-4 Integrated/Short-Term/Momentary LUFS.
 */
export function analyzeMetering(data: PcmAudioData): MeteringSnapshot {
  const frames = getFrameCount(data);
  if (frames === 0 || data.channels.length === 0) {
    return {
      peakLeftDb: -120,
      peakRightDb: -120,
      rmsLeftDb: -120,
      rmsRightDb: -120,
      momentaryLufs: -120,
      shortTermLufs: -120,
      integratedLufs: -120,
      truePeakDb: -120,
      clipping: false,
      phaseCorrelation: 1,
    };
  }

  const left = data.channels[0];
  const right = data.channels.length > 1 ? data.channels[1] : data.channels[0];

  let peakL = 0;
  let peakR = 0;
  let sumSqL = 0;
  let sumSqR = 0;
  let truePeak = 0;
  let clipping = false;
  let corrNum = 0;
  let corrDenL = 0;
  let corrDenR = 0;

  for (let i = 0; i < frames; i++) {
    const l = left[i];
    const r = right[i];
    const al = Math.abs(l);
    const ar = Math.abs(r);
    if (al > peakL) peakL = al;
    if (ar > peakR) peakR = ar;
    if (al >= 1.0 || ar >= 1.0) clipping = true;

    sumSqL += l * l;
    sumSqR += r * r;
    corrNum += l * r;
    corrDenL += l * l;
    corrDenR += r * r;

    // 4x cubic interpolation oversampling for True Peak estimation
    if (i > 0 && i < frames - 2) {
      for (const ch of [left, right]) {
        const xm1 = ch[i - 1];
        const x0 = ch[i];
        const x1 = ch[i + 1];
        const x2 = ch[i + 2];
        const c = (x1 - xm1) * 0.5;
        const v = x0 - x1;
        const w = c + v;
        const a = w + v + (x2 - x0) * 0.5;
        const bNeg = w + a;
        for (const t of [0.25, 0.5, 0.75]) {
          const interp = Math.abs(((a * t - bNeg) * t + c) * t + x0);
          if (interp > truePeak) truePeak = interp;
        }
      }
    }
  }
  truePeak = Math.max(truePeak, peakL, peakR);

  const rmsL = Math.sqrt(sumSqL / frames);
  const rmsR = Math.sqrt(sumSqR / frames);
  const denom = Math.sqrt(corrDenL * corrDenR);
  const phaseCorrelation = denom > 1e-12 ? Math.max(-1, Math.min(1, corrNum / denom)) : 1;

  // K-weighted energy for LUFS
  const [shelf, hp] = getKWeightingFilters(data.sampleRate);
  const kChannels = data.channels.slice(0, 2).map((ch) => {
    const copy = new Float32Array(ch);
    applyBiquadInPlace(copy, shelf);
    applyBiquadInPlace(copy, hp);
    return copy;
  });

  const block400 = Math.max(1, Math.round(0.4 * data.sampleRate));
  const step100 = Math.max(1, Math.round(0.1 * data.sampleRate));
  const blockEnergies: number[] = [];

  for (let start = 0; start < frames; start += step100) {
    const end = Math.min(frames, start + block400);
    const len = end - start;
    if (len < Math.min(frames, step100)) break;
    let sumEnergy = 0;
    for (const kch of kChannels) {
      let sq = 0;
      for (let i = start; i < end; i++) {
        sq += kch[i] * kch[i];
      }
      sumEnergy += sq / len;
    }
    blockEnergies.push(sumEnergy);
  }

  const energyToLufs = (e: number) => (e > 1e-12 ? -0.691 + 10 * Math.log10(e) : -120);

  let integratedLufs = -120;
  let momentaryLufs = -120;
  let shortTermLufs = -120;

  if (blockEnergies.length > 0) {
    momentaryLufs = energyToLufs(blockEnergies[blockEnergies.length - 1]);
    const stBlocks = blockEnergies.slice(-30);
    const stAvg = stBlocks.reduce((a, b) => a + b, 0) / stBlocks.length;
    shortTermLufs = energyToLufs(stAvg);

    // Absolute gate at -70 LUFS
    const absGate = Math.pow(10, (-70 + 0.691) / 10);
    const aboveAbs = blockEnergies.filter((e) => e > absGate);
    if (aboveAbs.length > 0) {
      const ungatedMean = aboveAbs.reduce((a, b) => a + b, 0) / aboveAbs.length;
      const relThreshold = ungatedMean * Math.pow(10, -10 / 10);
      const aboveRel = aboveAbs.filter((e) => e > relThreshold);
      if (aboveRel.length > 0) {
        const finalMean = aboveRel.reduce((a, b) => a + b, 0) / aboveRel.length;
        integratedLufs = energyToLufs(finalMean);
      }
    }
  } else {
    // Short clip fallback
    let sumEnergy = 0;
    for (const kch of kChannels) {
      let sq = 0;
      for (let i = 0; i < frames; i++) sq += kch[i] * kch[i];
      sumEnergy += sq / frames;
    }
    integratedLufs = energyToLufs(sumEnergy);
    momentaryLufs = integratedLufs;
    shortTermLufs = integratedLufs;
  }

  return {
    peakLeftDb: linearToDb(peakL),
    peakRightDb: linearToDb(peakR),
    rmsLeftDb: linearToDb(rmsL),
    rmsRightDb: linearToDb(rmsR),
    momentaryLufs,
    shortTermLufs,
    integratedLufs,
    truePeakDb: linearToDb(truePeak),
    clipping,
    phaseCorrelation,
  };
}

export function normalizeToLufs(data: PcmAudioData, targetLufs: number): PcmAudioData {
  const snap = analyzeMetering(data);
  if (snap.integratedLufs <= -100) return data;
  const gainDb = Math.max(-24, Math.min(24, targetLufs - snap.integratedLufs));
  const gainLin = dbToLinear(gainDb);
  return {
    sampleRate: data.sampleRate,
    channels: data.channels.map((ch) => {
      const out = new Float32Array(ch.length);
      for (let i = 0; i < ch.length; i++) out[i] = ch[i] * gainLin;
      return out;
    }),
  };
}
