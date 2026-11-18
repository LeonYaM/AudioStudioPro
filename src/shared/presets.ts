import {
  EqBand,
  MasteringChain,
  MultitrackTrack,
  RestorationOptions,
  ShortcutMap,
  StudioProject,
  TrackEffectRack,
} from './types';

export const GRAPHIC_EQ_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export function createDefaultEqBands(count: 4 | 6 | 8 = 6): EqBand[] {
  const freqs =
    count === 4
      ? [80, 320, 2400, 10000]
      : count === 6
      ? [60, 180, 600, 2000, 5500, 12000]
      : [40, 100, 250, 600, 1500, 3500, 7500, 14000];
  return freqs.map((frequency, i) => ({
    id: `band-${i + 1}`,
    enabled: true,
    type: i === 0 ? 'highpass' : i === freqs.length - 1 ? 'highshelf' : 'peaking',
    frequency: i === 0 ? 30 : frequency,
    gainDb: 0,
    q: i === 0 || i === freqs.length - 1 ? 0.71 : 1.4,
  }));
}

export function createDefaultEffectRack(): TrackEffectRack {
  return {
    graphicEq: { enabled: false, bandsDb: new Array(10).fill(0) },
    parametricEq: { enabled: false, bandCount: 6, bands: createDefaultEqBands(6) },
    compressor: {
      enabled: false,
      thresholdDb: -18,
      ratio: 3,
      attackMs: 10,
      releaseMs: 120,
      kneeDb: 4,
      makeupGainDb: 0,
    },
    limiter: { enabled: false, ceilingDb: -1, releaseMs: 60, lookaheadMs: 2 },
    gate: {
      enabled: false,
      mode: 'gate',
      thresholdDb: -48,
      ratio: 4,
      attackMs: 5,
      releaseMs: 120,
      rangeDb: -60,
    },
    multiband: {
      enabled: false,
      lowCrossHz: 220,
      highCrossHz: 3200,
      lowThresholdDb: -20,
      midThresholdDb: -18,
      highThresholdDb: -20,
      ratio: 2.5,
      makeupDb: 0,
    },
    deEsser: { enabled: false, frequencyHz: 6500, thresholdDb: -22, reductionDb: 6 },
    reverb: { enabled: false, roomSize: 0.45, damping: 0.4, preDelayMs: 18, mix: 0.2 },
    delay: { enabled: false, mode: 'delay', timeMs: 320, feedback: 0.35, mix: 0.22, pingPong: true },
    modulation: { enabled: false, type: 'chorus', rateHz: 1.2, depth: 0.35, mix: 0.25 },
    saturation: { enabled: false, mode: 'saturation', drive: 0.2, toneHz: 8000, mix: 0.3 },
    widener: { enabled: false, width: 1.0 },
    pitchTempo: { enabled: false, semitones: 0, tempoFactor: 1.0, octaverMix: 0 },
  };
}

export const TRACK_COLORS = [
  '#00a8e8',
  '#00c49a',
  '#3a86ff',
  '#8338ec',
  '#ffbe0b',
  '#fb5607',
  '#ff006e',
  '#2ec4b6',
];

export function createTrack(
  index: number,
  type: 'audio' | 'aux' | 'submix' = 'audio',
  name?: string
): MultitrackTrack {
  const id =
    type === 'aux'
      ? `aux-${index}`
      : type === 'submix'
      ? `submix-${index}`
      : `track-${index}`;
  return {
    id,
    index,
    name:
      name ??
      (type === 'aux'
        ? `Aux ${index}`
        : type === 'submix'
        ? `Subgrupo ${index}`
        : `Pista ${index}`),
    type,
    color:
      type === 'aux'
        ? '#f59e0b'
        : type === 'submix'
        ? '#8b5cf6'
        : TRACK_COLORS[(index - 1) % TRACK_COLORS.length],
    volumeDb: 0,
    pan: 0,
    mute: false,
    solo: false,
    armed: false,
    phaseInvert: false,
    locked: false,
    outputBusId: 'master',
    auxSends: { 'aux-1': 0, 'aux-2': 0 },
    inputChannelMode: 'stereo',
    effects: createDefaultEffectRack(),
    automation: [
      { target: 'volume', visible: false, points: [] },
      { target: 'pan', visible: false, points: [] },
      { target: 'eq_gain', visible: false, points: [] },
      { target: 'reverb_mix', visible: false, points: [] },
      { target: 'delay_mix', visible: false, points: [] },
    ],
    clips: [],
  };
}

