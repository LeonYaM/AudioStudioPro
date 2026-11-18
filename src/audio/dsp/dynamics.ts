import {
  CompressorSettings,
  DeEsserSettings,
  GateExpanderSettings,
  LimiterSettings,
  MultibandSettings,
} from '../../shared/types';
import { computeBiquad, processBiquadChannel } from './biquad';
import { dbToLinear, linearToDb } from './metering';
import { PcmAudioData, clonePcm, getFrameCount } from './pcmBuffer';

export function applyCompressorPcm(
  data: PcmAudioData,
  cfg: CompressorSettings
): PcmAudioData {
  if (!cfg.enabled) return data;
  const out = clonePcm(data);
  const frames = getFrameCount(out);
  const sr = out.sampleRate;
  const attackCoef = Math.exp(-1 / Math.max(1, (cfg.attackMs / 1000) * sr));
  const releaseCoef = Math.exp(-1 / Math.max(1, (cfg.releaseMs / 1000) * sr));
  const makeup = dbToLinear(cfg.makeupGainDb);
  const halfKnee = Math.max(0.01, cfg.kneeDb) / 2;

  let envDb = -120;
  for (let i = 0; i < frames; i++) {
    let linkedAbs = 0;
    for (const ch of out.channels) {
      const a = Math.abs(ch[i]);
      if (a > linkedAbs) linkedAbs = a;
    }
    const inDb = linearToDb(linkedAbs);
    const coef = inDb > envDb ? attackCoef : releaseCoef;
    envDb = coef * envDb + (1 - coef) * inDb;

    let overDb = envDb - cfg.thresholdDb;
    let gainReductionDb = 0;
    if (overDb > -halfKnee) {
      if (overDb < halfKnee && cfg.kneeDb > 0) {
        const x = overDb + halfKnee;
        const soft = (x * x) / (2 * cfg.kneeDb);
        gainReductionDb = soft * (1 / cfg.ratio - 1);
      } else {
        gainReductionDb = overDb * (1 / cfg.ratio - 1);
      }
    }

    const gain = dbToLinear(gainReductionDb) * makeup;
    for (const ch of out.channels) {
      ch[i] *= gain;
    }
  }
  return out;
}

export function applyLimiterPcm(data: PcmAudioData, cfg: LimiterSettings): PcmAudioData {
  if (!cfg.enabled) return data;
  const out = clonePcm(data);
  const frames = getFrameCount(out);
  const ceilingLin = dbToLinear(cfg.ceilingDb);
  const lookaheadFrames = Math.max(1, Math.round((cfg.lookaheadMs / 1000) * out.sampleRate));
  const releaseCoef = Math.exp(-1 / Math.max(1, (cfg.releaseMs / 1000) * out.sampleRate));

  let currentGain = 1;
  for (let i = 0; i < frames; i++) {
    let futurePeak = 0;
    const end = Math.min(frames, i + lookaheadFrames);
    for (let j = i; j < end; j++) {
      for (const ch of out.channels) {
        const a = Math.abs(ch[j]);
        if (a > futurePeak) futurePeak = a;
      }
    }
    const targetGain = futurePeak > ceilingLin ? ceilingLin / futurePeak : 1;
    if (targetGain < currentGain) {
      currentGain = targetGain;
    } else {
      currentGain = releaseCoef * currentGain + (1 - releaseCoef) * targetGain;
    }
    for (const ch of out.channels) {
      const s = ch[i] * currentGain;
      ch[i] = Math.max(-ceilingLin, Math.min(ceilingLin, s));
    }
  }
  return out;
}

export function applyGateExpanderPcm(
  data: PcmAudioData,
  cfg: GateExpanderSettings
): PcmAudioData {
  if (!cfg.enabled) return data;
  const out = clonePcm(data);
  const frames = getFrameCount(out);
  const sr = out.sampleRate;
  const attackCoef = Math.exp(-1 / Math.max(1, (cfg.attackMs / 1000) * sr));
  const releaseCoef = Math.exp(-1 / Math.max(1, (cfg.releaseMs / 1000) * sr));

  let env = 0;
  for (let i = 0; i < frames; i++) {
    let peak = 0;
    for (const ch of out.channels) {
      const a = Math.abs(ch[i]);
      if (a > peak) peak = a;
    }
    const coef = peak > env ? attackCoef : releaseCoef;
    env = coef * env + (1 - coef) * peak;
    const envDb = linearToDb(env);

    let gainDb = 0;
    if (envDb < cfg.thresholdDb) {
      if (cfg.mode === 'gate') {
        gainDb = cfg.rangeDb;
      } else {
        const under = cfg.thresholdDb - envDb;
        gainDb = Math.max(cfg.rangeDb, -under * (cfg.ratio - 1));
      }
    }
    const gain = dbToLinear(gainDb);
    for (const ch of out.channels) {
      ch[i] *= gain;
    }
  }
  return out;
}

