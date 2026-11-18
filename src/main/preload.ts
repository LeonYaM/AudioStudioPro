import { contextBridge, ipcRenderer } from 'electron';
import {
  ExportSettings,
  RecentProjectEntry,
  ShortcutMap,
  StudioProject,
  WindowsDriverInfo,
  VstPluginInfo,
} from '../shared/types';
import { ProbedMediaInfo } from './ffmpegService';
import type { NativeHostStatus } from './nativeHostService';
import type { OnnxModelInfo, OnnxModelInspection } from './onnxAiService';
import type { UpdateCheckResult } from './updaterService';
import type { WavHeaderInfo } from './wavStreamService';
import type { PcmAudioData } from '../audio/dsp/pcmBuffer';

export interface ImportedAudioResult {
  originalPath: string;
  cachedWavPath: string;
  name: string;
  info: ProbedMediaInfo;
}

export interface AudioStudioApi {
  selectAudioFiles: () => Promise<string[]>;
  selectFolder: () => Promise<string | null>;
  selectSaveProjectPath: (defaultName: string) => Promise<string | null>;
  selectOpenProjectPath: () => Promise<string | null>;
  selectExportPath: (defaultName: string, format: string) => Promise<string | null>;
  importAudioFile: (
    filePath: string,
    projectId: string,
    targetSampleRate?: number
  ) => Promise<ImportedAudioResult>;
  readBinaryFile: (filePath: string) => Promise<Uint8Array>;
  writeBinaryFile: (filePath: string, data: Uint8Array) => Promise<void>;
  exportAudio: (sourceWavBytes: Uint8Array, settings: ExportSettings) => Promise<void>;
  saveProject: (
    project: StudioProject,
    filePath: string,
    label?: string
  ) => Promise<void>;
  consolidateAndSaveProject: (
    project: StudioProject,
    filePath: string
  ) => Promise<StudioProject>;
  computeWavPeaks: (
    filePath: string,
    targetBins?: number
  ) => Promise<{ header: WavHeaderInfo; peaks: number[] }>;
  readWavWindow: (
    filePath: string,
    startFrame: number,
    frameCount: number
  ) => Promise<PcmAudioData>;
  autosaveProject: (project: StudioProject) => Promise<string>;
  checkRecoveryProject: () => Promise<StudioProject | null>;
  clearRecoveryProject: () => Promise<void>;
  loadProject: (filePath: string) => Promise<{
    project: StudioProject;
    versions: Array<{ versionId: number; savedAt: string; label: string }>;
  }>;
  restoreProjectVersion: (filePath: string, versionId: number) => Promise<StudioProject>;
  getRecentProjects: () => Promise<RecentProjectEntry[]>;
  getShortcuts: () => Promise<ShortcutMap>;
  setShortcuts: (map: ShortcutMap) => Promise<void>;
  getSetting: <T>(key: string, fallback: T) => Promise<T>;
  setSetting: <T>(key: string, value: T) => Promise<void>;
  inspectAudioDrivers: () => Promise<{
    drivers: WindowsDriverInfo[];
    hardwareDevices: string[];
  }>;
  scanPlugins: (extraFolders?: string[]) => Promise<VstPluginInfo[]>;
  logError: (context: string, message: string) => Promise<void>;
  getErrorLogs: () => Promise<Array<{ createdAt: string; context: string; message: string }>>;
  getCachePath: (projectId: string, filename: string) => Promise<string>;
  getNativeHostStatus: () => Promise<NativeHostStatus>;
  listNativeDevices: () => Promise<Record<string, unknown>>;
  processVst3: (pluginPath: string, inputWav: string, outputWav: string) => Promise<Record<string, unknown>>;
  listOnnxModels: () => Promise<OnnxModelInfo[]>;
  importOnnxModel: () => Promise<OnnxModelInfo | null>;
  inspectOnnxModel: (modelPath: string) => Promise<OnnxModelInspection>;
  runOnnxWaveform: (modelPath: string, samples: Float32Array) => Promise<Float32Array>;
  getInitialFile: () => Promise<string | null>;
  onOpenProjectFile: (callback: (filePath: string) => void) => () => void;
  checkForUpdates: () => Promise<UpdateCheckResult>;
  downloadUpdate: () => Promise<void>;
  installUpdate: () => void;
}