export function createDefaultMasteringChain(profileName = 'Streaming (-14 LUFS)'): MasteringChain {
  const profile = MASTERING_PROFILES[profileName] ?? MASTERING_PROFILES['Streaming (-14 LUFS)'];
  return JSON.parse(JSON.stringify(profile));
}

export function createInitialProject(name = 'Proyecto Nuevo'): StudioProject {
  const now = new Date().toISOString();
  const tracks: MultitrackTrack[] = [];
  for (let i = 1; i <= 32; i++) {
    tracks.push(createTrack(i, 'audio'));
  }
  tracks.push(createTrack(1, 'aux', 'Aux 1 (Reverb)'));
  tracks.push(createTrack(2, 'aux', 'Aux 2 (Delay)'));
  tracks.push(createTrack(1, 'submix', 'Subgrupo Voces'));
  tracks.push(createTrack(2, 'submix', 'Subgrupo Instrumentos'));

  // Pre-configure Aux 1 and Aux 2 effects
  const aux1 = tracks.find((t) => t.id === 'aux-1');
  if (aux1) {
    aux1.effects.reverb = { enabled: true, roomSize: 0.65, damping: 0.45, preDelayMs: 22, mix: 1.0 };
  }
  const aux2 = tracks.find((t) => t.id === 'aux-2');
  if (aux2) {
    aux2.effects.delay = {
      enabled: true,
      mode: 'delay',
      timeMs: 360,
      feedback: 0.35,
      mix: 1.0,
      pingPong: true,
    };
  }

  return {
    id: `proj-${Date.now()}`,
    name,
    createdAt: now,
    updatedAt: now,
    sampleRate: 48000,
    bitDepth: 24,
    bpm: 120,
    timeSignature: '4/4',
    snapToGrid: true,
    gridDivision: '1/4',
    assets: [],
    tracks,
    masterVolumeDb: 0,
    masterPan: 0,
    masterEffects: createDefaultEffectRack(),
    mastering: createDefaultMasteringChain(),
    markers: [],
    regions: [],
    loopEnabled: false,
    loopStartSec: 0,
    loopEndSec: 8,
    punchEnabled: false,
    punchInSec: 2,
    punchOutSec: 6,
  };
}

