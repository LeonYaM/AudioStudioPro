import {
  DelaySettings,
  MasteringChain,
  ModulationSettings,
  PitchTempoSettings,
  ReverbSettings,
  SaturationSettings,
  StereoWidenerSettings,
  TrackEffectRack,
} from '../../shared/types';
import { applyGraphicEqPcm, applyParametricEqPcm, computeBiquad, processBiquadChannel } from './biquad';
import {
  applyCompressorPcm,
  applyDeEsserPcm,
  applyGateExpanderPcm,
  applyLimiterPcm,
  applyMultibandPcm,
} from './dynamics';
import { normalizeToLufs } from './metering';
import { PcmAudioData, clonePcm, getFrameCount, pitchShiftPcm, timeStretchPcm } from './pcmBuffer';

/**
 * Schroeder / Freeverb-style algorithmic stereo reverb with pre-delay and damping.
 */
export function applyReverbPcm(data: PcmAudioData, cfg: ReverbSettings): PcmAudioData {
  if (!cfg.enabled || cfg.mix <= 0.001) return data;
  const out = clonePcm(data);
  const sr = out.sampleRate;
  const frames = getFrameCount(out);
  const scale = sr / 44100;

  const combBase = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  const allpassBase = [556, 441, 341, 225];
  const feedback = 0.72 + cfg.roomSize * 0.23;
  const damp1 = cfg.damping * 0.5;
  const damp2 = 1 - damp1;
  const preDelaySamples = Math.max(0, Math.round((cfg.preDelayMs / 1000) * sr));

  const wetChannels = out.channels.map((src, chIdx) => {
    const spread = chIdx * 23;
    const combs = combBase.map((len) => ({
      buf: new Float32Array(Math.max(16, Math.round((len + spread) * scale))),
      idx: 0,
      filterStore: 0,
    }));
    const allpasses = allpassBase.map((len) => ({
      buf: new Float32Array(Math.max(8, Math.round((len + spread) * scale))),
      idx: 0,
    }));
    const preBuf = new Float32Array(Math.max(1, preDelaySamples + 1));
    let preIdx = 0;

    const wet = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      const inp = src[i];
      let delayedIn = inp;
      if (preDelaySamples > 0) {
        delayedIn = preBuf[preIdx];
        preBuf[preIdx] = inp;
        preIdx = (preIdx + 1) % preBuf.length;
      }

      let acc = 0;
      for (const c of combs) {
        const output = c.buf[c.idx];
        c.filterStore = output * damp2 + c.filterStore * damp1;
        c.buf[c.idx] = delayedIn * 0.15 + c.filterStore * feedback;
        c.idx = (c.idx + 1) % c.buf.length;
        acc += output;
      }

      let apOut = acc;
      for (const ap of allpasses) {
        const bufOut = ap.buf[ap.idx];
        ap.buf[ap.idx] = apOut + bufOut * 0.5;
        apOut = bufOut - apOut * 0.5;
        ap.idx = (ap.idx + 1) % ap.buf.length;
      }
      wet[i] = apOut * 0.35;
    }
    return wet;
  });

  const dryMix = 1 - cfg.mix;
  for (let c = 0; c < out.channels.length; c++) {
    const dst = out.channels[c];
    const wet = wetChannels[c];
    for (let i = 0; i < frames; i++) {
      dst[i] = dst[i] * dryMix + wet[i] * cfg.mix;
    }
  }
  return out;
}

export function applyDelayPcm(data: PcmAudioData, cfg: DelaySettings): PcmAudioData {
  if (!cfg.enabled || cfg.mix <= 0.001) return data;
  const out = clonePcm(data);
  const frames = getFrameCount(out);
  const delaySamples = Math.max(1, Math.round((cfg.timeMs / 1000) * out.sampleRate));
  const fb = Math.max(0, Math.min(0.92, cfg.feedback));
  const isStereo = out.channels.length >= 2;
  const dry = 1 - cfg.mix * 0.5;

  if (cfg.pingPong && isStereo) {
    const bufL = new Float32Array(delaySamples);
    const bufR = new Float32Array(delaySamples);
    let idx = 0;
    const chL = out.channels[0];
    const chR = out.channels[1];
    for (let i = 0; i < frames; i++) {
      const inL = chL[i];
      const inR = chR[i];
      const tapL = bufL[idx];
      const tapR = bufR[idx];
      bufL[idx] = inL + tapR * fb;
      bufR[idx] = inR + tapL * fb;
      idx = (idx + 1) % delaySamples;
      chL[i] = inL * dry + tapL * cfg.mix;
      chR[i] = inR * dry + tapR * cfg.mix;
    }
  } else {
    for (const ch of out.channels) {
      const buf = new Float32Array(delaySamples);
      let idx = 0;
      for (let i = 0; i < frames; i++) {
        const inp = ch[i];
        const tap = buf[idx];
        buf[idx] = inp + tap * fb;
        idx = (idx + 1) % delaySamples;
        ch[i] = inp * dry + tap * cfg.mix;
      }
    }
  }
  return out;
}