const api: AudioStudioApi = {
  selectAudioFiles: () => ipcRenderer.invoke('dialog:openAudioFiles'),
  selectFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  selectSaveProjectPath: (defaultName) =>
    ipcRenderer.invoke('dialog:saveProject', defaultName),
  selectOpenProjectPath: () => ipcRenderer.invoke('dialog:openProject'),
  selectExportPath: (defaultName, format) =>
    ipcRenderer.invoke('dialog:exportAudio', defaultName, format),
  importAudioFile: (filePath, projectId, targetSampleRate) =>
    ipcRenderer.invoke('audio:import', filePath, projectId, targetSampleRate),
  readBinaryFile: (filePath) => ipcRenderer.invoke('fs:readBinary', filePath),
  writeBinaryFile: (filePath, data) => ipcRenderer.invoke('fs:writeBinary', filePath, data),
  exportAudio: (sourceWavBytes, settings) =>
    ipcRenderer.invoke('audio:export', sourceWavBytes, settings),
  saveProject: (project, filePath, label) =>
    ipcRenderer.invoke('project:save', project, filePath, label),
  consolidateAndSaveProject: (project, filePath) =>
    ipcRenderer.invoke('project:consolidateAndSave', project, filePath),
  computeWavPeaks: (filePath, targetBins) =>
    ipcRenderer.invoke('wav:computePeaks', filePath, targetBins),
  readWavWindow: (filePath, startFrame, frameCount) =>
    ipcRenderer.invoke('wav:readWindow', filePath, startFrame, frameCount),
  autosaveProject: (project) => ipcRenderer.invoke('project:autosave', project),
  checkRecoveryProject: () => ipcRenderer.invoke('project:checkRecovery'),
  clearRecoveryProject: () => ipcRenderer.invoke('project:clearRecovery'),
  loadProject: (filePath) => ipcRenderer.invoke('project:load', filePath),
  restoreProjectVersion: (filePath, versionId) =>
    ipcRenderer.invoke('project:restoreVersion', filePath, versionId),
  getRecentProjects: () => ipcRenderer.invoke('project:recent'),
  getShortcuts: () => ipcRenderer.invoke('settings:getShortcuts'),
  setShortcuts: (map) => ipcRenderer.invoke('settings:setShortcuts', map),
  getSetting: (key, fallback) => ipcRenderer.invoke('settings:get', key, fallback),
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', key, value),
  inspectAudioDrivers: () => ipcRenderer.invoke('audio:inspectDrivers'),
  scanPlugins: (extraFolders) => ipcRenderer.invoke('plugins:scan', extraFolders),
  logError: (context, message) => ipcRenderer.invoke('logs:error', context, message),
  getErrorLogs: () => ipcRenderer.invoke('logs:get'),
  getCachePath: (projectId, filename) =>
    ipcRenderer.invoke('fs:getCachePath', projectId, filename),
  getNativeHostStatus: () => ipcRenderer.invoke('nativeHost:status'),
  listNativeDevices: () => ipcRenderer.invoke('nativeHost:listDevices'),
  processVst3: (pluginPath, inputWav, outputWav) =>
    ipcRenderer.invoke('nativeHost:processVst3', pluginPath, inputWav, outputWav),
  listOnnxModels: () => ipcRenderer.invoke('onnx:listModels'),
  importOnnxModel: () => ipcRenderer.invoke('onnx:importModel'),
  inspectOnnxModel: (modelPath) => ipcRenderer.invoke('onnx:inspectModel', modelPath),
  runOnnxWaveform: (modelPath, samples) =>
    ipcRenderer.invoke('onnx:runWaveform', modelPath, samples),
  getInitialFile: () => ipcRenderer.invoke('app:getInitialFile'),
  onOpenProjectFile: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, filePath: string) => callback(filePath);
    ipcRenderer.on('project:openFile', handler);
    return () => {
      ipcRenderer.removeListener('project:openFile', handler);
    };
  },
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  downloadUpdate: () => ipcRenderer.invoke('updater:download'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
};

contextBridge.exposeInMainWorld('audioStudio', api);