export function applyMultibandPcm(
  data: PcmAudioData,
  cfg: MultibandSettings
): PcmAudioData {
  if (!cfg.enabled) return data;
  const sr = data.sampleRate;
  const frames = getFrameCount(data);

  // Split into 3 bands using cascaded Linkwitz-Riley-style 2nd-order crossovers
  const lowData = clonePcm(data);
  const midData = clonePcm(data);
  const highData = clonePcm(data);

  const lpLow = computeBiquad('lowpass', sr, cfg.lowCrossHz, 0, 0.707);
  const hpLow = computeBiquad('highpass', sr, cfg.lowCrossHz, 0, 0.707);
  const lpHigh = computeBiquad('lowpass', sr, cfg.highCrossHz, 0, 0.707);
  const hpHigh = computeBiquad('highpass', sr, cfg.highCrossHz, 0, 0.707);

  for (const ch of lowData.channels) {
    processBiquadChannel(ch, lpLow);
    processBiquadChannel(ch, lpLow);
  }
  for (const ch of midData.channels) {
    processBiquadChannel(ch, hpLow);
    processBiquadChannel(ch, lpHigh);
  }
  for (const ch of highData.channels) {
    processBiquadChannel(ch, hpHigh);
    processBiquadChannel(ch, hpHigh);
  }

  const lowComp = applyCompressorPcm(lowData, {
    enabled: true,
    thresholdDb: cfg.lowThresholdDb,
    ratio: cfg.ratio,
    attackMs: 18,
    releaseMs: 140,
    kneeDb: 4,
    makeupGainDb: cfg.makeupDb,
  });
  const midComp = applyCompressorPcm(midData, {
    enabled: true,
    thresholdDb: cfg.midThresholdDb,
    ratio: cfg.ratio,
    attackMs: 10,
    releaseMs: 110,
    kneeDb: 4,
    makeupGainDb: cfg.makeupDb,
  });
  const highComp = applyCompressorPcm(highData, {
    enabled: true,
    thresholdDb: cfg.highThresholdDb,
    ratio: cfg.ratio,
    attackMs: 5,
    releaseMs: 80,
    kneeDb: 4,
    makeupGainDb: cfg.makeupDb,
  });

  const out = clonePcm(data);
  for (let c = 0; c < out.channels.length; c++) {
    for (let i = 0; i < frames; i++) {
      out.channels[c][i] =
        lowComp.channels[c][i] + midComp.channels[c][i] + highComp.channels[c][i];
    }
  }
  return out;
}

export function applyDeEsserPcm(data: PcmAudioData, cfg: DeEsserSettings): PcmAudioData {
  if (!cfg.enabled) return data;
  const out = clonePcm(data);
  const frames = getFrameCount(out);
  const sr = out.sampleRate;

  // Phase-perfect complementary 1st-order crossover so low + high === original
  const dt = 1 / sr;
  const rc = 1 / (2 * Math.PI * Math.max(1000, cfg.frequencyHz * 0.85));
  const lpAlpha = dt / (rc + dt);
  const lpState = new Float32Array(out.channels.length);

  const attackCoef = Math.exp(-1 / Math.max(1, 0.002 * sr));
  const releaseCoef = Math.exp(-1 / Math.max(1, 0.05 * sr));
  const maxRed = Math.abs(cfg.reductionDb);

  let envDb = -120;
  for (let i = 0; i < frames; i++) {
    let scPeak = 0;
    const highSamples = new Float32Array(out.channels.length);
    for (let c = 0; c < out.channels.length; c++) {
      const x = out.channels[c][i];
      lpState[c] += lpAlpha * (x - lpState[c]);
      const hi = x - lpState[c];
      highSamples[c] = hi;
      const a = Math.abs(hi);
      if (a > scPeak) scPeak = a;
    }

    const scDb = linearToDb(scPeak);
    const coef = scDb > envDb ? attackCoef : releaseCoef;
    envDb = coef * envDb + (1 - coef) * scDb;

    let redDb = 0;
    if (envDb > cfg.thresholdDb) {
      redDb = Math.min(maxRed, (envDb - cfg.thresholdDb) * 0.75);
    }
    if (redDb > 0.05) {
      const gain = dbToLinear(-redDb);
      for (let c = 0; c < out.channels.length; c++) {
        out.channels[c][i] = lpState[c] + highSamples[c] * gain;
      }
    }
  }
  return out;
}
