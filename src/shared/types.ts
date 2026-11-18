import type { WaveformEdl } from '../audio/dsp/edl';

export type WorkspaceMode = 'waveform' | 'multitrack' | 'spectral';

export type EditTool =
  | 'select'
  | 'time-select'
  | 'razor'
  | 'move'
  | 'zoom'
  | 'envelope'
  | 'spectral-select';

export type SampleRateOption = 44100 | 48000 | 88200 | 96000;
export type BitDepthOption = 16 | 24 | 32;
export type ExportFormat = 'wav' | 'mp3' | 'flac' | 'aiff' | 'ogg' | 'm4a';

export type AudioFolderKind = 'imported' | 'recordings' | 'processed' | 'custom';

export interface MediaAsset {
  id: string;
  name: string;
  originalPath: string;
  cachedWavPath?: string;
  relativeMediaPath?: string;
  folder: AudioFolderKind;
  duration: number;
  sampleRate: number;
  channels: number;
  bitDepth: number;
  format: string;
  sizeBytes: number;
  createdAt: string;
  peaksSummary?: number[];
}

export interface AudioRegion {
  id: string;
  name: string;
  startSec: number;
  endSec: number;
  color: string;
}

export interface TimelineMarker {
  id: string;
  name: string;
  timeSec: number;
  color: string;
}

export type EqFilterType =
  | 'lowpass'
  | 'highpass'
  | 'notch'
  | 'peaking'
  | 'lowshelf'
  | 'highshelf';

export interface EqBand {
  id: string;
  enabled: boolean;
  type: EqFilterType;
  frequency: number;
  gainDb: number;
  q: number;
}

export interface GraphicEqSettings {
  enabled: boolean;
  bandsDb: number[]; // 10 bands: 31, 62, 125, 250, 500, 1k, 2k, 4k, 8k, 16k
}

export interface ParametricEqSettings {
  enabled: boolean;
  bandCount: 4 | 6 | 8;
  bands: EqBand[];
}

export interface CompressorSettings {
  enabled: boolean;
  thresholdDb: number;
  ratio: number;
  attackMs: number;
  releaseMs: number;
  kneeDb: number;
  makeupGainDb: number;
}

export interface LimiterSettings {
  enabled: boolean;
  ceilingDb: number;
  releaseMs: number;
  lookaheadMs: number;
}

export interface GateExpanderSettings {
  enabled: boolean;
  mode: 'gate' | 'expander';
  thresholdDb: number;
  ratio: number;
  attackMs: number;
  releaseMs: number;
  rangeDb: number;
}

export interface MultibandSettings {
  enabled: boolean;
  lowCrossHz: number;
  highCrossHz: number;
  lowThresholdDb: number;
  midThresholdDb: number;
  highThresholdDb: number;
  ratio: number;
  makeupDb: number;
}

export interface DeEsserSettings {
  enabled: boolean;
  frequencyHz: number;
  thresholdDb: number;
  reductionDb: number;
}

export interface ReverbSettings {
  enabled: boolean;
  roomSize: number; // 0..1
  damping: number; // 0..1
  preDelayMs: number;
  mix: number; // 0..1
}

export interface DelaySettings {
  enabled: boolean;
  mode: 'delay' | 'echo';
  timeMs: number;
  feedback: number; // 0..0.95
  mix: number; // 0..1
  pingPong: boolean;
}

export interface ModulationSettings {
  enabled: boolean;
  type: 'chorus' | 'flanger' | 'phaser' | 'tremolo' | 'vibrato';
  rateHz: number;
  depth: number; // 0..1
  mix: number; // 0..1
}

export interface SaturationSettings {
  enabled: boolean;
  mode: 'distortion' | 'saturation' | 'exciter';
  drive: number; // 0..1
  toneHz: number;
  mix: number; // 0..1
}

export interface StereoWidenerSettings {
  enabled: boolean;
  width: number; // 0..2 (1 = normal)
}

export interface PitchTempoSettings {
  enabled: boolean;
  semitones: number; // -12..12
  tempoFactor: number; // 0.5..2.0
  octaverMix: number; // 0..1
}

export interface TrackEffectRack {
  graphicEq: GraphicEqSettings;
  parametricEq: ParametricEqSettings;
  compressor: CompressorSettings;
  limiter: LimiterSettings;
  gate: GateExpanderSettings;
  multiband: MultibandSettings;
  deEsser: DeEsserSettings;
  reverb: ReverbSettings;
  delay: DelaySettings;
  modulation: ModulationSettings;
  saturation: SaturationSettings;
  widener: StereoWidenerSettings;
  pitchTempo: PitchTempoSettings;
}

export interface AutomationPoint {
  id: string;
  timeSec: number;
  value: number;
}

export type AutomationTarget = 'volume' | 'pan' | 'eq_gain' | 'reverb_mix' | 'delay_mix';

export interface AutomationLane {
  target: AutomationTarget;
  visible: boolean;
  points: AutomationPoint[];
}

