import {
  AudioDeviceInfo,
  MeteringSnapshot,
  MultitrackTrack,
  SampleRateOption,
  StudioProject,
  TrackEffectRack,
} from '../../shared/types';
import { dbToLinear, linearToDb } from '../dsp/metering';
import { PcmAudioData, getFrameCount } from '../dsp/pcmBuffer';

export type LatencyMode = 'interactive' | 'balanced' | 'playback';

export interface TrackMeterLevel {
  peakDb: number;
  rmsDb: number;
}

interface ScheduledSourceHandle {
  stop: () => void;
}

interface LiveTrackNodes {
  type: 'audio' | 'aux' | 'submix';
  gain: GainNode;
  pan: StereoPannerNode;
  auxSends: Record<string, GainNode>;
  analyser: AnalyserNode;
  worklet?: AudioWorkletNode;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private dspWorkletAvailable = false;
  private masterGain: GainNode | null = null;
  private masterPanNode: StereoPannerNode | null = null;
  private masterAnalyser: AnalyserNode | null = null;
  private activeHandles: ScheduledSourceHandle[] = [];
  private liveTracks = new Map<string, LiveTrackNodes>();
  private previewWorklet: AudioWorkletNode | null = null;

  private playbackStartCtxTime = 0;
  private playbackOffsetSec = 0;
  private isPlayingState = false;
  private loopActive = false;
  private loopStart = 0;
  private loopEnd = 0;
  private loopTimer: number | null = null;

  // Live recording state
  private mediaStream: MediaStream | null = null;
  private recSourceNode: MediaStreamAudioSourceNode | null = null;
  private recGainNode: GainNode | null = null;
  private recMonitorGain: GainNode | null = null;
  private recScriptNode: ScriptProcessorNode | null = null;
  private recBuffersL: Float32Array[] = [];
  private recBuffersR: Float32Array[] = [];
  private recAnalyser: AnalyserNode | null = null;
  private recStartTimeSec = 0;
  private isRecordingState = false;

  private sampleRate: SampleRateOption = 48000;
  private latencyMode: LatencyMode = 'interactive';
  private outputDeviceId = 'default';
  private softClipEnabled = true;

