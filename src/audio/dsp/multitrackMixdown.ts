import { AutomationLane, MultitrackTrack, StudioProject } from '../../shared/types';
import { applyDelayPcm, applyReverbPcm, processEffectRackPcm, processMasteringChainPcm } from './effects';
import { computeBiquad, processBiquadChannel } from './biquad';
import { analyzeMetering, dbToLinear } from './metering';
import { PcmAudioData, clonePcm, getDurationSec, getFrameCount, resamplePcm } from './pcmBuffer';

export function evaluateAutomationAt(
  lanes: AutomationLane[],
  target: AutomationLane['target'],
  timeSec: number,
  fallbackValue: number
): number {
  const lane = lanes.find((l) => l.target === target);
  if (!lane || lane.points.length === 0) return fallbackValue;
  const pts = [...lane.points].sort((a, b) => a.timeSec - b.timeSec);
  if (timeSec <= pts[0].timeSec) return pts[0].value;
  if (timeSec >= pts[pts.length - 1].timeSec) return pts[pts.length - 1].value;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i];
    const p1 = pts[i + 1];
    if (timeSec >= p0.timeSec && timeSec <= p1.timeSec) {
      const span = p1.timeSec - p0.timeSec;
      const t = span > 1e-6 ? (timeSec - p0.timeSec) / span : 0;
      return p0.value + (p1.value - p0.value) * t;
    }
  }
  return fallbackValue;
}

export function computeProjectDurationSec(
  project: StudioProject,
  assetMap: Map<string, PcmAudioData>
): number {
  let maxEnd = 0;
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      const asset = assetMap.get(clip.assetId);
      const maxDur = asset ? getDurationSec(asset) : clip.durationSec;
      const dur = Math.min(clip.durationSec, Math.max(0, maxDur - clip.offsetSec));
      maxEnd = Math.max(maxEnd, clip.startTimeSec + dur);
    }
  }
  return maxEnd;
}

/**
 * Renders an entire multitrack project (all audio tracks, submixes, aux sends,
 * clip fades, automation, per-track effects, master rack & optional mastering chain)
 * into a stereo 32-bit float PCM buffer.
 */