export function applyModulationPcm(
  data: PcmAudioData,
  cfg: ModulationSettings
): PcmAudioData {
  if (!cfg.enabled || cfg.mix <= 0.001) return data;
  const out = clonePcm(data);
  const sr = out.sampleRate;
  const frames = getFrameCount(out);

  if (cfg.type === 'tremolo') {
    for (let c = 0; c < out.channels.length; c++) {
      const ch = out.channels[c];
      for (let i = 0; i < frames; i++) {
        const lfo = 0.5 + 0.5 * Math.sin((2 * Math.PI * cfg.rateHz * i) / sr);
        const modGain = 1 - cfg.depth * (1 - lfo);
        ch[i] = ch[i] * (1 - cfg.mix) + ch[i] * modGain * cfg.mix;
      }
    }
    return out;
  }

  if (cfg.type === 'phaser') {
    const stages = 4;
    for (let c = 0; c < out.channels.length; c++) {
      const ch = out.channels[c];
      const zm = new Float32Array(stages);
      const phaseOffset = c * Math.PI * 0.5;
      for (let i = 0; i < frames; i++) {
        const lfo = 0.5 + 0.5 * Math.sin((2 * Math.PI * cfg.rateHz * i) / sr + phaseOffset);
        const minF = 300;
        const maxF = 300 + cfg.depth * 3200;
        const freq = minF + lfo * (maxF - minF);
        const d = (freq * 2) / sr;
        const a1 = (1 - d) / (1 + d);
        let y = ch[i];
        for (let s = 0; s < stages; s++) {
          const next = a1 * y + zm[s];
          zm[s] = y - a1 * next;
          y = next;
        }
        ch[i] = ch[i] * (1 - cfg.mix * 0.5) + y * cfg.mix * 0.5;
      }
    }
    return out;
  }

  // Chorus, Flanger, Vibrato use modulated fractional delay line
  const maxDelayMs = cfg.type === 'flanger' ? 8 : cfg.type === 'vibrato' ? 10 : 28;
  const baseDelayMs = cfg.type === 'flanger' ? 2 : cfg.type === 'vibrato' ? 5 : 14;
  const maxDelaySamples = Math.ceil(((maxDelayMs + 2) / 1000) * sr);

  for (let c = 0; c < out.channels.length; c++) {
    const ch = out.channels[c];
    const ring = new Float32Array(maxDelaySamples);
    let writeIdx = 0;
    const phaseOffset = c * 1.1;
    const feedback = cfg.type === 'flanger' ? 0.45 : 0;

    for (let i = 0; i < frames; i++) {
      const lfo = 0.5 + 0.5 * Math.sin((2 * Math.PI * cfg.rateHz * i) / sr + phaseOffset);
      const delaySamples = ((baseDelayMs + lfo * cfg.depth * (maxDelayMs - baseDelayMs)) / 1000) * sr;
      let readPos = writeIdx - delaySamples;
      if (readPos < 0) readPos += maxDelaySamples;
      const idx0 = Math.floor(readPos) % maxDelaySamples;
      const idx1 = (idx0 + 1) % maxDelaySamples;
      const frac = readPos - Math.floor(readPos);
      const delayed = ring[idx0] * (1 - frac) + ring[idx1] * frac;

      const inp = ch[i];
      ring[writeIdx] = inp + delayed * feedback;
      writeIdx = (writeIdx + 1) % maxDelaySamples;

      if (cfg.type === 'vibrato') {
        ch[i] = inp * (1 - cfg.mix) + delayed * cfg.mix;
      } else {
        ch[i] = inp * (1 - cfg.mix * 0.5) + (inp + delayed) * 0.5 * cfg.mix;
      }
    }
  }
  return out;
}