export const RESTORATION_PROFILES: Record<RestorationOptions['profile'], RestorationOptions> = {
  custom: {
    profile: 'custom',
    noiseReductionAmount: 0.35,
    humFreqHz: 0,
    humHarmonics: 3,
    deClickAmount: 0.25,
    dePopAmount: 0.2,
    deReverbAmount: 0,
    breathReductionAmount: 0,
    clarityAmount: 0.15,
  },
  'pro-voice': {
    profile: 'pro-voice',
    noiseReductionAmount: 0.45,
    humFreqHz: 60,
    humHarmonics: 3,
    deClickAmount: 0.4,
    dePopAmount: 0.45,
    deReverbAmount: 0.25,
    breathReductionAmount: 0.35,
    clarityAmount: 0.35,
  },
  podcast: {
    profile: 'podcast',
    noiseReductionAmount: 0.55,
    humFreqHz: 60,
    humHarmonics: 3,
    deClickAmount: 0.45,
    dePopAmount: 0.5,
    deReverbAmount: 0.35,
    breathReductionAmount: 0.4,
    clarityAmount: 0.4,
  },
  church: {
    profile: 'church',
    noiseReductionAmount: 0.5,
    humFreqHz: 50,
    humHarmonics: 4,
    deClickAmount: 0.3,
    dePopAmount: 0.35,
    deReverbAmount: 0.65,
    breathReductionAmount: 0.2,
    clarityAmount: 0.5,
  },
  ambient: {
    profile: 'ambient',
    noiseReductionAmount: 0.72,
    humFreqHz: 60,
    humHarmonics: 4,
    deClickAmount: 0.35,
    dePopAmount: 0.25,
    deReverbAmount: 0.2,
    breathReductionAmount: 0,
    clarityAmount: 0.25,
  },
  vintage: {
    profile: 'vintage',
    noiseReductionAmount: 0.65,
    humFreqHz: 50,
    humHarmonics: 5,
    deClickAmount: 0.8,
    dePopAmount: 0.5,
    deReverbAmount: 0.15,
    breathReductionAmount: 0,
    clarityAmount: 0.45,
  },
  interview: {
    profile: 'interview',
    noiseReductionAmount: 0.6,
    humFreqHz: 60,
    humHarmonics: 3,
    deClickAmount: 0.35,
    dePopAmount: 0.4,
    deReverbAmount: 0.45,
    breathReductionAmount: 0.25,
    clarityAmount: 0.48,
  },
};

export interface VoicePreset {
  id: string;
  name: string;
  description: string;
  rack: Partial<TrackEffectRack>;
  restoration: RestorationOptions;
}

function voiceEq(lowCut: number, mudCutDb: number, presenceDb: number, airDb: number) {
  return {
    enabled: true,
    bandCount: 6 as const,
    bands: [
      { id: 'v1', enabled: true, type: 'highpass' as const, frequency: lowCut, gainDb: 0, q: 0.71 },
      { id: 'v2', enabled: true, type: 'peaking' as const, frequency: 180, gainDb: 1.5, q: 1.1 },
      { id: 'v3', enabled: true, type: 'peaking' as const, frequency: 380, gainDb: mudCutDb, q: 1.5 },
      { id: 'v4', enabled: true, type: 'peaking' as const, frequency: 2800, gainDb: presenceDb, q: 1.2 },
      { id: 'v5', enabled: true, type: 'peaking' as const, frequency: 5500, gainDb: presenceDb * 0.5, q: 1.4 },
      { id: 'v6', enabled: true, type: 'highshelf' as const, frequency: 10500, gainDb: airDb, q: 0.71 },
    ],
  };
}