export function renderMultitrackMixdown(
  project: StudioProject,
  rawAssetMap: Map<string, PcmAudioData>,
  options: { applyMastering?: boolean } = {}
): PcmAudioData {
  const sr = project.sampleRate;
  const resampledAssets = new Map<string, PcmAudioData>();
  for (const [id, pcm] of rawAssetMap.entries()) {
    resampledAssets.set(id, pcm.sampleRate === sr ? pcm : resamplePcm(pcm, sr));
  }

  const totalSec = Math.max(0.1, computeProjectDurationSec(project, resampledAssets));
  const totalFrames = Math.ceil(totalSec * sr);

  const audioTracks = project.tracks.filter((t) => t.type === 'audio');
  const auxTracks = project.tracks.filter((t) => t.type === 'aux');
  const submixTracks = project.tracks.filter((t) => t.type === 'submix');
  const anySolo = project.tracks.some((t) => t.solo);

  const busBuffers = new Map<string, [Float32Array, Float32Array]>();
  const ensureBus = (busId: string): [Float32Array, Float32Array] => {
    let b = busBuffers.get(busId);
    if (!b) {
      b = [new Float32Array(totalFrames), new Float32Array(totalFrames)];
      busBuffers.set(busId, b);
    }
    return b;
  };
  ensureBus('master');
  for (const b of [...auxTracks, ...submixTracks]) ensureBus(b.id);

  const renderTrackToStem = (track: MultitrackTrack): PcmAudioData => {
    const stemL = new Float32Array(totalFrames);
    const stemR = new Float32Array(totalFrames);

    for (const clip of track.clips) {
      if (clip.muted) continue;
      const asset = resampledAssets.get(clip.assetId);
      if (!asset) continue;
      const assetFrames = getFrameCount(asset);
      const offsetFrame = Math.max(0, Math.round(clip.offsetSec * sr));
      const clipFrames = Math.min(
        Math.round(clip.durationSec * sr),
        Math.max(0, assetFrames - offsetFrame)
      );
      const startFrame = Math.round(clip.startTimeSec * sr);
      const clipGain = dbToLinear(clip.gainDb);
      const fadeInFrames = Math.round(clip.fadeInSec * sr);
      const fadeOutFrames = Math.round(clip.fadeOutSec * sr);

      const srcL = asset.channels[0];
      const srcR = asset.channels.length > 1 ? asset.channels[1] : asset.channels[0];

      for (let i = 0; i < clipFrames; i++) {
        const dstIdx = startFrame + i;
        if (dstIdx < 0 || dstIdx >= totalFrames) continue;
        let env = clipGain;
        if (fadeInFrames > 0 && i < fadeInFrames) {
          env *= Math.sin((i / fadeInFrames) * Math.PI * 0.5);
        }
        if (fadeOutFrames > 0 && i >= clipFrames - fadeOutFrames) {
          const rem = clipFrames - 1 - i;
          env *= Math.sin((Math.max(0, rem) / fadeOutFrames) * Math.PI * 0.5);
        }
        stemL[dstIdx] += srcL[offsetFrame + i] * env;
        stemR[dstIdx] += srcR[offsetFrame + i] * env;
      }
    }

    const hasEqAuto = track.automation.some((a) => a.target === 'eq_gain' && a.points.length > 0);
    const hasRevAuto = track.automation.some((a) => a.target === 'reverb_mix' && a.points.length > 0);
    const hasDelAuto = track.automation.some((a) => a.target === 'delay_mix' && a.points.length > 0);

    const rackForBase = {
      ...track.effects,
      reverb: hasRevAuto ? { ...track.effects.reverb, enabled: false } : track.effects.reverb,
      delay: hasDelAuto ? { ...track.effects.delay, enabled: false } : track.effects.delay,
    };

    let processed = processEffectRackPcm(
      { sampleRate: sr, channels: [stemL, stemR] },
      rackForBase
    );

    if (hasEqAuto) {
      // Apply block-wise automated 1kHz peaking EQ gain (20ms blocks)
      const blockLen = Math.max(64, Math.round(0.02 * sr));
      const outEq = clonePcm(processed);
      for (let pos = 0; pos < totalFrames; pos += blockLen) {
        const end = Math.min(totalFrames, pos + blockLen);
        const gainDb = evaluateAutomationAt(track.automation, 'eq_gain', pos / sr, 0);
        if (Math.abs(gainDb) >= 0.05) {
          const c = computeBiquad('peaking', sr, 1000, gainDb, 1.0);
          for (const ch of outEq.channels) {
            const sub = ch.subarray(pos, end);
            processBiquadChannel(sub, c);
          }
        }
      }
      processed = outEq;
    }

    if (hasDelAuto) {
      const wetDel = applyDelayPcm(processed, { ...track.effects.delay, enabled: true, mix: 1.0 });
      for (let i = 0; i < totalFrames; i++) {
        const mix = Math.max(0, Math.min(1, evaluateAutomationAt(track.automation, 'delay_mix', i / sr, track.effects.delay.mix)));
        processed.channels[0][i] = processed.channels[0][i] * (1 - mix * 0.5) + wetDel.channels[0][i] * mix;
        processed.channels[1][i] = processed.channels[1][i] * (1 - mix * 0.5) + wetDel.channels[1][i] * mix;
      }
    }

    if (hasRevAuto) {
      const wetRev = applyReverbPcm(processed, { ...track.effects.reverb, enabled: true, mix: 1.0 });
      for (let i = 0; i < totalFrames; i++) {
        const mix = Math.max(0, Math.min(1, evaluateAutomationAt(track.automation, 'reverb_mix', i / sr, track.effects.reverb.mix)));
        processed.channels[0][i] = processed.channels[0][i] * (1 - mix) + wetRev.channels[0][i] * mix;
        processed.channels[1][i] = processed.channels[1][i] * (1 - mix) + wetRev.channels[1][i] * mix;
      }
    }

    if (track.phaseInvert) {
      for (const ch of processed.channels) {
        for (let i = 0; i < ch.length; i++) ch[i] = -ch[i];
      }
    }
    return processed;
  };

  // 1. Render audio tracks into submix/master & aux buses
  for (const track of audioTracks) {
    if (track.mute || (anySolo && !track.solo)) continue;
    if (track.clips.length === 0) continue;

    const stem = renderTrackToStem(track);
    const outBus = ensureBus(track.outputBusId || 'master');
    const L = stem.channels[0];
    const R = stem.channels[1];
    const hasVolAuto = track.automation.some((a) => a.target === 'volume' && a.points.length > 0);
    const hasPanAuto = track.automation.some((a) => a.target === 'pan' && a.points.length > 0);

    const staticVol = dbToLinear(track.volumeDb);
    const staticPanAngle = ((track.pan + 1) * Math.PI) / 4;
    const staticGainL = staticVol * Math.cos(staticPanAngle) * Math.SQRT2;
    const staticGainR = staticVol * Math.sin(staticPanAngle) * Math.SQRT2;

    for (let i = 0; i < totalFrames; i++) {
      let gL = staticGainL;
      let gR = staticGainR;
      if (hasVolAuto || hasPanAuto) {
        const t = i / sr;
        const volDb = hasVolAuto
          ? evaluateAutomationAt(track.automation, 'volume', t, track.volumeDb)
          : track.volumeDb;
        const pan = hasPanAuto
          ? Math.max(-1, Math.min(1, evaluateAutomationAt(track.automation, 'pan', t, track.pan)))
          : track.pan;
        const v = dbToLinear(volDb);
        const angle = ((pan + 1) * Math.PI) / 4;
        gL = v * Math.cos(angle) * Math.SQRT2;
        gR = v * Math.sin(angle) * Math.SQRT2;
      }

      const sL = L[i] * gL;
      const sR = R[i] * gR;
      outBus[0][i] += sL;
      outBus[1][i] += sR;

      for (const [auxId, sendAmt] of Object.entries(track.auxSends)) {
        if (sendAmt > 0.001) {
          const auxBus = busBuffers.get(auxId);
          if (auxBus) {
            auxBus[0][i] += sL * sendAmt;
            auxBus[1][i] += sR * sendAmt;
          }
        }
      }
    }
  }

  // 2. Process Submix & Aux buses into Master
  const masterBus = ensureBus('master');
  for (const busTrack of [...submixTracks, ...auxTracks]) {
    if (busTrack.mute || (anySolo && !busTrack.solo)) continue;
    const rawBus = busBuffers.get(busTrack.id);
    if (!rawBus) continue;
    const busPcm = processEffectRackPcm(
      { sampleRate: sr, channels: [rawBus[0], rawBus[1]] },
      busTrack.effects
    );
    const vol = dbToLinear(busTrack.volumeDb);
    const angle = ((busTrack.pan + 1) * Math.PI) / 4;
    const gL = vol * Math.cos(angle) * (busTrack.phaseInvert ? -1 : 1);
    const gR = vol * Math.sin(angle) * (busTrack.phaseInvert ? -1 : 1);
    for (let i = 0; i < totalFrames; i++) {
      masterBus[0][i] += busPcm.channels[0][i] * gL;
      masterBus[1][i] += busPcm.channels[1][i] * gR;
    }
  }

  // 3. Apply Master Fader, Pan, Master FX, and optional Mastering Chain
  const masterVol = dbToLinear(project.masterVolumeDb);
  const masterAngle = ((project.masterPan + 1) * Math.PI) / 4;
  const mL = masterVol * Math.cos(masterAngle) * Math.SQRT2;
  const mR = masterVol * Math.sin(masterAngle) * Math.SQRT2;
  for (let i = 0; i < totalFrames; i++) {
    masterBus[0][i] *= mL;
    masterBus[1][i] *= mR;
  }

  let finalMix = processEffectRackPcm(
    { sampleRate: sr, channels: [masterBus[0], masterBus[1]] },
    project.masterEffects
  );

  if (options.applyMastering) {
    finalMix = processMasteringChainPcm(finalMix, project.mastering);
  }

  return finalMix;
}

/**
 * AI Auto-Balance: measures integrated loudness of each active track and
 * adjusts track faders toward balanced -18 LUFS stems before master headroom.
 */
export function autoBalanceTracks(
  project: StudioProject,
  rawAssetMap: Map<string, PcmAudioData>
): Record<string, number> {
  const adjustments: Record<string, number> = {};
  const sr = project.sampleRate;
  for (const track of project.tracks) {
    if (track.type !== 'audio' || track.clips.length === 0) continue;
    // Measure first clip's asset loudness as track reference
    const firstClip = track.clips[0];
    const asset = rawAssetMap.get(firstClip.assetId);
    if (!asset) continue;
    const meter = analyzeMetering(asset);
    if (meter.integratedLufs > -70) {
      const targetStemLufs = -20;
      const delta = Math.max(-18, Math.min(12, targetStemLufs - (meter.integratedLufs + firstClip.gainDb)));
      adjustments[track.id] = Number(delta.toFixed(1));
    }
  }
  void sr;
  return adjustments;
}