  private latestMeter: MeteringSnapshot = {
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
  private lufsWindow: number[] = [];

  private onMeterListeners = new Set<(m: MeteringSnapshot) => void>();
  private onTrackMetersListeners = new Set<(levels: Record<string, TrackMeterLevel>) => void>();
  private onPositionListeners = new Set<(sec: number) => void>();
  private onStopListeners = new Set<() => void>();
  private rafId: number | null = null;
  private meterScratch = new Float32Array(256);

  async ensureContext(
    sampleRate: SampleRateOption = this.sampleRate,
    latencyMode: LatencyMode = this.latencyMode
  ): Promise<AudioContext> {
    if (
      this.ctx &&
      (this.sampleRate !== sampleRate || this.latencyMode !== latencyMode)
    ) {
      await this.disposeContext();
    }
    this.sampleRate = sampleRate;
    this.latencyMode = latencyMode;

    if (!this.ctx) {
      this.ctx = new AudioContext({
        sampleRate,
        latencyHint: latencyMode,
      });

      this.masterGain = this.ctx.createGain();
      this.masterPanNode = this.ctx.createStereoPanner();
      this.masterAnalyser = this.ctx.createAnalyser();
      this.masterAnalyser.fftSize = 2048;

      try {
        await this.ctx.audioWorklet.addModule('./worklets/dsp-rack-processor.js');
        this.dspWorkletAvailable = true;
      } catch {
        this.dspWorkletAvailable = false;
      }

      try {
        await this.ctx.audioWorklet.addModule('./worklets/meter-processor.js');
        this.workletNode = new AudioWorkletNode(this.ctx, 'meter-softclip-processor', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2],
        });
        this.workletNode.port.postMessage({ softClipEnabled: this.softClipEnabled });
        this.workletNode.port.onmessage = (e) => {
          this.handleWorkletMeter(e.data);
        };
        this.masterGain.connect(this.masterPanNode);
        this.masterPanNode.connect(this.workletNode);
        this.workletNode.connect(this.masterAnalyser);
        this.masterAnalyser.connect(this.ctx.destination);
      } catch {
        this.masterGain.connect(this.masterPanNode);
        this.masterPanNode.connect(this.masterAnalyser);
        this.masterAnalyser.connect(this.ctx.destination);
      }

      if (this.outputDeviceId !== 'default') {
        await this.setOutputDevice(this.outputDeviceId);
      }
    }

    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
    return this.ctx;
  }

  private handleWorkletMeter(data: {
    peakL: number;
    peakR: number;
    rmsL: number;
    rmsR: number;
    clipped: boolean;
    phase: number;
  }): void {
    const peakLeftDb = linearToDb(data.peakL);
    const peakRightDb = linearToDb(data.peakR);
    const rmsLeftDb = linearToDb(data.rmsL);
    const rmsRightDb = linearToDb(data.rmsR);
    const energy = data.rmsL * data.rmsL + data.rmsR * data.rmsR;
    const momentaryLufs = energy > 1e-12 ? -0.691 + 10 * Math.log10(energy) : -120;
    this.lufsWindow.push(energy);
    if (this.lufsWindow.length > 75) this.lufsWindow.shift();
    const avgE =
      this.lufsWindow.reduce((a, b) => a + b, 0) / Math.max(1, this.lufsWindow.length);
    const shortTermLufs = avgE > 1e-12 ? -0.691 + 10 * Math.log10(avgE) : -120;

    this.latestMeter = {
      peakLeftDb,
      peakRightDb,
      rmsLeftDb,
      rmsRightDb,
      momentaryLufs,
      shortTermLufs,
      integratedLufs: shortTermLufs,
      truePeakDb: Math.max(peakLeftDb, peakRightDb),
      clipping: data.clipped,
      phaseCorrelation: data.phase,
    };

    for (const cb of this.onMeterListeners) cb(this.latestMeter);
  }

  async setOutputDevice(deviceId: string): Promise<void> {
    this.outputDeviceId = deviceId;
    if (!this.ctx) return;
    const anyCtx = this.ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> };
    if (typeof anyCtx.setSinkId === 'function') {
      try {
        await anyCtx.setSinkId(deviceId === 'default' ? '' : deviceId);
      } catch {
        // Ignore unsupported sink errors gracefully
      }
    }
  }

  setSoftClipProtection(enabled: boolean): void {
    this.softClipEnabled = enabled;
    this.workletNode?.port.postMessage({ softClipEnabled: enabled });
  }

  setMasterVolumeDb(db: number): void {
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(dbToLinear(db), this.ctx.currentTime, 0.015);
    }
  }

  setMasterPan(pan: number): void {
    if (this.masterPanNode && this.ctx) {
      this.masterPanNode.pan.setTargetAtTime(
        Math.max(-1, Math.min(1, pan)),
        this.ctx.currentTime,
        0.015
      );
    }
  }

  updateLiveTrack(track: MultitrackTrack, anySolo: boolean): void {
    if (!this.ctx) return;
    const live = this.liveTracks.get(track.id);
    if (!live) return;
    const silenced = track.mute || (anySolo && !track.solo);
    const targetGain = silenced
      ? 0
      : dbToLinear(track.volumeDb) * (track.phaseInvert ? -1 : 1);
    live.gain.gain.setTargetAtTime(targetGain, this.ctx.currentTime, 0.015);
    live.pan.pan.setTargetAtTime(
      Math.max(-1, Math.min(1, track.pan)),
      this.ctx.currentTime,
      0.015
    );
    for (const [auxId, sendNode] of Object.entries(live.auxSends)) {
      const amt = silenced ? 0 : track.auxSends[auxId] ?? 0;
      sendNode.gain.setTargetAtTime(amt, this.ctx.currentTime, 0.015);
    }
    if (live.worklet) {
      live.worklet.port.postMessage({ rack: track.effects });
    }
  }

  updateLivePreviewRack(rack: TrackEffectRack): void {
    this.previewWorklet?.port.postMessage({ rack });
  }

  async enumerateDevices(): Promise<AudioDeviceInfo[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const list = await navigator.mediaDevices.enumerateDevices();
    return list
      .filter((d) => d.kind === 'audioinput' || d.kind === 'audiooutput')
      .map((d, i) => ({
        deviceId: d.deviceId,
        label:
          d.label ||
          (d.kind === 'audioinput' ? `Entrada de audio ${i + 1}` : `Salida de audio ${i + 1}`),
        kind: d.kind as 'audioinput' | 'audiooutput',
        groupId: d.groupId,
      }));
  }

  getContextInfo(): {
    sampleRate: number;
    baseLatencyMs: number;
    outputLatencyMs: number;
    state: string;
  } {
    if (!this.ctx) {
      return {
        sampleRate: this.sampleRate,
        baseLatencyMs: 0,
        outputLatencyMs: 0,
        state: 'closed',
      };
    }
    const anyCtx = this.ctx as AudioContext & { outputLatency?: number };
    return {
      sampleRate: this.ctx.sampleRate,
      baseLatencyMs: Math.round((this.ctx.baseLatency ?? 0) * 1000 * 10) / 10,
      outputLatencyMs: Math.round((anyCtx.outputLatency ?? 0) * 1000 * 10) / 10,
      state: this.ctx.state,
    };
  }

  getMasterFrequencyData(): Uint8Array {
    if (!this.masterAnalyser) return new Uint8Array(0);
    const arr = new Uint8Array(this.masterAnalyser.frequencyBinCount);
    this.masterAnalyser.getByteFrequencyData(arr);
    return arr;
  }

  private pcmToAudioBuffer(ctx: AudioContext, pcm: PcmAudioData): AudioBuffer {
    const frames = Math.max(1, getFrameCount(pcm));
    const buf = ctx.createBuffer(pcm.channels.length, frames, pcm.sampleRate);
    for (let c = 0; c < pcm.channels.length; c++) {
      buf.copyToChannel(new Float32Array(pcm.channels[c]), c);
    }
    return buf;
  }

  private buildWebAudioEffectChain(
    ctx: AudioContext,
    rack: TrackEffectRack,
    destination: AudioNode
  ): {
    input: AudioNode;
    worklet?: AudioWorkletNode;
    eqAutoFilter: BiquadFilterNode;
    delayWetGain?: GainNode;
  } {
    const head = ctx.createGain();
    let tail: AudioNode = head;

    // Dedicated peaking filter for real-time eq_gain automation
    const eqAutoFilter = ctx.createBiquadFilter();
    eqAutoFilter.type = 'peaking';
    eqAutoFilter.frequency.value = 1000;
    eqAutoFilter.Q.value = 1.0;
    eqAutoFilter.gain.value = 0;
    tail.connect(eqAutoFilter);
    tail = eqAutoFilter;

    if (rack.parametricEq.enabled) {
      for (const band of rack.parametricEq.bands.slice(0, rack.parametricEq.bandCount)) {
        if (!band.enabled) continue;
        const bq = ctx.createBiquadFilter();
        bq.type = band.type;
        bq.frequency.value = band.frequency;
        bq.gain.value = band.gainDb;
        bq.Q.value = band.q;
        tail.connect(bq);
        tail = bq;
      }
    }

    if (rack.compressor.enabled) {
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = Math.max(-100, Math.min(0, rack.compressor.thresholdDb));
      comp.ratio.value = Math.max(1, Math.min(20, rack.compressor.ratio));
      comp.attack.value = Math.max(0.001, rack.compressor.attackMs / 1000);
      comp.release.value = Math.max(0.01, rack.compressor.releaseMs / 1000);
      comp.knee.value = Math.max(0, Math.min(40, rack.compressor.kneeDb));
      const makeup = ctx.createGain();
      makeup.gain.value = dbToLinear(rack.compressor.makeupGainDb);
      tail.connect(comp);
      comp.connect(makeup);
      tail = makeup;
    }

    let worklet: AudioWorkletNode | undefined;
    if (this.dspWorkletAvailable) {
      worklet = new AudioWorkletNode(ctx, 'dsp-rack-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      worklet.port.postMessage({ rack });
      tail.connect(worklet);
      tail = worklet;
    }

    let delayWetGain: GainNode | undefined;
    if (rack.delay.enabled && rack.delay.mix > 0.01) {
      const dry = ctx.createGain();
      const wet = ctx.createGain();
      delayWetGain = wet;
      const delayTime = Math.max(0.01, Math.min(1.9, rack.delay.timeMs / 1000));
      const fbAmt = Math.min(0.9, rack.delay.feedback);
      dry.gain.value = 1 - rack.delay.mix * 0.5;
      wet.gain.value = rack.delay.mix;
      const merge = ctx.createGain();

      tail.connect(dry);
      dry.connect(merge);

      if (rack.delay.pingPong) {
        const split = ctx.createChannelSplitter(2);
        const delL = ctx.createDelay(2.0);
        const delR = ctx.createDelay(2.0);
        const fbL = ctx.createGain();
        const fbR = ctx.createGain();
        const join = ctx.createChannelMerger(2);
        delL.delayTime.value = delayTime;
        delR.delayTime.value = delayTime;
        fbL.gain.value = fbAmt;
        fbR.gain.value = fbAmt;

        tail.connect(split);
        split.connect(delL, 0);
        split.connect(delR, 1);
        delL.connect(fbL);
        fbL.connect(delR);
        delR.connect(fbR);
        fbR.connect(delL);
        delL.connect(join, 0, 0);
        delR.connect(join, 0, 1);
        join.connect(wet);
      } else {
        const delay = ctx.createDelay(2.0);
        const fb = ctx.createGain();
        delay.delayTime.value = delayTime;
        fb.gain.value = fbAmt;
        tail.connect(delay);
        delay.connect(fb);
        fb.connect(delay);
        delay.connect(wet);
      }
      wet.connect(merge);
      tail = merge;
    }

    tail.connect(destination);
    return { input: head, worklet, eqAutoFilter, delayWetGain };
  }

  async playPcm(
    pcm: PcmAudioData,
    options: {
      startSec?: number;
      loop?: boolean;
      loopStartSec?: number;
      loopEndSec?: number;
      rack?: TrackEffectRack;
    } = {}
  ): Promise<void> {
    this.stop();
    const ctx = await this.ensureContext(this.sampleRate, this.latencyMode);
    if (!this.masterGain) return;

    const buffer = this.pcmToAudioBuffer(ctx, pcm);
    const startSec = Math.max(0, Math.min(buffer.duration, options.startSec ?? 0));

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    if (options.loop && options.loopEndSec && options.loopEndSec > (options.loopStartSec ?? 0)) {
      src.loop = true;
      src.loopStart = options.loopStartSec ?? 0;
      src.loopEnd = Math.min(buffer.duration, options.loopEndSec);
      this.loopActive = true;
      this.loopStart = src.loopStart;
      this.loopEnd = src.loopEnd;
    } else {
      this.loopActive = false;
    }

    if (options.rack) {
      const chain = this.buildWebAudioEffectChain(ctx, options.rack, this.masterGain);
      this.previewWorklet = chain.worklet ?? null;
      src.connect(chain.input);
    } else {
      this.previewWorklet = null;
      src.connect(this.masterGain);
    }

    this.playbackStartCtxTime = ctx.currentTime;
    this.playbackOffsetSec = startSec;
    this.isPlayingState = true;

    src.onended = () => {
      if (this.isPlayingState && !src.loop) {
        this.stop();
      }
    };
    src.start(0, startSec);

    this.activeHandles.push({
      stop: () => {
        try {
          src.onended = null;
          src.stop();
          src.disconnect();
        } catch {
          // ignore
        }
      },
    });

    this.startPositionLoop(buffer.duration);
  }

  async playMultitrack(
    project: StudioProject,
    assetMap: Map<string, PcmAudioData>,
    options: { startSec?: number } = {}
  ): Promise<void> {
    this.stop();
    const ctx = await this.ensureContext(project.sampleRate, this.latencyMode);
    if (!this.masterGain) return;

    this.setMasterVolumeDb(project.masterVolumeDb);
    this.setMasterPan(project.masterPan);
    const startSec = Math.max(0, options.startSec ?? 0);
    const now = ctx.currentTime;
    const anySolo = project.tracks.some((t) => t.solo);
    let maxEndSec = startSec;

    // Create submix & aux buses with real per-bus AnalyserNodes
    const busInputs = new Map<string, AudioNode>();
    busInputs.set('master', this.masterGain);
    for (const bus of project.tracks.filter((t) => t.type === 'aux' || t.type === 'submix')) {
      const silenced = bus.mute || (anySolo && !bus.solo);
      const gain = ctx.createGain();
      gain.gain.value = silenced ? 0 : dbToLinear(bus.volumeDb) * (bus.phaseInvert ? -1 : 1);
      const pan = ctx.createStereoPanner();
      pan.pan.value = bus.pan;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;

      const chain = this.buildWebAudioEffectChain(ctx, bus.effects, gain);
      gain.connect(pan);
      pan.connect(analyser);
      analyser.connect(this.masterGain);

      busInputs.set(bus.id, chain.input);
      this.liveTracks.set(bus.id, {
        type: bus.type,
        gain,
        pan,
        auxSends: {},
        analyser,
        worklet: chain.worklet,
      });
    }

    // Schedule each audio track (even muted ones with gain=0 if they have clips, so live unmute works!)
    for (const track of project.tracks) {
      if (track.type !== 'audio') continue;
      if (track.clips.length === 0) continue;

      const silenced = track.mute || (anySolo && !track.solo);
      const outTarget = busInputs.get(track.outputBusId) ?? this.masterGain;
      const trackGain = ctx.createGain();
      trackGain.gain.value = silenced
        ? 0
        : dbToLinear(track.volumeDb) * (track.phaseInvert ? -1 : 1);
      const trackPan = ctx.createStereoPanner();
      trackPan.pan.value = track.pan;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;

      // Schedule volume automation
      const volLane = track.automation.find((a) => a.target === 'volume');
      if (!silenced && volLane && volLane.points.length > 0) {
        const sorted = [...volLane.points].sort((a, b) => a.timeSec - b.timeSec);
        trackGain.gain.setValueAtTime(dbToLinear(sorted[0].value), now);
        for (const pt of sorted) {
          if (pt.timeSec >= startSec) {
            trackGain.gain.linearRampToValueAtTime(
              dbToLinear(pt.value),
              now + (pt.timeSec - startSec)
            );
          }
        }
      }

      // Schedule pan automation
      const panLane = track.automation.find((a) => a.target === 'pan');
      if (panLane && panLane.points.length > 0) {
        const sorted = [...panLane.points].sort((a, b) => a.timeSec - b.timeSec);
        trackPan.pan.setValueAtTime(Math.max(-1, Math.min(1, sorted[0].value)), now);
        for (const pt of sorted) {
          if (pt.timeSec >= startSec) {
            trackPan.pan.linearRampToValueAtTime(
              Math.max(-1, Math.min(1, pt.value)),
              now + (pt.timeSec - startSec)
            );
          }
        }
      }

      const chain = this.buildWebAudioEffectChain(ctx, track.effects, trackGain);

      // Schedule eq_gain & delay_mix effect parameter automation
      const eqLane = track.automation.find((a) => a.target === 'eq_gain');
      if (eqLane && eqLane.points.length > 0) {
        const sorted = [...eqLane.points].sort((a, b) => a.timeSec - b.timeSec);
        chain.eqAutoFilter.gain.setValueAtTime(sorted[0].value, now);
        for (const pt of sorted) {
          if (pt.timeSec >= startSec) {
            chain.eqAutoFilter.gain.linearRampToValueAtTime(
              pt.value,
              now + (pt.timeSec - startSec)
            );
          }
        }
      }

      const delLane = track.automation.find((a) => a.target === 'delay_mix');
      if (chain.delayWetGain && delLane && delLane.points.length > 0) {
        const sorted = [...delLane.points].sort((a, b) => a.timeSec - b.timeSec);
        chain.delayWetGain.gain.setValueAtTime(Math.max(0, Math.min(1, sorted[0].value)), now);
        for (const pt of sorted) {
          if (pt.timeSec >= startSec) {
            chain.delayWetGain.gain.linearRampToValueAtTime(
              Math.max(0, Math.min(1, pt.value)),
              now + (pt.timeSec - startSec)
            );
          }
        }
      }

      trackGain.connect(trackPan);
      trackPan.connect(analyser);
      analyser.connect(outTarget);

      // Aux sends (both Aux 1 & Aux 2)
      const auxSendNodes: Record<string, GainNode> = {};
      for (const auxTrack of project.tracks.filter((t) => t.type === 'aux')) {
        const auxTarget = busInputs.get(auxTrack.id);
        if (auxTarget) {
          const sendGain = ctx.createGain();
          sendGain.gain.value = silenced ? 0 : track.auxSends[auxTrack.id] ?? 0;
          analyser.connect(sendGain);
          sendGain.connect(auxTarget);
          auxSendNodes[auxTrack.id] = sendGain;
        }
      }

      this.liveTracks.set(track.id, {
        type: 'audio',
        gain: trackGain,
        pan: trackPan,
        auxSends: auxSendNodes,
        analyser,
        worklet: chain.worklet,
      });

      for (const clip of track.clips) {
        if (clip.muted) continue;
        const pcm = assetMap.get(clip.assetId);
        if (!pcm) continue;

        const clipEnd = clip.startTimeSec + clip.durationSec;
        if (clipEnd <= startSec) continue;
        maxEndSec = Math.max(maxEndSec, clipEnd);

        const buf = this.pcmToAudioBuffer(ctx, pcm);
        const src = ctx.createBufferSource();
        src.buffer = buf;

        const clipGain = ctx.createGain();
        const baseGain = dbToLinear(clip.gainDb);

        const when = clip.startTimeSec > startSec ? now + (clip.startTimeSec - startSec) : now;
        const passed = Math.max(0, startSec - clip.startTimeSec);
        const offset = Math.max(0, clip.offsetSec + passed);
        const playDur = Math.max(0.001, clip.durationSec - passed);

        // Real-time clip fade-in & fade-out automation
        clipGain.gain.setValueAtTime(baseGain, when);
        if (clip.fadeInSec > 0.005 && passed < clip.fadeInSec) {
          const fadeEnd = when + (clip.fadeInSec - passed);
          const startRatio = passed / clip.fadeInSec;
          clipGain.gain.setValueAtTime(baseGain * startRatio, when);
          clipGain.gain.linearRampToValueAtTime(baseGain, fadeEnd);
        }
        if (clip.fadeOutSec > 0.005) {
          const fadeStartRel = clip.durationSec - clip.fadeOutSec - passed;
          const endTime = when + playDur;
          if (fadeStartRel >= 0) {
            clipGain.gain.setValueAtTime(baseGain, when + fadeStartRel);
            clipGain.gain.linearRampToValueAtTime(0, endTime);
          } else {
            const remRatio = Math.max(0, playDur / clip.fadeOutSec);
            clipGain.gain.setValueAtTime(baseGain * remRatio, when);
            clipGain.gain.linearRampToValueAtTime(0, endTime);
          }
        }

        src.connect(clipGain);
        clipGain.connect(chain.input);
        src.start(when, offset, playDur);

        this.activeHandles.push({
          stop: () => {
            try {
              src.stop();
              src.disconnect();
            } catch {
              // ignore
            }
          },
        });
      }
    }

    this.playbackStartCtxTime = now;
    this.playbackOffsetSec = startSec;
    this.isPlayingState = true;
    this.loopActive = project.loopEnabled && project.loopEndSec > project.loopStartSec;
    this.loopStart = project.loopStartSec;
    this.loopEnd = project.loopEndSec;

    if (this.loopActive) {
      const remainingMs = Math.max(50, (this.loopEnd - startSec) * 1000);
      this.loopTimer = window.setTimeout(() => {
        if (this.isPlayingState) {
          void this.playMultitrack(project, assetMap, { startSec: this.loopStart });
        }
      }, remainingMs);
    } else if (maxEndSec > startSec) {
      const totalMs = (maxEndSec - startSec) * 1000 + 80;
      this.loopTimer = window.setTimeout(() => {
        if (this.isPlayingState) this.stop();
      }, totalMs);
    }

    this.startPositionLoop(maxEndSec);
  }

  private sampleTrackMeters(): void {
    if (this.liveTracks.size === 0) return;
    const levels: Record<string, TrackMeterLevel> = {};
    for (const [trackId, nodes] of this.liveTracks.entries()) {
      nodes.analyser.getFloatTimeDomainData(this.meterScratch);
      let peak = 0;
      let sq = 0;
      for (let i = 0; i < this.meterScratch.length; i++) {
        const s = this.meterScratch[i];
        const a = Math.abs(s);
        if (a > peak) peak = a;
        sq += s * s;
      }
      const rms = Math.sqrt(sq / this.meterScratch.length);
      levels[trackId] = {
        peakDb: linearToDb(peak),
        rmsDb: linearToDb(rms),
      };
    }
    for (const cb of this.onTrackMetersListeners) cb(levels);
  }

  private startPositionLoop(maxSec: number): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    const tick = () => {
      if (!this.isPlayingState || !this.ctx) return;
      let pos = this.playbackOffsetSec + (this.ctx.currentTime - this.playbackStartCtxTime);
      if (this.loopActive && this.loopEnd > this.loopStart && pos >= this.loopEnd) {
        const span = this.loopEnd - this.loopStart;
        pos = this.loopStart + ((pos - this.loopStart) % span);
      }
      for (const cb of this.onPositionListeners) cb(Math.min(maxSec || pos, pos));
      this.sampleTrackMeters();
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop(): void {
    this.isPlayingState = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.loopTimer !== null) {
      clearTimeout(this.loopTimer);
      this.loopTimer = null;
    }
    for (const h of this.activeHandles) h.stop();
    this.activeHandles = [];
    this.liveTracks.clear();
    this.previewWorklet = null;
    for (const cb of this.onTrackMetersListeners) cb({});
    for (const cb of this.onStopListeners) cb();
  }

  async startRecording(options: {
    deviceId?: string;
    channelMode?: 'mono-1' | 'mono-2' | 'stereo';
    inputGainDb?: number;
    monitorInput?: boolean;
    timelineStartSec?: number;
  }): Promise<void> {
    if (this.isRecordingState) return;
    const ctx = await this.ensureContext(this.sampleRate, 'interactive');

    const constraints: MediaStreamConstraints = {
      audio: {
        deviceId: options.deviceId && options.deviceId !== 'default'
          ? { exact: options.deviceId }
          : undefined,
        channelCount: options.channelMode === 'stereo' ? 2 : 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    };

    this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
    this.recSourceNode = ctx.createMediaStreamSource(this.mediaStream);
    this.recGainNode = ctx.createGain();
    this.recGainNode.gain.value = dbToLinear(options.inputGainDb ?? 0);

    this.recAnalyser = ctx.createAnalyser();
    this.recAnalyser.fftSize = 1024;

    this.recMonitorGain = ctx.createGain();
    this.recMonitorGain.gain.value = options.monitorInput ? 1 : 0;

    this.recBuffersL = [];
    this.recBuffersR = [];
    this.recStartTimeSec = options.timelineStartSec ?? 0;
    this.isRecordingState = true;

    const channels = options.channelMode === 'stereo' ? 2 : 1;
    this.recScriptNode = ctx.createScriptProcessor(2048, channels, channels);
    this.recScriptNode.onaudioprocess = (ev) => {
      if (!this.isRecordingState) return;
      const inL = ev.inputBuffer.getChannelData(0);
      this.recBuffersL.push(new Float32Array(inL));
      if (channels === 2 && ev.inputBuffer.numberOfChannels > 1) {
        const inR = ev.inputBuffer.getChannelData(1);
        this.recBuffersR.push(new Float32Array(inR));
      }
    };

    this.recSourceNode.connect(this.recGainNode);
    this.recGainNode.connect(this.recAnalyser);
    this.recGainNode.connect(this.recScriptNode);
    this.recScriptNode.connect(this.recMonitorGain);
    if (this.masterGain) this.recMonitorGain.connect(this.masterGain);
  }

  setRecordingInputGainDb(db: number): void {
    if (this.recGainNode && this.ctx) {
      this.recGainNode.gain.setTargetAtTime(dbToLinear(db), this.ctx.currentTime, 0.015);
    }
  }

  setRecordingMonitor(enabled: boolean): void {
    if (this.recMonitorGain && this.ctx) {
      this.recMonitorGain.gain.setTargetAtTime(enabled ? 1 : 0, this.ctx.currentTime, 0.015);
    }
  }

  getRecordingInputLevelDb(): number {
    if (!this.recAnalyser) return -120;
    const buf = new Float32Array(this.recAnalyser.fftSize);
    this.recAnalyser.getFloatTimeDomainData(buf);
    let peak = 0;
    for (let i = 0; i < buf.length; i++) {
      const a = Math.abs(buf[i]);
      if (a > peak) peak = a;
    }
    return linearToDb(peak);
  }

  stopRecording(): { pcm: PcmAudioData; startTimeSec: number } | null {
    if (!this.isRecordingState || !this.ctx) return null;
    this.isRecordingState = false;
    const sr = this.ctx.sampleRate;

    this.recScriptNode?.disconnect();
    this.recSourceNode?.disconnect();
    this.recGainNode?.disconnect();
    this.recMonitorGain?.disconnect();
    this.mediaStream?.getTracks().forEach((t) => t.stop());

    this.recScriptNode = null;
    this.recSourceNode = null;
    this.recGainNode = null;
    this.recMonitorGain = null;
    this.mediaStream = null;
    this.recAnalyser = null;

    const totalLen = this.recBuffersL.reduce((a, b) => a + b.length, 0);
    if (totalLen === 0) return null;

    const outL = new Float32Array(totalLen);
    let offset = 0;
    for (const chunk of this.recBuffersL) {
      outL.set(chunk, offset);
      offset += chunk.length;
    }

    const channels = [outL];
    if (this.recBuffersR.length > 0) {
      const outR = new Float32Array(totalLen);
      let offR = 0;
      for (const chunk of this.recBuffersR) {
        outR.set(chunk, offR);
        offR += chunk.length;
      }
      channels.push(outR);
    }

    this.recBuffersL = [];
    this.recBuffersR = [];
    return {
      pcm: { sampleRate: sr, channels },
      startTimeSec: this.recStartTimeSec,
    };
  }

  onMeter(cb: (m: MeteringSnapshot) => void): () => void {
    this.onMeterListeners.add(cb);
    return () => this.onMeterListeners.delete(cb);
  }

  onTrackMeters(cb: (levels: Record<string, TrackMeterLevel>) => void): () => void {
    this.onTrackMetersListeners.add(cb);
    return () => this.onTrackMetersListeners.delete(cb);
  }

  onPosition(cb: (sec: number) => void): () => void {
    this.onPositionListeners.add(cb);
    return () => this.onPositionListeners.delete(cb);
  }

  onStop(cb: () => void): () => void {
    this.onStopListeners.add(cb);
    return () => this.onStopListeners.delete(cb);
  }

  isPlaying(): boolean {
    return this.isPlayingState;
  }

  isRecording(): boolean {
    return this.isRecordingState;
  }

  async disposeContext(): Promise<void> {
    this.stop();
    if (this.ctx) {
      await this.ctx.close();
      this.ctx = null;
      this.workletNode = null;
      this.masterGain = null;
      this.masterPanNode = null;
      this.masterAnalyser = null;
    }
  }
}