export const VOICE_PRESETS: VoicePreset[] = [
  {
    id: 'radio',
    name: 'Locución radial',
    description: 'Cuerpo grave firme, compresión broadcast y presencia clara',
    rack: {
      parametricEq: voiceEq(80, -3, 3.5, 2.5),
      compressor: { enabled: true, thresholdDb: -20, ratio: 4.5, attackMs: 6, releaseMs: 90, kneeDb: 3, makeupGainDb: 4 },
      deEsser: { enabled: true, frequencyHz: 6400, thresholdDb: -22, reductionDb: 6 },
      limiter: { enabled: true, ceilingDb: -1, releaseMs: 50, lookaheadMs: 2 },
    },
    restoration: RESTORATION_PROFILES['pro-voice'],
  },
  {
    id: 'podcast',
    name: 'Podcast',
    description: 'Conversación limpia, control de respiración y nivel consistente',
    rack: {
      parametricEq: voiceEq(90, -2.5, 2.5, 1.5),
      compressor: { enabled: true, thresholdDb: -18, ratio: 3.2, attackMs: 12, releaseMs: 130, kneeDb: 4, makeupGainDb: 3 },
      deEsser: { enabled: true, frequencyHz: 6800, thresholdDb: -24, reductionDb: 5 },
      gate: { enabled: true, mode: 'expander', thresholdDb: -46, ratio: 2.5, attackMs: 8, releaseMs: 140, rangeDb: -24 },
    },
    restoration: RESTORATION_PROFILES.podcast,
  },
  {
    id: 'male-voice',
    name: 'Voz masculina',
    description: 'Calidez en 120-160 Hz con recorte de turbidez y claridad vocal',
    rack: {
      parametricEq: voiceEq(75, -3.5, 3, 2),
      compressor: { enabled: true, thresholdDb: -18, ratio: 3.5, attackMs: 10, releaseMs: 110, kneeDb: 4, makeupGainDb: 3 },
      deEsser: { enabled: true, frequencyHz: 6000, thresholdDb: -22, reductionDb: 5 },
    },
    restoration: RESTORATION_PROFILES['pro-voice'],
  },
  {
    id: 'female-voice',
    name: 'Voz femenina',
    description: 'Brillo sedoso, control de sibilancia y articulación definida',
    rack: {
      parametricEq: voiceEq(105, -2, 2.5, 3),
      compressor: { enabled: true, thresholdDb: -19, ratio: 3.2, attackMs: 10, releaseMs: 100, kneeDb: 4, makeupGainDb: 3 },
      deEsser: { enabled: true, frequencyHz: 7200, thresholdDb: -24, reductionDb: 7 },
    },
    restoration: RESTORATION_PROFILES['pro-voice'],
  },
  {
    id: 'narration',
    name: 'Narración',
    description: 'Dinámica natural para audiolibros y documentales',
    rack: {
      parametricEq: voiceEq(80, -2, 2, 1.5),
      compressor: { enabled: true, thresholdDb: -22, ratio: 2.4, attackMs: 18, releaseMs: 160, kneeDb: 6, makeupGainDb: 2.5 },
      deEsser: { enabled: true, frequencyHz: 6800, thresholdDb: -24, reductionDb: 4 },
    },
    restoration: RESTORATION_PROFILES['pro-voice'],
  },
  {
    id: 'preaching',
    name: 'Voz de predicación',
    description: 'Reducción de reverberación de sala, control de picos e inteligibilidad',
    rack: {
      parametricEq: voiceEq(100, -4, 4, 2),
      compressor: { enabled: true, thresholdDb: -20, ratio: 4, attackMs: 8, releaseMs: 120, kneeDb: 4, makeupGainDb: 4 },
      deEsser: { enabled: true, frequencyHz: 6500, thresholdDb: -21, reductionDb: 6 },
      limiter: { enabled: true, ceilingDb: -1, releaseMs: 60, lookaheadMs: 2 },
    },
    restoration: RESTORATION_PROFILES.church,
  },
  {
    id: 'christian-music-vocal',
    name: 'Voz para música cristiana',
    description: 'Presencia cálida, aire cristalino, reverb espacial y delay sutil',
    rack: {
      parametricEq: voiceEq(95, -3, 3.5, 3.5),
      compressor: { enabled: true, thresholdDb: -18, ratio: 3.8, attackMs: 8, releaseMs: 100, kneeDb: 4, makeupGainDb: 3.5 },
      deEsser: { enabled: true, frequencyHz: 6800, thresholdDb: -22, reductionDb: 6 },
      reverb: { enabled: true, roomSize: 0.58, damping: 0.42, preDelayMs: 28, mix: 0.22 },
      delay: { enabled: true, mode: 'delay', timeMs: 380, feedback: 0.25, mix: 0.12, pingPong: true },
    },
    restoration: RESTORATION_PROFILES['pro-voice'],
  },
  {
    id: 'studio-vocal',
    name: 'Voz de estudio',
    description: 'Cadena limpia de referencia con excitación armónica sutil',
    rack: {
      parametricEq: voiceEq(85, -2.5, 2.8, 3),
      compressor: { enabled: true, thresholdDb: -17, ratio: 3.5, attackMs: 9, releaseMs: 105, kneeDb: 4, makeupGainDb: 3 },
      deEsser: { enabled: true, frequencyHz: 6600, thresholdDb: -23, reductionDb: 5 },
      saturation: { enabled: true, mode: 'exciter', drive: 0.18, toneHz: 8500, mix: 0.2 },
    },
    restoration: RESTORATION_PROFILES['pro-voice'],
  },
];