export function applySaturationPcm(
  data: PcmAudioData,
  cfg: SaturationSettings
): PcmAudioData {
  if (!cfg.enabled || cfg.drive <= 0.001) return data;
  const out = clonePcm(data);
  const driveGain = 1 + cfg.drive * (cfg.mode === 'distortion' ? 18 : 6);

  if (cfg.mode === 'exciter') {
    // High-pass harmonic generation blended gently back in
    const excited = clonePcm(data);
    const hp = computeBiquad('highpass', out.sampleRate, Math.max(1500, cfg.toneHz * 0.4), 0, 0.707);
    for (let c = 0; c < excited.channels.length; c++) {
      const ech = excited.channels[c];
      processBiquadChannel(ech, hp);
      for (let i = 0; i < ech.length; i++) {
        ech[i] = Math.tanh(ech[i] * driveGain) / Math.tanh(driveGain);
        out.channels[c][i] += ech[i] * cfg.mix * 0.45;
      }
    }
    return out;
  }

  for (const ch of out.channels) {
    for (let i = 0; i < ch.length; i++) {
      const x = ch[i];
      const shaped =
        cfg.mode === 'distortion'
          ? Math.max(-0.95, Math.min(0.95, (2 / Math.PI) * Math.atan(x * driveGain)))
          : Math.tanh(x * driveGain) / Math.tanh(driveGain);
      ch[i] = x * (1 - cfg.mix) + shaped * cfg.mix;
    }
  }

  if (cfg.toneHz < out.sampleRate * 0.45) {
    const lp = computeBiquad('lowpass', out.sampleRate, cfg.toneHz, 0, 0.707);
    for (const ch of out.channels) processBiquadChannel(ch, lp);
  }
  return out;
}

export function applyStereoWidenerPcm(
  data: PcmAudioData,
  cfg: StereoWidenerSettings
): PcmAudioData {
  if (!cfg.enabled || data.channels.length < 2 || Math.abs(cfg.width - 1) < 0.01) {
    return data;
  }
  const out = clonePcm(data);
  const L = out.channels[0];
  const R = out.channels[1];
  for (let i = 0; i < L.length; i++) {
    const mid = 0.5 * (L[i] + R[i]);
    const side = 0.5 * (L[i] - R[i]) * cfg.width;
    L[i] = mid + side;
    R[i] = mid - side;
  }
  return out;
}

export function applyPitchTempoPcm(
  data: PcmAudioData,
  cfg: PitchTempoSettings
): PcmAudioData {
  if (!cfg.enabled) return data;
  let current = data;
  if (Math.abs(cfg.tempoFactor - 1) > 0.01) {
    current = timeStretchPcm(current, cfg.tempoFactor);
  }
  if (Math.abs(cfg.semitones) > 0.05) {
    current = pitchShiftPcm(current, cfg.semitones);
  }
  if (cfg.octaverMix > 0.01) {
    const sub = pitchShiftPcm(current, -12);
    const frames = Math.min(getFrameCount(current), getFrameCount(sub));
    const mix = Math.min(1, cfg.octaverMix);
    const blended = clonePcm(current);
    for (let c = 0; c < blended.channels.length; c++) {
      const dst = blended.channels[c];
      const sCh = sub.channels[c % sub.channels.length];
      for (let i = 0; i < frames; i++) {
        dst[i] = dst[i] * (1 - mix * 0.4) + sCh[i] * mix;
      }
    }
    current = blended;
  }
  return current;
}

export function processEffectRackPcm(
  data: PcmAudioData,
  rack: TrackEffectRack
): PcmAudioData {
  let out = data;
  out = applyGateExpanderPcm(out, rack.gate);
  out = applyParametricEqPcm(out, rack.parametricEq);
  out = applyGraphicEqPcm(out, rack.graphicEq);
  out = applyDeEsserPcm(out, rack.deEsser);
  out = applyCompressorPcm(out, rack.compressor);
  out = applyMultibandPcm(out, rack.multiband);
  out = applySaturationPcm(out, rack.saturation);
  out = applyPitchTempoPcm(out, rack.pitchTempo);
  out = applyModulationPcm(out, rack.modulation);
  out = applyStereoWidenerPcm(out, rack.widener);
  out = applyDelayPcm(out, rack.delay);
  out = applyReverbPcm(out, rack.reverb);
  out = applyLimiterPcm(out, rack.limiter);
  return out;
}

export function processMasteringChainPcm(
  data: PcmAudioData,
  chain: MasteringChain
): PcmAudioData {
  let out = data;
  out = applyParametricEqPcm(out, chain.eq);
  out = applyCompressorPcm(out, chain.compressor);
  out = applyMultibandPcm(out, chain.multiband);
  out = applySaturationPcm(out, chain.saturation);
  out = applyStereoWidenerPcm(out, chain.widener);
  out = normalizeToLufs(out, chain.targetLufs);
  out = applyLimiterPcm(out, chain.limiter);
  return out;
}
