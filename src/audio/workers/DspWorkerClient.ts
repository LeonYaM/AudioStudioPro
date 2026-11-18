import {
  AiAnalysisReport,
  MasteringChain,
  RestorationOptions,
  SpectralSelection,
  StudioProject,
  TrackEffectRack,
} from '../../shared/types';
import { PcmAudioData } from '../dsp/pcmBuffer';
import { SpectrogramData } from '../dsp/restoration';
import type { DspWorkerRequest } from './dspWorker';

export type DspProgressCallback = (percent: number, stage: string) => void;

interface PendingJob<T> {
  resolve: (value: T) => void;
  reject: (err: Error) => void;
  onProgress?: DspProgressCallback;
}

class DspWorkerClient {
  private worker: Worker | null = null;
  private pending = new Map<string, PendingJob<unknown>>();
  private seq = 0;

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./dspWorker.ts', import.meta.url), {
        type: 'module',
      });
      this.worker.onmessage = (e: MessageEvent) => {
        const msg = e.data;
        const job = this.pending.get(msg.id);
        if (!job) return;
        if (msg.type === 'progress') {
          job.onProgress?.(msg.percent, msg.stage);
        } else if (msg.type === 'result') {
          this.pending.delete(msg.id);
          job.resolve(msg.result);
        } else if (msg.type === 'error') {
          this.pending.delete(msg.id);
          job.reject(new Error(msg.message));
        }
      };
      this.worker.onerror = (err) => {
        for (const job of this.pending.values()) {
          job.reject(new Error(err.message || 'DSP Worker error'));
        }
        this.pending.clear();
      };
    }
    return this.worker;
  }

  private run<T>(
    payloadBuilder: (id: string) => DspWorkerRequest,
    onProgress?: DspProgressCallback
  ): Promise<T> {
    const id = `job-${++this.seq}-${Date.now()}`;
    const worker = this.ensureWorker();
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        onProgress,
      });
      worker.postMessage(payloadBuilder(id));
    });
  }

  computeSpectrogram(
    pcm: PcmAudioData,
    cols = 900,
    rows = 320,
    onProgress?: DspProgressCallback
  ): Promise<SpectrogramData> {
    return this.run<SpectrogramData>(
      (id) => ({ id, op: 'spectrogram', pcm, fftSize: 2048, cols, rows }),
      onProgress
    );
  }

  attenuateSpectralRegion(
    pcm: PcmAudioData,
    selection: SpectralSelection,
    attenuationDb: number,
    onProgress?: DspProgressCallback
  ): Promise<PcmAudioData> {
    return this.run<PcmAudioData>(
      (id) => ({ id, op: 'spectral-attenuate', pcm, selection, attenuationDb }),
      onProgress
    );
  }

  applyRestoration(
    pcm: PcmAudioData,
    options: RestorationOptions,
    onProgress?: DspProgressCallback
  ): Promise<PcmAudioData> {
    return this.run<PcmAudioData>(
      (id) => ({ id, op: 'restoration', pcm, options }),
      onProgress
    );
  }

  cleanNoise(
    pcm: PcmAudioData,
    amount: number,
    onProgress?: DspProgressCallback
  ): Promise<PcmAudioData> {
    return this.run<PcmAudioData>(
      (id) => ({ id, op: 'noise-clean', pcm, amount }),
      onProgress
    );
  }

  removeHum(
    pcm: PcmAudioData,
    hz: 50 | 60,
    harmonics = 4,
    onProgress?: DspProgressCallback
  ): Promise<PcmAudioData> {
    return this.run<PcmAudioData>(
      (id) => ({ id, op: 'de-hum', pcm, hz, harmonics }),
      onProgress
    );
  }

  deClick(
    pcm: PcmAudioData,
    amount = 0.7,
    onProgress?: DspProgressCallback
  ): Promise<PcmAudioData> {
    return this.run<PcmAudioData>(
      (id) => ({ id, op: 'de-click', pcm, amount }),
      onProgress
    );
  }

  timeStretch(
    pcm: PcmAudioData,
    tempoFactor: number,
    onProgress?: DspProgressCallback
  ): Promise<PcmAudioData> {
    return this.run<PcmAudioData>(
      (id) => ({ id, op: 'time-stretch', pcm, tempoFactor }),
      onProgress
    );
  }

  pitchShift(
    pcm: PcmAudioData,
    semitones: number,
    onProgress?: DspProgressCallback
  ): Promise<PcmAudioData> {
    return this.run<PcmAudioData>(
      (id) => ({ id, op: 'pitch-shift', pcm, semitones }),
      onProgress
    );
  }

  processEffectRack(
    pcm: PcmAudioData,
    rack: TrackEffectRack,
    onProgress?: DspProgressCallback
  ): Promise<PcmAudioData> {
    return this.run<PcmAudioData>(
      (id) => ({ id, op: 'effect-rack', pcm, rack }),
      onProgress
    );
  }

  processMastering(
    pcm: PcmAudioData,
    chain: MasteringChain,
    onProgress?: DspProgressCallback
  ): Promise<PcmAudioData> {
    return this.run<PcmAudioData>(
      (id) => ({ id, op: 'mastering', pcm, chain }),
      onProgress
    );
  }

  renderMultitrackMixdown(
    project: StudioProject,
    assetMap: Map<string, PcmAudioData>,
    applyMastering: boolean,
    onProgress?: DspProgressCallback
  ): Promise<PcmAudioData> {
    return this.run<PcmAudioData>(
      (id) => ({
        id,
        op: 'multitrack-mixdown',
        project,
        assetEntries: Array.from(assetMap.entries()),
        applyMastering,
      }),
      onProgress
    );
  }

  analyzeAi(
    pcm: PcmAudioData,
    onProgress?: DspProgressCallback
  ): Promise<AiAnalysisReport> {
    return this.run<AiAnalysisReport>(
      (id) => ({ id, op: 'ai-analyze', pcm }),
      onProgress
    );
  }

  separateMs(
    pcm: PcmAudioData,
    mode: 'isolate-voice' | 'isolate-music',
    onProgress?: DspProgressCallback
  ): Promise<PcmAudioData> {
    return this.run<PcmAudioData>(
      (id) => ({ id, op: 'ms-separate', pcm, mode }),
      onProgress
    );
  }
}

export const dspWorker = new DspWorkerClient();
