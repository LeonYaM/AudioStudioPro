import { analyzeAudioWithAiAssistant, separateVoiceAndMusicMs } from '../dsp/aiAssistant';
import { processEffectRackPcm, processMasteringChainPcm } from '../dsp/effects';
import { renderMultitrackMixdown } from '../dsp/multitrackMixdown';
import { PcmAudioData, pitchShiftPcm, timeStretchPcm } from '../dsp/pcmBuffer';
import {
  applyDeClick,
  applyHumRemoval,
  applyRestorationPipeline,
  applySpectralNoiseReduction,
  attenuateSpectralRegion,
  computeSpectrogram,
} from '../dsp/restoration';
import {
  MasteringChain,
  RestorationOptions,
  SpectralSelection,
  StudioProject,
  TrackEffectRack,
} from '../../shared/types';

export type DspWorkerRequest =
  | { id: string; op: 'spectrogram'; pcm: PcmAudioData; fftSize?: number; cols?: number; rows?: number }
  | { id: string; op: 'spectral-attenuate'; pcm: PcmAudioData; selection: SpectralSelection; attenuationDb: number }
  | { id: string; op: 'restoration'; pcm: PcmAudioData; options: RestorationOptions }
  | { id: string; op: 'noise-clean'; pcm: PcmAudioData; amount: number }
  | { id: string; op: 'de-hum'; pcm: PcmAudioData; hz: 50 | 60; harmonics: number }
  | { id: string; op: 'de-click'; pcm: PcmAudioData; amount: number }
  | { id: string; op: 'time-stretch'; pcm: PcmAudioData; tempoFactor: number }
  | { id: string; op: 'pitch-shift'; pcm: PcmAudioData; semitones: number }
  | { id: string; op: 'effect-rack'; pcm: PcmAudioData; rack: TrackEffectRack }
  | { id: string; op: 'mastering'; pcm: PcmAudioData; chain: MasteringChain }
  | {
      id: string;
      op: 'multitrack-mixdown';
      project: StudioProject;
      assetEntries: Array<[string, PcmAudioData]>;
      applyMastering: boolean;
    }
  | { id: string; op: 'ai-analyze'; pcm: PcmAudioData }
  | { id: string; op: 'ms-separate'; pcm: PcmAudioData; mode: 'isolate-voice' | 'isolate-music' };

const workerCtx = self as unknown as {
  postMessage: (msg: unknown, transfer?: Transferable[]) => void;
  onmessage: ((e: MessageEvent<DspWorkerRequest>) => void) | null;
};

function postProgress(id: string, percent: number, stage: string): void {
  workerCtx.postMessage({ type: 'progress', id, percent, stage });
}

function collectPcmTransferables(pcm: PcmAudioData): Transferable[] {
  return pcm.channels.map((c) => c.buffer as Transferable);
}

workerCtx.onmessage = (e: MessageEvent<DspWorkerRequest>) => {
  const req = e.data;
  try {
    postProgress(req.id, 15, `Procesando (${req.op})...`);

    switch (req.op) {
      case 'spectrogram': {
        const result = computeSpectrogram(
          req.pcm,
          req.fftSize ?? 2048,
          req.cols ?? 900,
          req.rows ?? 320
        );
        postProgress(req.id, 100, 'Espectrograma completado');
        workerCtx.postMessage(
          { type: 'result', id: req.id, result },
          [result.magnitudesDb.buffer as Transferable]
        );
        return;
      }
      case 'spectral-attenuate': {
        const result = attenuateSpectralRegion(req.pcm, req.selection, req.attenuationDb);
        postProgress(req.id, 100, 'Limpieza espectral completada');
        workerCtx.postMessage({ type: 'result', id: req.id, result }, collectPcmTransferables(result));
        return;
      }
      case 'restoration': {
        const result = applyRestorationPipeline(req.pcm, req.options);
        postProgress(req.id, 100, 'Restauración completada');
        workerCtx.postMessage({ type: 'result', id: req.id, result }, collectPcmTransferables(result));
        return;
      }
      case 'noise-clean': {
        const result = applySpectralNoiseReduction(req.pcm, req.amount);
        postProgress(req.id, 100, 'Reducción de ruido completada');
        workerCtx.postMessage({ type: 'result', id: req.id, result }, collectPcmTransferables(result));
        return;
      }
      case 'de-hum': {
        const result = applyHumRemoval(req.pcm, req.hz, req.harmonics);
        postProgress(req.id, 100, 'Eliminación de zumbido completada');
        workerCtx.postMessage({ type: 'result', id: req.id, result }, collectPcmTransferables(result));
        return;
      }
      case 'de-click': {
        const result = applyDeClick(req.pcm, req.amount);
        postProgress(req.id, 100, 'Eliminación de clics completada');
        workerCtx.postMessage({ type: 'result', id: req.id, result }, collectPcmTransferables(result));
        return;
      }
      case 'time-stretch': {
        const result = timeStretchPcm(req.pcm, req.tempoFactor);
        postProgress(req.id, 100, 'Ajuste de duración WSOLA completado');
        workerCtx.postMessage({ type: 'result', id: req.id, result }, collectPcmTransferables(result));
        return;
      }
      case 'pitch-shift': {
        const result = pitchShiftPcm(req.pcm, req.semitones);
        postProgress(req.id, 100, 'Cambio de tono completado');
        workerCtx.postMessage({ type: 'result', id: req.id, result }, collectPcmTransferables(result));
        return;
      }
      case 'effect-rack': {
        const result = processEffectRackPcm(req.pcm, req.rack);
        postProgress(req.id, 100, 'Rack de efectos aplicado');
        workerCtx.postMessage({ type: 'result', id: req.id, result }, collectPcmTransferables(result));
        return;
      }
      case 'mastering': {
        const result = processMasteringChainPcm(req.pcm, req.chain);
        postProgress(req.id, 100, 'Masterización completada');
        workerCtx.postMessage({ type: 'result', id: req.id, result }, collectPcmTransferables(result));
        return;
      }
      case 'multitrack-mixdown': {
        const map = new Map<string, PcmAudioData>(req.assetEntries);
        postProgress(req.id, 45, 'Mezclando pistas, automatización y buses...');
        const result = renderMultitrackMixdown(req.project, map, {
          applyMastering: req.applyMastering,
        });
        postProgress(req.id, 100, 'Mixdown completado');
        workerCtx.postMessage({ type: 'result', id: req.id, result }, collectPcmTransferables(result));
        return;
      }
      case 'ai-analyze': {
        const result = analyzeAudioWithAiAssistant(req.pcm);
        postProgress(req.id, 100, 'Análisis AI completado');
        workerCtx.postMessage({ type: 'result', id: req.id, result });
        return;
      }
      case 'ms-separate': {
        const result = separateVoiceAndMusicMs(req.pcm, req.mode);
        postProgress(req.id, 100, 'Separación M/S completada');
        workerCtx.postMessage({ type: 'result', id: req.id, result }, collectPcmTransferables(result));
        return;
      }
    }
  } catch (err) {
    workerCtx.postMessage({
      type: 'error',
      id: req.id,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