function makeMasterProfile(
  profileName: string,
  targetLufs: number,
  ceilingDb: number,
  airDb: number,
  width: number
): MasteringChain {
  return {
    profileName,
    targetLufs,
    eq: {
      enabled: true,
      bandCount: 6,
      bands: [
        { id: 'm1', enabled: true, type: 'highpass', frequency: 28, gainDb: 0, q: 0.71 },
        { id: 'm2', enabled: true, type: 'lowshelf', frequency: 90, gainDb: 0.8, q: 0.71 },
        { id: 'm3', enabled: true, type: 'peaking', frequency: 320, gainDb: -0.8, q: 1.2 },
        { id: 'm4', enabled: true, type: 'peaking', frequency: 2400, gainDb: 0.8, q: 1.1 },
        { id: 'm5', enabled: true, type: 'highshelf', frequency: 11000, gainDb: airDb, q: 0.71 },
        { id: 'm6', enabled: true, type: 'lowpass', frequency: 20000, gainDb: 0, q: 0.71 },
      ],
    },
    compressor: {
      enabled: true,
      thresholdDb: -14,
      ratio: 2.0,
      attackMs: 25,
      releaseMs: 180,
      kneeDb: 6,
      makeupGainDb: 1.5,
    },
    multiband: {
      enabled: true,
      lowCrossHz: 180,
      highCrossHz: 3400,
      lowThresholdDb: -18,
      midThresholdDb: -16,
      highThresholdDb: -18,
      ratio: 2.0,
      makeupDb: 0.5,
    },
    saturation: { enabled: true, mode: 'saturation', drive: 0.12, toneHz: 10000, mix: 0.18 },
    widener: { enabled: true, width },
    limiter: { enabled: true, ceilingDb, releaseMs: 60, lookaheadMs: 2 },
  };
}

export const MASTERING_PROFILES: Record<string, MasteringChain> = {
  'Streaming (-14 LUFS)': makeMasterProfile('Streaming (-14 LUFS)', -14, -1.0, 1.2, 1.08),
  'CD (-9 LUFS)': makeMasterProfile('CD (-9 LUFS)', -9, -0.3, 1.5, 1.1),
  'YouTube (-14 LUFS)': makeMasterProfile('YouTube (-14 LUFS)', -14, -1.0, 1.4, 1.08),
  'Podcast (-16 LUFS)': makeMasterProfile('Podcast (-16 LUFS)', -16, -1.5, 1.0, 1.0),
  'Radio (-11 LUFS)': makeMasterProfile('Radio (-11 LUFS)', -11, -0.8, 1.8, 1.12),
  'Audio Alta Resolución (-14 LUFS)': makeMasterProfile('Audio Alta Resolución (-14 LUFS)', -14, -1.0, 0.8, 1.05),
};

export const DEFAULT_SHORTCUTS: ShortcutMap = {
  playPause: 'Space',
  record: 'KeyR',
  undo: 'Ctrl+KeyZ',
  redo: 'Ctrl+KeyY',
  save: 'Ctrl+KeyS',
  open: 'Ctrl+KeyO',
  newProject: 'Ctrl+KeyN',
  copy: 'Ctrl+KeyC',
  paste: 'Ctrl+KeyV',
  cut: 'Ctrl+KeyX',
  deleteSelection: 'Delete',
  zoomIn: 'Equal',
  zoomOut: 'Minus',
  addMarker: 'KeyM',
};
