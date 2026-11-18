import type { AudioStudioApi, ImportedAudioResult } from '../main/preload';
import { decodeWavBytes, encodeWavBytes, PcmAudioData } from '../audio/dsp/pcmBuffer';
import { ExportSettings, WindowsDriverInfo, VstPluginInfo } from '../shared/types';
import type { WavHeaderInfo } from '../main/wavStreamService';
import type { UpdateCheckResult } from '../main/updaterService';

const virtualFiles = new Map<string, Uint8Array>();

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function initWebAudioStudioFallback(): void {
  if (typeof window === 'undefined' || window.audioStudio) {
    return;
  }

  const fallbackApi: AudioStudioApi = {
    selectAudioFiles: async () => {
      return new Promise<string[]>((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.accept = 'audio/*,.wav,.mp3,.ogg,.flac,.aac,.m4a';
        input.onchange = async () => {
          const files = input.files;
          if (!files || files.length === 0) {
            resolve([]);
            return;
          }
          const paths: string[] = [];
          for (let i = 0; i < files.length; i++) {
            const f = files[i];
            const p = `web://media/${Date.now()}_${f.name}`;
            const buf = new Uint8Array(await f.arrayBuffer());
            virtualFiles.set(p, buf);
            paths.push(p);
          }
          resolve(paths);
        };
        input.click();
      });
    },

    selectFolder: async () => null,

    selectSaveProjectPath: async (defaultName = 'Proyecto') => {
      return `${defaultName}.aspro`;
    },

    selectOpenProjectPath: async () => {
      return new Promise<string | null>((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.aspro,application/json';
        input.onchange = async () => {
          const file = input.files?.[0];
          if (!file) {
            resolve(null);
            return;
          }
          const p = `web://projects/${file.name}`;
          const buf = new Uint8Array(await file.arrayBuffer());
          virtualFiles.set(p, buf);
          resolve(p);
        };
        input.click();
      });
    },

    selectExportPath: async (defaultName, format) => {
      return `${defaultName}.${format.toLowerCase()}`;
    },

    importAudioFile: async (filePath: string, projectId: string, _targetSampleRate = 48000): Promise<ImportedAudioResult> => {
      const rawBytes = virtualFiles.get(filePath);
      if (!rawBytes) {
        throw new Error(`Archivo no encontrado en memoria virtual: ${filePath}`);
      }

      const actx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const copy = new Uint8Array(rawBytes.byteLength);
      copy.set(rawBytes);
      const audioBuffer = await actx.decodeAudioData(copy.buffer as ArrayBuffer);
      actx.close();

      const channels: Float32Array[] = [];
      for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
        channels.push(audioBuffer.getChannelData(c));
      }

      const pcm: PcmAudioData = {
        sampleRate: audioBuffer.sampleRate,
        channels,
      };

      const wavBytes = encodeWavBytes(pcm, 32);
      const cachedPath = `web://cache/${projectId}/${Date.now()}.wav`;
      virtualFiles.set(cachedPath, wavBytes);

      const fileName = filePath.split('/').pop() || 'audio.wav';

      return {
        originalPath: filePath,
        cachedWavPath: cachedPath,
        name: fileName,
        info: {
          duration: audioBuffer.duration,
          sampleRate: audioBuffer.sampleRate,
          channels: audioBuffer.numberOfChannels,
          bitDepth: 32,
          format: 'WAV',
          sizeBytes: wavBytes.byteLength,
        },
      };
    },

    readBinaryFile: async (filePath) => {
      const data = virtualFiles.get(filePath);
      if (!data) throw new Error(`Archivo no encontrado: ${filePath}`);
      return data;
    },

    writeBinaryFile: async (filePath, data) => {
      virtualFiles.set(filePath, data);
    },

    exportAudio: async (sourceWavBytes: Uint8Array, settings: ExportSettings) => {
      const blob = new Blob([sourceWavBytes.buffer as ArrayBuffer], { type: 'audio/wav' });
      const filename = settings.outputPath ? settings.outputPath.split(/[\/\\]/).pop() || 'AudioStudio_Export.wav' : 'AudioStudio_Export.wav';
      downloadBlob(blob, filename);
    },

    saveProject: async (project, filePath, _label) => {
      const json = JSON.stringify(project, null, 2);
      localStorage.setItem('audiostudio_last_project', json);
      const blob = new Blob([json], { type: 'application/json' });
      downloadBlob(blob, filePath.endsWith('.aspro') ? filePath : `${filePath}.aspro`);
    },

    consolidateAndSaveProject: async (project, _filePath) => {
      const json = JSON.stringify(project, null, 2);
      localStorage.setItem('audiostudio_last_project', json);
      return project;
    },

    computeWavPeaks: async (filePath: string, targetBins = 1600): Promise<{ header: WavHeaderInfo; peaks: number[] }> => {
      const bytes = virtualFiles.get(filePath);
      if (!bytes) throw new Error(`Archivo no encontrado: ${filePath}`);
      const pcm = decodeWavBytes(bytes);
      const ch = pcm.channels[0] ?? new Float32Array(0);
      const bins = Math.min(targetBins, ch.length);
      const peaks: number[] = [];
      const step = ch.length / bins;
      for (let i = 0; i < bins; i++) {
        const start = Math.floor(i * step);
        const end = Math.min(Math.floor((i + 1) * step), ch.length);
        let max = 0;
        for (let j = start; j < end; j++) {
          const v = Math.abs(ch[j]);
          if (v > max) max = v;
        }
        peaks.push(max);
      }
      return {
        header: {
          audioFormat: 3,
          numChannels: pcm.channels.length,
          sampleRate: pcm.sampleRate,
          bitDepth: 32,
          dataOffset: 44,
          dataSize: bytes.byteLength - 44,
          totalFrames: ch.length,
        },
        peaks,
      };
    },

    readWavWindow: async (filePath, startFrame, frameCount) => {
      const bytes = virtualFiles.get(filePath);
      if (!bytes) throw new Error(`Archivo no encontrado: ${filePath}`);
      const pcm = decodeWavBytes(bytes);
      return {
        sampleRate: pcm.sampleRate,
        channels: pcm.channels.map((ch) => ch.slice(startFrame, startFrame + frameCount)),
      };
    },

    autosaveProject: async (project) => {
      localStorage.setItem('audiostudio_autosave', JSON.stringify(project));
      return 'localStorage';
    },

    checkRecoveryProject: async () => {
      const saved = localStorage.getItem('audiostudio_autosave');
      if (!saved) return null;
      try {
        return JSON.parse(saved);
      } catch {
        return null;
      }
    },

    clearRecoveryProject: async () => {
      localStorage.removeItem('audiostudio_autosave');
    },

    loadProject: async (filePath) => {
      const bytes = virtualFiles.get(filePath);
      if (bytes) {
        const text = new TextDecoder().decode(bytes);
        const proj = JSON.parse(text);
        return { project: proj, versions: [] };
      }
      const saved = localStorage.getItem('audiostudio_last_project');
      if (saved) {
        return { project: JSON.parse(saved), versions: [] };
      }
      throw new Error('No se encontró proyecto para cargar.');
    },

    restoreProjectVersion: async (_filePath, _versionId) => {
      const saved = localStorage.getItem('audiostudio_last_project');
      if (!saved) throw new Error('Sin versiones');
      return JSON.parse(saved);
    },

    getRecentProjects: async () => {
      const raw = localStorage.getItem('audiostudio_recent');
      return raw ? JSON.parse(raw) : [];
    },

    getShortcuts: async () => {
      const raw = localStorage.getItem('audiostudio_shortcuts');
      return raw ? JSON.parse(raw) : ({} as any);
    },

    setShortcuts: async (map) => {
      localStorage.setItem('audiostudio_shortcuts', JSON.stringify(map));
    },

    getSetting: async (key, fallback) => {
      const v = localStorage.getItem(`setting_${key}`);
      return v ? JSON.parse(v) : fallback;
    },

    setSetting: async (key, value) => {
      localStorage.setItem(`setting_${key}`, JSON.stringify(value));
    },

    inspectAudioDrivers: async (): Promise<{ drivers: WindowsDriverInfo[]; hardwareDevices: string[] }> => ({
      drivers: [
        {
          name: 'Web Audio API (Browser WASM/AudioWorklet)',
          api: 'WASAPI',
          available: true,
          notes: 'Motor de audio web en tiempo real',
        },
      ],
      hardwareDevices: ['Audio predeterminado del navegador'],
    }),

    scanPlugins: async (): Promise<VstPluginInfo[]> => [
      {
        id: 'web-dsp-builtin',
        name: 'Audio Studio Web DSP Rack',
        vendor: 'Audio Studio Pro',
        format: 'NativeDSP',
        path: 'builtin',
        enabled: true,
      },
    ],

    logError: async (context, message) => {
      console.warn(`[WebAudioStudio] ${context}:`, message);
    },

    getErrorLogs: async () => [],

    getCachePath: async (projectId, filename) => `web://cache/${projectId}/${filename}`,

    getNativeHostStatus: async () => ({
      compiled: false,
      executablePath: '',
      running: false,
      notes: 'Modo Web (Vercel). Para soporte de plugins VST3 nativos y drivers ASIO descargue el instalador de Windows.',
    }),

    listNativeDevices: async () => ({ devices: [] }),

    processVst3: async () => {
      throw new Error('El procesamiento VST3 offline requiere la versión de escritorio para Windows.');
    },

    listOnnxModels: async () => [],
    importOnnxModel: async () => null,
    inspectOnnxModel: async () => {
      throw new Error('Inferencia ONNX offline no disponible en la versión Web.');
    },
    runOnnxWaveform: async () => {
      throw new Error('Inferencia ONNX offline no disponible en la versión Web.');
    },

    getInitialFile: async () => null,
    onOpenProjectFile: () => () => {},

    checkForUpdates: async (): Promise<UpdateCheckResult> => ({
      status: 'up-to-date',
      version: '1.0.0',
      message: 'Versión web actualizada',
    }),
    downloadUpdate: async () => {},
    installUpdate: () => {},
  };

  (window as unknown as { audioStudio: AudioStudioApi }).audioStudio = fallbackApi;
}