export interface AudioClip {
  id: string;
  assetId: string;
  name: string;
  trackId: string;
  startTimeSec: number;
  offsetSec: number;
  durationSec: number;
  gainDb: number;
  fadeInSec: number;
  fadeOutSec: number;
  color: string;
  muted: boolean;
  locked: boolean;
}

export interface MultitrackTrack {
  id: string;
  index: number;
  name: string;
  type: 'audio' | 'aux' | 'submix';
  color: string;
  volumeDb: number;
  pan: number; // -1..1
  mute: boolean;
  solo: boolean;
  armed: boolean;
  phaseInvert: boolean;
  locked: boolean;
  groupId?: string;
  outputBusId: string; // 'master' or submix id
  auxSends: Record<string, number>; // busId -> send gain 0..1
  inputDeviceId?: string;
  inputChannelMode: 'mono-1' | 'mono-2' | 'stereo';
  effects: TrackEffectRack;
  automation: AutomationLane[];
  clips: AudioClip[];
}

export interface MasteringChain {
  eq: ParametricEqSettings;
  compressor: CompressorSettings;
  multiband: MultibandSettings;
  saturation: SaturationSettings;
  widener: StereoWidenerSettings;
  limiter: LimiterSettings;
  targetLufs: number;
  profileName: string;
}

export interface SpectralSelection {
  startSec: number;
  endSec: number;
  lowHz: number;
  highHz: number;
}

export interface RestorationOptions {
  profile:
    | 'custom'
    | 'pro-voice'
    | 'podcast'
    | 'church'
    | 'ambient'
    | 'vintage'
    | 'interview';
  noiseReductionAmount: number; // 0..1
  humFreqHz: 0 | 50 | 60;
  humHarmonics: number;
  deClickAmount: number; // 0..1
  dePopAmount: number; // 0..1
  deReverbAmount: number; // 0..1
  breathReductionAmount: number; // 0..1
  clarityAmount: number; // 0..1
}

export interface MeteringSnapshot {
  peakLeftDb: number;
  peakRightDb: number;
  rmsLeftDb: number;
  rmsRightDb: number;
  momentaryLufs: number;
  shortTermLufs: number;
  integratedLufs: number;
  truePeakDb: number;
  clipping: boolean;
  phaseCorrelation: number; // -1..1
}

export interface AudioDeviceInfo {
  deviceId: string;
  label: string;
  kind: 'audioinput' | 'audiooutput';
  groupId: string;
}

export interface WindowsDriverInfo {
  api: 'WASAPI' | 'ASIO' | 'DirectSound';
  name: string;
  available: boolean;
  notes: string;
}

export interface ShortcutMap {
  playPause: string;
  record: string;
  undo: string;
  redo: string;
  save: string;
  open: string;
  newProject: string;
  copy: string;
  paste: string;
  cut: string;
  deleteSelection: string;
  zoomIn: string;
  zoomOut: string;
  addMarker: string;
}

export interface ExportSettings {
  outputPath: string;
  format: ExportFormat;
  sampleRate: SampleRateOption;
  bitDepth: BitDepthOption;
  bitrateKbps: number;
  channels: 1 | 2;
  normalizeEnabled: boolean;
  normalizeTargetDb: number;
  masteringProfile?: string;
}

export interface StudioProject {
  id: string;
  name: string;
  filePath?: string;
  createdAt: string;
  updatedAt: string;
  sampleRate: SampleRateOption;
  bitDepth: BitDepthOption;
  bpm: number;
  timeSignature: string;
  snapToGrid: boolean;
  gridDivision: '1/4' | '1/8' | '1/16' | '1/1';
  assets: MediaAsset[];
  tracks: MultitrackTrack[];
  masterVolumeDb: number;
  masterPan: number;
  masterEffects: TrackEffectRack;
  mastering: MasteringChain;
  markers: TimelineMarker[];
  regions: AudioRegion[];
  loopEnabled: boolean;
  loopStartSec: number;
  loopEndSec: number;
  punchEnabled?: boolean;
  punchInSec?: number;
  punchOutSec?: number;
  activeAssetId?: string;
  edlMap?: Record<string, WaveformEdl>;
}

export interface VstPluginInfo {
  id: string;
  name: string;
  format: 'VST3' | 'VST2' | 'NativeDSP';
  path: string;
  vendor: string;
  enabled: boolean;
}

export interface AiAnalysisReport {
  analyzedAt: string;
  durationSec: number;
  peakDb: number;
  rmsDb: number;
  integratedLufs: number;
  estimatedNoiseFloorDb: number;
  estimatedSnrDb: number;
  clippingSampleCount: number;
  silentRegions: Array<{ startSec: number; endSec: number }>;
  humDetectedHz: 0 | 50 | 60;
  speechProbability: number; // 0..1
  spectralBalance: { lowDb: number; midDb: number; highDb: number };
  recommendations: Array<{
    id: string;
    category: 'eq' | 'dynamics' | 'restoration' | 'level' | 'voice';
    title: string;
    description: string;
    severity: 'info' | 'warning' | 'critical';
    actionId: string;
  }>;
}

export interface RecentProjectEntry {
  id: string;
  name: string;
  filePath: string;
  updatedAt: string;
  sampleRate: number;
  trackCount: number;
}
