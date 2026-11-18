import React, { useCallback, useEffect, useRef, useState } from 'react';
import { applyParametricEqPcm } from '../audio/dsp/biquad';
import { applyCompressorPcm } from '../audio/dsp/dynamics';
import { normalizeToLufs } from '../audio/dsp/metering';
import { autoBalanceTracks, renderMultitrackMixdown } from '../audio/dsp/multitrackMixdown';
import {
  WaveformEdl,
  createInitialEdl,
  materializeEdl,
} from '../audio/dsp/edl';
import {
  PcmAudioData,
  applyGainPcm,
  changeSpeedPcm,
  crossfadeJoinPcm,
  decodeWavBytes,
  deleteRangePcm,
  detectPeaksPcm,
  encodeWavBytes,
  fadePcm,
  getDurationSec,
  getFrameCount,
  insertPcm,
  invertPhasePcm,
  normalizePcm,
  reversePcm,
  silenceRangePcm,
  slicePcm,
  splitPcm,
  stripSilencePcm,
  trimPcm,
} from '../audio/dsp/pcmBuffer';
import { AudioEngine, LatencyMode, TrackMeterLevel } from '../audio/engine/AudioEngine';
import { dspWorker } from '../audio/workers/DspWorkerClient';
import {
  DEFAULT_SHORTCUTS,
  RESTORATION_PROFILES,
  VOICE_PRESETS,
  createInitialProject,
  createTrack,
} from '../shared/presets';
import {
  AudioDeviceInfo,
  BitDepthOption,
  EditTool,
  ExportSettings,
  MediaAsset,
  MeteringSnapshot,
  MultitrackTrack,
  RecentProjectEntry,
  SampleRateOption,
  ShortcutMap,
  SpectralSelection,
  StudioProject,
  TrackEffectRack,
  WorkspaceMode,
} from '../shared/types';
import { AiAssistantModal } from './components/AiAssistantModal';
import { EffectsRestorationModal } from './components/EffectsRestorationModal';
import { ExportModal } from './components/ExportModal';
import { MasteringModal } from './components/MasteringModal';
import { MixerPanel } from './components/MixerPanel';
import { MultitrackEditor } from './components/MultitrackEditor';
import { PreferencesModal } from './components/PreferencesModal';
import { ProjectPanel } from './components/ProjectPanel';
import { SpectralEditor } from './components/SpectralEditor';
import { ToolBar } from './components/ToolBar';
import { TopMenuBar } from './components/TopMenuBar';
import { TransportFooter } from './components/TransportFooter';
import { WaveformAction, WaveformEditor } from './components/WaveformEditor';
import { WelcomeModal } from './components/WelcomeModal';

interface UndoSnapshot {
  project: StudioProject;
  label: string;
}

const INITIAL_METER: MeteringSnapshot = {
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

export const App: React.FC = () => {
  const engineRef = useRef<AudioEngine | null>(null);
  if (!engineRef.current) engineRef.current = new AudioEngine();
  const engine = engineRef.current;

  const [project, setProject] = useState<StudioProject>(() => createInitialProject());
  const [assetPcms, setAssetPcms] = useState<Map<string, PcmAudioData>>(() => new Map());
  const [undoStack, setUndoStack] = useState<UndoSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<UndoSnapshot[]>([]);
  const [historyLog, setHistoryLog] = useState<string[]>([]);

  const [workspace, setWorkspace] = useState<WorkspaceMode>('waveform');
  const [activeTool, setActiveTool] = useState<EditTool>('select');
  const [showMixer, setShowMixer] = useState(true);
  const [showProjectPanel, setShowProjectPanel] = useState(true);
  const [selectedTrackId, setSelectedTrackId] = useState('track-1');
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);

  const [cursorSec, setCursorSec] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [selection, setSelection] = useState<{ startSec: number; endSec: number } | null>(null);
  const [clipboardPcm, setClipboardPcm] = useState<PcmAudioData | null>(null);
  const [detectedPeaks, setDetectedPeaks] = useState<Array<{ timeSec: number; db: number }>>([]);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [meter, setMeter] = useState<MeteringSnapshot>(INITIAL_METER);
  const [trackMeters, setTrackMeters] = useState<Record<string, TrackMeterLevel>>({});
  const [workerProgress, setWorkerProgress] = useState<{ percent: number; stage: string } | null>(null);
  const [inputLevelDb, setInputLevelDb] = useState(-120);
  const [countdownRemaining, setCountdownRemaining] = useState<number | null>(null);

  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [latencyMode, setLatencyMode] = useState<LatencyMode>('interactive');
  const [softClipEnabled, setSoftClipEnabled] = useState(true);
  const [devices, setDevices] = useState<AudioDeviceInfo[]>([]);
  const [inputDeviceId, setInputDeviceId] = useState('default');
  const [outputDeviceId, setOutputDeviceId] = useState('default');
  const [inputGainDb, setInputGainDb] = useState(0);
  const [monitorInput, setMonitorInput] = useState(false);
  const [countdownSec, setCountdownSec] = useState(0);
  const [shortcuts, setShortcuts] = useState<ShortcutMap>(DEFAULT_SHORTCUTS);
  const [recentProjects, setRecentProjects] = useState<RecentProjectEntry[]>([]);
  const [projectVersions, setProjectVersions] = useState<
    Array<{ versionId: number; savedAt: string; label: string }>
  >([]);

  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  // Modals
  const [showWelcome, setShowWelcome] = useState(true);
  const [showExport, setShowExport] = useState(false);
  const [showPreferences, setShowPreferences] = useState(false);
  const [showMastering, setShowMastering] = useState(false);
  const [showAi, setShowAi] = useState(false);
  const [effectsModal, setEffectsModal] = useState<{
    open: boolean;
    tab: 'eq' | 'dynamics' | 'creative' | 'restoration' | 'voice';
    trackId?: string;
  }>({ open: false, tab: 'eq' });

  const notify = useCallback((msg: string) => {
    setStatusBanner(msg);
    window.setTimeout(() => setStatusBanner((cur) => (cur === msg ? null : cur)), 4000);
  }, []);

  const pushHistory = useCallback(
    (label: string) => {
      setUndoStack((prev) => [
        ...prev.slice(-24),
        {
          project: JSON.parse(JSON.stringify(project)),
          label,
        },
      ]);
      setRedoStack([]);
      setHistoryLog((h) => [`${new Date().toLocaleTimeString()} — ${label}`, ...h.slice(0, 49)]);
    },
    [project]
  );

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setRedoStack((r) => [
      ...r,
      {
        project: JSON.parse(JSON.stringify(project)),
        label: prev.label,
      },
    ]);
    setUndoStack((u) => u.slice(0, -1));
    setProject(prev.project);
    // Re-materialize any EDL-backed assets if present
    if (prev.project.edlMap) {
      setAssetPcms((cur) => {
        const next = new Map(cur);
        for (const [assetId, edl] of Object.entries(prev.project.edlMap ?? {})) {
          const mat = materializeEdl(edl, (id) => cur.get(id));
          if (getFrameCount(mat) > 0) next.set(assetId, mat);
        }
        return next;
      });
    }
    notify(`Deshacer: ${prev.label}`);
  }, [undoStack, project, notify]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setUndoStack((u) => [
      ...u,
      {
        project: JSON.parse(JSON.stringify(project)),
        label: next.label,
      },
    ]);
    setRedoStack((r) => r.slice(0, -1));
    setProject(next.project);
    if (next.project.edlMap) {
      setAssetPcms((cur) => {
        const map = new Map(cur);
        for (const [assetId, edl] of Object.entries(next.project.edlMap ?? {})) {
          const mat = materializeEdl(edl, (id) => cur.get(id));
          if (getFrameCount(mat) > 0) map.set(assetId, mat);
        }
        return map;
      });
    }
    notify(`Rehacer: ${next.label}`);
  }, [redoStack, project, notify]);

  // Initial load: devices, shortcuts, recents, crash recovery
  useEffect(() => {
    const uMeter = engine.onMeter(setMeter);
    const uTrackMeters = engine.onTrackMeters(setTrackMeters);
    const uPos = engine.onPosition(setCursorSec);
    const uStop = engine.onStop(() => setIsPlaying(false));

    engine.enumerateDevices().then(setDevices).catch(() => {});
    window.audioStudio?.getShortcuts().then(setShortcuts).catch(() => {});
    window.audioStudio?.getRecentProjects().then(setRecentProjects).catch(() => {});
    window.audioStudio
      ?.checkRecoveryProject()
      .then((recovered) => {
        if (recovered && recovered.assets.length > 0) {
          if (
            window.confirm(
              `Se encontró una sesión recuperada automáticamente ("${recovered.name}"). ¿Desea restaurarla?`
            )
          ) {
            void loadProjectAssetsFromDisk(recovered);
            setShowWelcome(false);
          } else {
            void window.audioStudio.clearRecoveryProject();
          }
        }
      })
      .catch(() => {});

    return () => {
      uMeter();
      uTrackMeters();
      uPos();
      uStop();
    };
  }, [engine]);

  // Theme application
  useEffect(() => {
    document.body.className = theme === 'light' ? 'theme-light' : 'theme-dark';
  }, [theme]);

  // Autosave every 45 seconds
  useEffect(() => {
    const id = window.setInterval(() => {
      window.audioStudio?.autosaveProject(project).catch(() => {});
    }, 45000);
    return () => clearInterval(id);
  }, [project]);

  // Live input level polling while recording
  useEffect(() => {
    if (!isRecording) return;
    const id = window.setInterval(() => {
      setInputLevelDb(engine.getRecordingInputLevelDb());
    }, 50);
    return () => clearInterval(id);
  }, [isRecording, engine]);

  const loadProjectAssetsFromDisk = async (loaded: StudioProject) => {
    const map = new Map<string, PcmAudioData>();
    for (const asset of loaded.assets) {
      const targetPath = asset.cachedWavPath || asset.originalPath;
      try {
        const bytes = await window.audioStudio.readBinaryFile(targetPath);
        map.set(asset.id, decodeWavBytes(bytes));
      } catch {
        try {
          const imported = await window.audioStudio.importAudioFile(
            asset.originalPath,
            loaded.id,
            loaded.sampleRate
          );
          const bytes = await window.audioStudio.readBinaryFile(imported.cachedWavPath);
          asset.cachedWavPath = imported.cachedWavPath;
          map.set(asset.id, decodeWavBytes(bytes));
        } catch (err) {
          await window.audioStudio.logError('loadAsset', String(err));
        }
      }
    }
    setProject(loaded);
    setAssetPcms(map);
  };

  const activeAsset = project.assets.find((a) => a.id === project.activeAssetId);
  const activePcm = activeAsset ? assetPcms.get(activeAsset.id) : undefined;

  const saveProcessedAsset = async (
    newPcm: PcmAudioData,
    newName: string,
    folder: MediaAsset['folder'] = 'processed',
    replaceActive = false
  ) => {
    const id = replaceActive && activeAsset ? activeAsset.id : `asset-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const wavBytes = encodeWavBytes(newPcm, 32);
    const cachePath = await window.audioStudio.getCachePath(project.id, `${id}.wav`);
    await window.audioStudio.writeBinaryFile(cachePath, wavBytes);

    const newAsset: MediaAsset = {
      id,
      name: newName,
      originalPath: activeAsset?.originalPath ?? cachePath,
      cachedWavPath: cachePath,
      folder,
      duration: getDurationSec(newPcm),
      sampleRate: newPcm.sampleRate,
      channels: newPcm.channels.length,
      bitDepth: 32,
      format: 'WAV',
      sizeBytes: wavBytes.byteLength,
      createdAt: new Date().toISOString(),
    };

    setAssetPcms((prev) => {
      const next = new Map(prev);
      next.set(id, newPcm);
      return next;
    });

    setProject((prev) => ({
      ...prev,
      activeAssetId: id,
      assets: replaceActive && activeAsset
        ? prev.assets.map((a) => (a.id === id ? newAsset : a))
        : [...prev.assets, newAsset],
    }));
  };

  const handleImportAudio = async () => {
    try {
      const files = await window.audioStudio.selectAudioFiles();
      if (!files.length) return;
      pushHistory('Importar audio');
      const nextAssets = [...project.assets];
      const nextMap = new Map(assetPcms);
      const nextEdls: Record<string, WaveformEdl> = { ...(project.edlMap ?? {}) };
      let lastId = project.activeAssetId;

      for (const filePath of files) {
        const res = await window.audioStudio.importAudioFile(
          filePath,
          project.id,
          project.sampleRate
        );
        const { peaks } = await window.audioStudio.computeWavPeaks(res.cachedWavPath, 1600);
        const bytes = await window.audioStudio.readBinaryFile(res.cachedWavPath);
        const pcm = decodeWavBytes(bytes);
        const id = `asset-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        nextMap.set(id, pcm);
        nextEdls[id] = createInitialEdl(id, pcm.sampleRate, pcm.channels.length, getFrameCount(pcm));
        nextAssets.push({
          id,
          name: res.name,
          originalPath: res.originalPath,
          cachedWavPath: res.cachedWavPath,
          folder: 'imported',
          duration: getDurationSec(pcm),
          sampleRate: pcm.sampleRate,
          channels: pcm.channels.length,
          bitDepth: res.info.bitDepth,
          format: res.info.format,
          sizeBytes: res.info.sizeBytes,
          peaksSummary: peaks,
          createdAt: new Date().toISOString(),
        });
        lastId = id;
      }

      setAssetPcms(nextMap);
      setProject((p) => ({ ...p, assets: nextAssets, activeAssetId: lastId, edlMap: nextEdls }));
      setShowWelcome(false);
      notify(`${files.length} archivo(s) importado(s) correctamente`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await window.audioStudio?.logError('importAudio', msg);
      notify(`Error al importar: ${msg}`);
    }
  };

  const handleWaveformAction = async (action: WaveformAction) => {
    if (!activePcm || !activeAsset) return;
    const dur = getDurationSec(activePcm);
    const selStart = selection ? selection.startSec : 0;
    const selEnd = selection ? selection.endSec : dur;
    const hasSel = selection !== null && selEnd - selStart > 0.005;

    pushHistory(`Edición onda: ${action.type}`);
    let updated: PcmAudioData = activePcm;

    switch (action.type) {
      case 'copy':
        setClipboardPcm(slicePcm(activePcm, selStart, selEnd));
        notify('Selección copiada');
        return;
      case 'cut': {
        const res = deleteRangePcm(activePcm, selStart, selEnd);
        setClipboardPcm(res.removed);
        updated = res.result;
        setSelection(null);
        break;
      }
      case 'delete': {
        if (!hasSel) return;
        updated = deleteRangePcm(activePcm, selStart, selEnd).result;
        setSelection(null);
        break;
      }
      case 'paste': {
        if (!clipboardPcm) return;
        updated = insertPcm(activePcm, clipboardPcm, cursorSec);
        break;
      }
      case 'trim':
        if (!hasSel) return;
        updated = trimPcm(activePcm, selStart, selEnd);
        setSelection(null);
        setCursorSec(0);
        break;
      case 'split': {
        const at = action.value ?? cursorSec;
        const [partA, partB] = splitPcm(activePcm, at);
        await saveProcessedAsset(partA, `${activeAsset.name} (Parte 1)`, 'processed', false);
        await saveProcessedAsset(partB, `${activeAsset.name} (Parte 2)`, 'processed', false);
        notify(`Archivo dividido en ${at.toFixed(2)}s`);
        return;
      }
      case 'silence':
        updated = silenceRangePcm(activePcm, selStart, selEnd);
        break;
      case 'normalize':
        updated = normalizePcm(
          activePcm,
          action.value ?? -0.5,
          hasSel ? selStart : undefined,
          hasSel ? selEnd : undefined
        );
        break;
      case 'invert-phase':
        updated = invertPhasePcm(
          activePcm,
          hasSel ? selStart : undefined,
          hasSel ? selEnd : undefined
        );
        break;
      case 'reverse':
        updated = reversePcm(
          activePcm,
          hasSel ? selStart : undefined,
          hasSel ? selEnd : undefined
        );
        break;
      case 'gain':
        updated = applyGainPcm(
          activePcm,
          action.value ?? 0,
          hasSel ? selStart : undefined,
          hasSel ? selEnd : undefined
        );
        break;
      case 'fade-in':
        updated = fadePcm(activePcm, 'in', selStart, hasSel ? selEnd : Math.min(dur, 1.0));
        break;
      case 'fade-out':
        updated = fadePcm(
          activePcm,
          'out',
          hasSel ? selStart : Math.max(0, dur - 1.0),
          hasSel ? selEnd : dur
        );
        break;
      case 'crossfade-clipboard':
        if (!clipboardPcm) {
          notify('Copie primero un fragmento para hacer fundido cruzado.');
          return;
        }
        updated = crossfadeJoinPcm(activePcm, clipboardPcm, 0.25);
        break;
      case 'speed':
        updated = changeSpeedPcm(activePcm, action.value ?? 1.1);
        break;
      case 'time-stretch':
        updated = await dspWorker.timeStretch(
          activePcm,
          action.value ?? 1.1,
          (percent, stage) => setWorkerProgress({ percent, stage })
        );
        setWorkerProgress(null);
        break;
      case 'pitch':
        updated = await dspWorker.pitchShift(
          activePcm,
          action.value ?? 0,
          (percent, stage) => setWorkerProgress({ percent, stage })
        );
        setWorkerProgress(null);
        break;
      case 'strip-silence': {
        const res = stripSilencePcm(activePcm, -44, 0.25, 0.03);
        updated = res.result;
        notify(`Silencios eliminados: ${res.removedSeconds.toFixed(2)}s`);
        break;
      }
      case 'detect-peaks': {
        const peaks = detectPeaksPcm(activePcm, -3, 0.08);
        setDetectedPeaks(peaks);
        notify(`${peaks.length} pico(s) detectados (> -3 dBFS)`);
        return;
      }
    }

    await saveProcessedAsset(updated, activeAsset.name, activeAsset.folder, true);
  };

  const handlePlayPause = useCallback(async () => {
    if (isPlaying) {
      engine.stop();
      setIsPlaying(false);
      return;
    }

    if (workspace === 'multitrack') {
      setIsPlaying(true);
      await engine.playMultitrack(project, assetPcms, { startSec: cursorSec });
    } else if (activePcm) {
      setIsPlaying(true);
      await engine.playPcm(activePcm, {
        startSec: cursorSec,
        loop: project.loopEnabled,
        loopStartSec: selection?.startSec ?? project.loopStartSec,
        loopEndSec: selection?.endSec ?? project.loopEndSec,
        rack: project.masterEffects,
      });
    } else {
      notify('No hay audio cargado para reproducir.');
    }
  }, [isPlaying, workspace, project, assetPcms, cursorSec, activePcm, selection, engine, notify]);

  const handleStop = useCallback(() => {
    engine.stop();
    setIsPlaying(false);
  }, [engine]);

  const handleRecordToggle = useCallback(async () => {
    if (isRecording) {
      const recorded = engine.stopRecording();
      setIsRecording(false);
      setInputLevelDb(-120);
      if (!recorded) return;

      pushHistory('Grabación de audio');
      const id = `rec-${Date.now()}`;
      const wavBytes = encodeWavBytes(recorded.pcm, 32);
      const cachePath = await window.audioStudio.getCachePath(project.id, `${id}.wav`);
      await window.audioStudio.writeBinaryFile(cachePath, wavBytes);

      const dur = getDurationSec(recorded.pcm);
      const name = `Grabación_${new Date().toLocaleTimeString().replace(/:/g, '-')}.wav`;
      const newAsset: MediaAsset = {
        id,
        name,
        originalPath: cachePath,
        cachedWavPath: cachePath,
        folder: 'recordings',
        duration: dur,
        sampleRate: recorded.pcm.sampleRate,
        channels: recorded.pcm.channels.length,
        bitDepth: 32,
        format: 'WAV',
        sizeBytes: wavBytes.byteLength,
        createdAt: new Date().toISOString(),
      };

      setAssetPcms((prev) => new Map(prev).set(id, recorded.pcm));
      setProject((prev) => {
        const armedTrack =
          prev.tracks.find((t) => t.armed && t.type === 'audio') ??
          prev.tracks.find((t) => t.id === selectedTrackId) ??
          prev.tracks[0];
        const hasOverlap = armedTrack.clips.some(
          (c) =>
            recorded.startTimeSec < c.startTimeSec + c.durationSec &&
            recorded.startTimeSec + dur > c.startTimeSec
        );
        const layerTrack = hasOverlap
          ? prev.tracks.find((t) => t.type === 'audio' && t.id !== armedTrack.id && t.clips.length === 0) ?? armedTrack
          : armedTrack;
        return {
          ...prev,
          activeAssetId: id,
          assets: [...prev.assets, newAsset],
          tracks: prev.tracks.map((t) =>
            t.id === layerTrack.id
              ? {
                  ...t,
                  clips: [
                    ...t.clips,
                    {
                      id: `clip-${Date.now()}`,
                      assetId: id,
                      name: hasOverlap ? `${name} [Toma]` : name,
                      trackId: t.id,
                      startTimeSec: recorded.startTimeSec,
                      offsetSec: 0,
                      durationSec: dur,
                      gainDb: 0,
                      fadeInSec: 0.01,
                      fadeOutSec: 0.01,
                      color: t.color,
                      muted: false,
                      locked: false,
                    },
                  ],
                }
              : t
          ),
        };
      });
      notify(`Grabación completada (${dur.toFixed(2)}s)`);
      return;
    }

    try {
      if (countdownSec > 0) {
        for (let c = countdownSec; c > 0; c--) {
          setCountdownRemaining(c);
          await new Promise((r) => setTimeout(r, 1000));
        }
        setCountdownRemaining(null);
      }

      const armedTrack = project.tracks.find((t) => t.armed && t.type === 'audio');
      if (project.punchEnabled && (project.punchOutSec ?? 0) > (project.punchInSec ?? 0)) {
        const pIn = project.punchInSec ?? 0;
        const pOut = project.punchOutSec ?? 4;
        const preRollDelayMs = Math.max(0, (pIn - cursorSec) * 1000);
        const punchDurMs = Math.max(200, (pOut - Math.max(cursorSec, pIn)) * 1000);
        void engine.playMultitrack(project, assetPcms, { startSec: cursorSec });
        setIsPlaying(true);
        notify(`Punch In armado (${pIn}s – ${pOut}s)...`);
        window.setTimeout(async () => {
          await engine.startRecording({
            deviceId: inputDeviceId,
            channelMode: armedTrack?.inputChannelMode ?? 'stereo',
            inputGainDb,
            monitorInput,
            timelineStartSec: Math.max(cursorSec, pIn),
          });
          setIsRecording(true);
          notify('Punch In activo: grabando...');
          window.setTimeout(() => {
            if (engine.isRecording()) {
              engine.stop();
              setIsPlaying(false);
              void handleRecordToggle();
            }
          }, punchDurMs);
        }, preRollDelayMs);
        return;
      }

      await engine.startRecording({
        deviceId: inputDeviceId,
        channelMode: armedTrack?.inputChannelMode ?? 'stereo',
        inputGainDb,
        monitorInput,
        timelineStartSec: cursorSec,
      });
      setIsRecording(true);
      notify('Grabando audio en vivo...');
    } catch (err) {
      setCountdownRemaining(null);
      notify(`No se pudo iniciar la grabación: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [
    isRecording,
    engine,
    pushHistory,
    project.id,
    project.tracks,
    selectedTrackId,
    countdownSec,
    inputDeviceId,
    inputGainDb,
    monitorInput,
    cursorSec,
    notify,
  ]);

  const handleSaveProject = async (saveAs = false) => {
    try {
      let target = project.filePath;
      if (!target || saveAs) {
        const chosen = await window.audioStudio.selectSaveProjectPath(project.name);
        if (!chosen) return;
        target = chosen;
      }
      await window.audioStudio.saveProject(project, target, 'Guardado usuario');
      setProject((p) => ({ ...p, filePath: target }));
      const loaded = await window.audioStudio.loadProject(target);
      setProjectVersions(loaded.versions);
      setRecentProjects(await window.audioStudio.getRecentProjects());
      notify(`Proyecto guardado en ${target}`);
    } catch (err) {
      notify(`Error al guardar: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleOpenProjectPath = async (filePath: string) => {
    try {
      const { project: loaded, versions } = await window.audioStudio.loadProject(filePath);
      await loadProjectAssetsFromDisk(loaded);
      setProjectVersions(versions);
      setShowWelcome(false);
      notify(`Proyecto cargado: ${loaded.name}`);
    } catch (err) {
      notify(`Error al abrir proyecto: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleOpenProject = async () => {
    const p = await window.audioStudio.selectOpenProjectPath();
    if (p) await handleOpenProjectPath(p);
  };

  useEffect(() => {
    window.audioStudio
      ?.getInitialFile()
      .then((file) => {
        if (file && file.toLowerCase().endsWith('.aspro')) {
          void handleOpenProjectPath(file);
        }
      })
      .catch(() => {});

    const uFile = window.audioStudio?.onOpenProjectFile((file) => {
      if (file && file.toLowerCase().endsWith('.aspro')) {
        void handleOpenProjectPath(file);
      }
    });

    return () => {
      uFile?.();
    };
  }, []);

  const handleExportAudio = async (
    settings: ExportSettings,
    source: 'active-asset' | 'multitrack-mix',
    applyMastering: boolean
  ) => {
    let pcmToExport: PcmAudioData;
    if (source === 'active-asset' && activePcm) {
      pcmToExport = activePcm;
    } else {
      pcmToExport = await dspWorker.renderMultitrackMixdown(
        project,
        assetPcms,
        applyMastering,
        (percent, stage) => setWorkerProgress({ percent, stage })
      );
      setWorkerProgress(null);
    }
    if (settings.normalizeEnabled) {
      pcmToExport = normalizePcm(pcmToExport, settings.normalizeTargetDb);
    }
    const wavBytes = encodeWavBytes(pcmToExport, 32);
    await window.audioStudio.exportAudio(wavBytes, settings);
    notify(`Exportado exitosamente: ${settings.outputPath}`);
  };

  const handleUpdateTrack = (trackId: string, patch: Partial<MultitrackTrack>) => {
    setProject((prev) => {
      const nextTracks = prev.tracks.map((t) => (t.id === trackId ? { ...t, ...patch } : t));
      const anySolo = nextTracks.some((t) => t.solo);
      if (engine.isPlaying()) {
        for (const t of nextTracks) {
          engine.updateLiveTrack(t, anySolo);
        }
      }
      return {
        ...prev,
        tracks: nextTracks,
      };
    });
  };

  const handleAddMarker = useCallback(() => {
    setProject((prev) => ({
      ...prev,
      markers: [
        ...prev.markers,
        {
          id: `mk-${Date.now()}`,
          name: `M${prev.markers.length + 1}`,
          timeSec: cursorSec,
          color: '#facc15',
        },
      ],
    }));
    notify(`Marcador insertado en ${cursorSec.toFixed(2)}s`);
  }, [cursorSec, notify]);

  // Global keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const combo = `${e.ctrlKey ? 'Ctrl+' : ''}${e.code}`;
      if (combo === shortcuts.playPause) {
        e.preventDefault();
        void handlePlayPause();
      } else if (combo === shortcuts.record) {
        e.preventDefault();
        void handleRecordToggle();
      } else if (combo === shortcuts.undo) {
        e.preventDefault();
        handleUndo();
      } else if (combo === shortcuts.redo) {
        e.preventDefault();
        handleRedo();
      } else if (combo === shortcuts.save) {
        e.preventDefault();
        void handleSaveProject(false);
      } else if (combo === shortcuts.open) {
        e.preventDefault();
        void handleOpenProject();
      } else if (combo === shortcuts.newProject) {
        e.preventDefault();
        setProject(createInitialProject());
        setAssetPcms(new Map());
      } else if (combo === shortcuts.copy) {
        void handleWaveformAction({ type: 'copy' });
      } else if (combo === shortcuts.paste) {
        void handleWaveformAction({ type: 'paste' });
      } else if (combo === shortcuts.cut) {
        void handleWaveformAction({ type: 'cut' });
      } else if (combo === shortcuts.deleteSelection) {
        void handleWaveformAction({ type: 'delete' });
      } else if (combo === shortcuts.zoomIn) {
        setZoomLevel((z) => Math.min(12, z * 1.25));
      } else if (combo === shortcuts.zoomOut) {
        setZoomLevel((z) => Math.max(0.5, z / 1.25));
      } else if (combo === shortcuts.addMarker) {
        handleAddMarker();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const modalTrack =
    effectsModal.trackId
      ? project.tracks.find((t) => t.id === effectsModal.trackId)
      : undefined;

  return (
    <div className="daw-shell">
      <TopMenuBar
        projectName={project.name}
        workspace={workspace}
        onChangeWorkspace={setWorkspace}
        actions={{
          onNewProject: () => {
            setProject(createInitialProject());
            setAssetPcms(new Map());
            setSelection(null);
            setCursorSec(0);
          },
          onOpenProject: () => void handleOpenProject(),
          onSaveProject: () => void handleSaveProject(false),
          onSaveProjectAs: () => void handleSaveProject(true),
          onConsolidateAndSave: async () => {
            try {
              const target =
                project.filePath ||
                (await window.audioStudio.selectSaveProjectPath(project.name));
              if (!target) return;
              const consolidated = await window.audioStudio.consolidateAndSaveProject(
                project,
                target
              );
              setProject(consolidated);
              const loaded = await window.audioStudio.loadProject(target);
              setProjectVersions(loaded.versions);
              setRecentProjects(await window.audioStudio.getRecentProjects());
              notify(`Sesión autocontenida guardada con carpeta Media/ en ${target}`);
            } catch (err) {
              notify(`Error al consolidar sesión: ${err instanceof Error ? err.message : String(err)}`);
            }
          },
          onImportAudio: () => void handleImportAudio(),
          onExportAudio: () => setShowExport(true),
          onUndo: handleUndo,
          onRedo: handleRedo,
          onCut: () => void handleWaveformAction({ type: 'cut' }),
          onCopy: () => void handleWaveformAction({ type: 'copy' }),
          onPaste: () => void handleWaveformAction({ type: 'paste' }),
          onDelete: () => void handleWaveformAction({ type: 'delete' }),
          onZoomIn: () => setZoomLevel((z) => Math.min(12, z * 1.25)),
          onZoomOut: () => setZoomLevel((z) => Math.max(0.5, z / 1.25)),
          onToggleMixer: () => setShowMixer((s) => !s),
          onToggleProjectPanel: () => setShowProjectPanel((s) => !s),
          onAddTracksTo64: () => {
            setProject((prev) => {
              const currentAudio = prev.tracks.filter((t) => t.type === 'audio').length;
              if (currentAudio >= 64) return prev;
              const extra = [];
              for (let i = currentAudio + 1; i <= 64; i++) {
                extra.push(createTrack(i, 'audio'));
              }
              return { ...prev, tracks: [...prev.tracks, ...extra] };
            });
            notify('Pistas ampliadas hasta 64 canales de audio.');
          },
          onAddMarker: handleAddMarker,
          onSplitAtCursor: () => void handleWaveformAction({ type: 'split', value: cursorSec }),
          onNormalizeSelection: () => void handleWaveformAction({ type: 'normalize', value: -0.5 }),
          onOpenEffects: () => setEffectsModal({ open: true, tab: 'eq' }),
          onOpenRestoration: () => setEffectsModal({ open: true, tab: 'restoration' }),
          onOpenVoice: () => setEffectsModal({ open: true, tab: 'voice' }),
          onOpenMastering: () => setShowMastering(true),
          onOpenAiAssistant: () => setShowAi(true),
          onToggleVolumeAuto: () =>
            handleUpdateTrack(selectedTrackId, {
              automation: (
                project.tracks.find((t) => t.id === selectedTrackId)?.automation ?? []
              ).map((a) => (a.target === 'volume' ? { ...a, visible: !a.visible } : a)),
            }),
          onTogglePanAuto: () =>
            handleUpdateTrack(selectedTrackId, {
              automation: (
                project.tracks.find((t) => t.id === selectedTrackId)?.automation ?? []
              ).map((a) => (a.target === 'pan' ? { ...a, visible: !a.visible } : a)),
            }),
          onToggleEqAuto: () =>
            handleUpdateTrack(selectedTrackId, {
              automation: (
                project.tracks.find((t) => t.id === selectedTrackId)?.automation ?? []
              ).map((a) => (a.target === 'eq_gain' ? { ...a, visible: !a.visible } : a)),
            }),
          onToggleReverbAuto: () =>
            handleUpdateTrack(selectedTrackId, {
              automation: (
                project.tracks.find((t) => t.id === selectedTrackId)?.automation ?? []
              ).map((a) => (a.target === 'reverb_mix' ? { ...a, visible: !a.visible } : a)),
            }),
          onToggleDelayAuto: () =>
            handleUpdateTrack(selectedTrackId, {
              automation: (
                project.tracks.find((t) => t.id === selectedTrackId)?.automation ?? []
              ).map((a) => (a.target === 'delay_mix' ? { ...a, visible: !a.visible } : a)),
            }),
          onOpenPreferences: () => setShowPreferences(true),
          onOpenWelcome: () => setShowWelcome(true),
          onCheckForUpdates: async () => {
            const res = await window.audioStudio.checkForUpdates();
            notify(res.message);
            if (res.status === 'available' && window.confirm(`${res.message}. ¿Desea descargarla e instalarla?`)) {
              await window.audioStudio.downloadUpdate();
              notify('Actualización descargada; se instalará al cerrar o reiniciar.');
            }
          },
        }}
      />

      <ToolBar
        activeTool={activeTool}
        onSelectTool={(t) => {
          setActiveTool(t);
          if (t === 'spectral-select') setWorkspace('spectral');
        }}
        canUndo={undoStack.length > 0}
        canRedo={redoStack.length > 0}
        hasClipboard={clipboardPcm !== null}
        snapToGrid={project.snapToGrid}
        bpm={project.bpm}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onCut={() => void handleWaveformAction({ type: 'cut' })}
        onCopy={() => void handleWaveformAction({ type: 'copy' })}
        onPaste={() => void handleWaveformAction({ type: 'paste' })}
        onDelete={() => void handleWaveformAction({ type: 'delete' })}
        onSplit={() => void handleWaveformAction({ type: 'split', value: cursorSec })}
        onZoomIn={() => setZoomLevel((z) => Math.min(12, z * 1.25))}
        onZoomOut={() => setZoomLevel((z) => Math.max(0.5, z / 1.25))}
        onToggleSnap={() =>
          setProject((p) => ({ ...p, snapToGrid: !p.snapToGrid }))
        }
        onAddMarker={handleAddMarker}
      />

      {(statusBanner || workerProgress) && (
        <div
          style={{
            background: '#0e7490',
            color: '#fff',
            padding: '4px 12px',
            fontSize: 11.5,
            fontWeight: 600,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>{workerProgress ? `${workerProgress.stage} (${workerProgress.percent}%)` : statusBanner}</span>
          {workerProgress && (
            <div style={{ width: 140, height: 6, background: 'rgba(0,0,0,0.3)', borderRadius: 3 }}>
              <div
                style={{
                  width: `${workerProgress.percent}%`,
                  height: '100%',
                  background: '#38bdf8',
                  borderRadius: 3,
                }}
              />
            </div>
          )}
        </div>
      )}

      <div className="workspace-body">
        {showProjectPanel && (
          <ProjectPanel
            assets={project.assets}
            activeAssetId={project.activeAssetId}
            historyEntries={historyLog}
            onImportAudio={() => void handleImportAudio()}
            onSelectAsset={(id) => {
              setProject((p) => ({ ...p, activeAssetId: id }));
              setSelection(null);
              setCursorSec(0);
            }}
            onInsertToMultitrack={(assetId) => {
              const asset = project.assets.find((a) => a.id === assetId);
              if (!asset) return;
              pushHistory(`Insertar ${asset.name} en multipista`);
              setProject((prev) => ({
                ...prev,
                tracks: prev.tracks.map((t) =>
                  t.id === selectedTrackId
                    ? {
                        ...t,
                        clips: [
                          ...t.clips,
                          {
                            id: `clip-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
                            assetId: asset.id,
                            name: asset.name,
                            trackId: t.id,
                            startTimeSec: cursorSec,
                            offsetSec: 0,
                            durationSec: asset.duration,
                            gainDb: 0,
                            fadeInSec: 0.01,
                            fadeOutSec: 0.01,
                            color: t.color,
                            muted: false,
                            locked: false,
                          },
                        ],
                      }
                    : t
                ),
              }));
              setWorkspace('multitrack');
            }}
          />
        )}

        <div className="center-stage">
          <div className="editor-area">
            {workspace === 'waveform' && (
              <WaveformEditor
                asset={activeAsset}
                pcm={activePcm}
                activeTool={activeTool}
                cursorSec={cursorSec}
                zoomLevel={zoomLevel}
                selection={selection}
                markers={project.markers}
                detectedPeaks={detectedPeaks}
                onSeek={setCursorSec}
                onChangeSelection={setSelection}
                onAction={(a) => void handleWaveformAction(a)}
                onImportAudio={() => void handleImportAudio()}
              />
            )}

            {workspace === 'multitrack' && (
              <MultitrackEditor
                project={project}
                assetMap={assetPcms}
                activeTool={activeTool}
                cursorSec={cursorSec}
                zoomLevel={zoomLevel}
                selectedTrackId={selectedTrackId}
                selectedClipId={selectedClipId}
                onSelectTrack={setSelectedTrackId}
                onSelectClip={setSelectedClipId}
                onSeek={setCursorSec}
                onUpdateTrack={handleUpdateTrack}
                onDropAssetOnTrack={(assetId, trackId, startSec) => {
                  const asset = project.assets.find((a) => a.id === assetId);
                  if (!asset) return;
                  pushHistory('Soltar clip en pista');
                  setProject((prev) => ({
                    ...prev,
                    tracks: prev.tracks.map((t) =>
                      t.id === trackId
                        ? {
                            ...t,
                            clips: [
                              ...t.clips,
                              {
                                id: `clip-${Date.now()}`,
                                assetId: asset.id,
                                name: asset.name,
                                trackId: t.id,
                                startTimeSec: startSec,
                                offsetSec: 0,
                                durationSec: asset.duration,
                                gainDb: 0,
                                fadeInSec: 0.01,
                                fadeOutSec: 0.01,
                                color: t.color,
                                muted: false,
                                locked: false,
                              },
                            ],
                          }
                        : t
                    ),
                  }));
                }}
                onMoveClip={(trackId, clipId, newStartSec) =>
                  setProject((prev) => ({
                    ...prev,
                    tracks: prev.tracks.map((t) =>
                      t.id === trackId
                        ? {
                            ...t,
                            clips: t.clips.map((c) =>
                              c.id === clipId ? { ...c, startTimeSec: newStartSec } : c
                            ),
                          }
                        : t
                    ),
                  }))
                }
                onResizeClip={(trackId, clipId, newDur) =>
                  setProject((prev) => ({
                    ...prev,
                    tracks: prev.tracks.map((t) =>
                      t.id === trackId
                        ? {
                            ...t,
                            clips: t.clips.map((c) =>
                              c.id === clipId ? { ...c, durationSec: newDur } : c
                            ),
                          }
                        : t
                    ),
                  }))
                }
                onSplitClipAt={(trackId, clipId, atSec) => {
                  pushHistory('Dividir clip');
                  setProject((prev) => ({
                    ...prev,
                    tracks: prev.tracks.map((t) => {
                      if (t.id !== trackId) return t;
                      const target = t.clips.find((c) => c.id === clipId);
                      if (
                        !target ||
                        atSec <= target.startTimeSec + 0.02 ||
                        atSec >= target.startTimeSec + target.durationSec - 0.02
                      ) {
                        return t;
                      }
                      const leftDur = atSec - target.startTimeSec;
                      const rightDur = target.durationSec - leftDur;
                      const left = { ...target, durationSec: leftDur };
                      const right = {
                        ...target,
                        id: `clip-${Date.now()}`,
                        startTimeSec: atSec,
                        offsetSec: target.offsetSec + leftDur,
                        durationSec: rightDur,
                      };
                      return {
                        ...t,
                        clips: t.clips.flatMap((c) => (c.id === clipId ? [left, right] : [c])),
                      };
                    }),
                  }));
                }}
                onDuplicateClip={(trackId, clipId) => {
                  pushHistory('Duplicar clip');
                  setProject((prev) => ({
                    ...prev,
                    tracks: prev.tracks.map((t) => {
                      if (t.id !== trackId) return t;
                      const c = t.clips.find((x) => x.id === clipId);
                      if (!c) return t;
                      return {
                        ...t,
                        clips: [
                          ...t.clips,
                          {
                            ...c,
                            id: `clip-${Date.now()}`,
                            startTimeSec: c.startTimeSec + c.durationSec,
                          },
                        ],
                      };
                    }),
                  }));
                }}
                onDeleteClip={(trackId, clipId) => {
                  pushHistory('Eliminar clip');
                  setProject((prev) => ({
                    ...prev,
                    tracks: prev.tracks.map((t) =>
                      t.id === trackId
                        ? { ...t, clips: t.clips.filter((c) => c.id !== clipId) }
                        : t
                    ),
                  }));
                  setSelectedClipId(null);
                }}
                onCrossfadeNextClip={(trackId, clipId) => {
                  pushHistory('Fundido cruzado entre clips');
                  setProject((prev) => ({
                    ...prev,
                    tracks: prev.tracks.map((t) => {
                      if (t.id !== trackId) return t;
                      const sorted = [...t.clips].sort((a, b) => a.startTimeSec - b.startTimeSec);
                      const idx = sorted.findIndex((c) => c.id === clipId);
                      if (idx === -1) return t;
                      const curr = sorted[idx];
                      const next = sorted[idx + 1];
                      if (!next) {
                        return {
                          ...t,
                          clips: t.clips.map((c) =>
                            c.id === clipId ? { ...c, fadeOutSec: 0.25 } : c
                          ),
                        };
                      }
                      const overlapDur = 0.25;
                      const currEnd = curr.startTimeSec + curr.durationSec;
                      const nextStart = Math.max(0, currEnd - overlapDur);
                      return {
                        ...t,
                        clips: t.clips.map((c) => {
                          if (c.id === curr.id) return { ...c, fadeOutSec: overlapDur };
                          if (c.id === next.id) {
                            return { ...c, startTimeSec: nextStart, fadeInSec: overlapDur };
                          }
                          return c;
                        }),
                      };
                    }),
                  }));
                  notify('Fundido cruzado real (0.25s solapado) aplicado.');
                }}
                onAddAutomationPoint={(trackId, target, timeSec, value) => {
                  setProject((prev) => ({
                    ...prev,
                    tracks: prev.tracks.map((t) =>
                      t.id === trackId
                        ? {
                            ...t,
                            automation: t.automation.map((a) =>
                              a.target === target
                                ? {
                                    ...a,
                                    points: [
                                      ...a.points,
                                      { id: `pt-${Date.now()}`, timeSec, value },
                                    ],
                                  }
                                : a
                            ),
                          }
                        : t
                    ),
                  }));
                }}
                onExpandTo64Tracks={() => {
                  setProject((prev) => {
                    const count = prev.tracks.filter((t) => t.type === 'audio').length;
                    if (count >= 64) return prev;
                    const add = [];
                    for (let i = count + 1; i <= 64; i++) add.push(createTrack(i, 'audio'));
                    return { ...prev, tracks: [...prev.tracks, ...add] };
                  });
                }}
              />
            )}

            {workspace === 'spectral' && (
              <SpectralEditor
                asset={activeAsset}
                pcm={activePcm}
                cursorSec={cursorSec}
                onSeek={setCursorSec}
                onAttenuateSelection={async (sel: SpectralSelection, attDb: number) => {
                  if (!activePcm || !activeAsset) return;
                  pushHistory('Atenuación espectral');
                  const cleaned = await dspWorker.attenuateSpectralRegion(
                    activePcm,
                    sel,
                    attDb,
                    (percent, stage) => setWorkerProgress({ percent, stage })
                  );
                  setWorkerProgress(null);
                  await saveProcessedAsset(cleaned, activeAsset.name, activeAsset.folder, true);
                  notify('Región espectral limpiada.');
                }}
                onDeHum={async (hz) => {
                  if (!activePcm || !activeAsset) return;
                  pushHistory(`Eliminar zumbido ${hz} Hz`);
                  const cleaned = await dspWorker.removeHum(
                    activePcm,
                    hz,
                    4,
                    (percent, stage) => setWorkerProgress({ percent, stage })
                  );
                  setWorkerProgress(null);
                  await saveProcessedAsset(cleaned, activeAsset.name, activeAsset.folder, true);
                  notify(`Zumbido ${hz} Hz eliminado.`);
                }}
                onDeClick={async () => {
                  if (!activePcm || !activeAsset) return;
                  pushHistory('Eliminar clics');
                  const cleaned = await dspWorker.deClick(
                    activePcm,
                    0.7,
                    (percent, stage) => setWorkerProgress({ percent, stage })
                  );
                  setWorkerProgress(null);
                  await saveProcessedAsset(cleaned, activeAsset.name, activeAsset.folder, true);
                  notify('Clics atenuados.');
                }}
                onSpectralNoiseClean={async () => {
                  if (!activePcm || !activeAsset) return;
                  pushHistory('Limpieza espectral de ruido');
                  const cleaned = await dspWorker.cleanNoise(
                    activePcm,
                    0.55,
                    (percent, stage) => setWorkerProgress({ percent, stage })
                  );
                  setWorkerProgress(null);
                  await saveProcessedAsset(cleaned, activeAsset.name, activeAsset.folder, true);
                  notify('Ruido espectral reducido.');
                }}
                onImportAudio={() => void handleImportAudio()}
              />
            )}
          </div>

          {showMixer && (
            <MixerPanel
              project={project}
              meter={meter}
              trackMeters={trackMeters}
              softClipEnabled={softClipEnabled}
              onToggleSoftClip={() => {
                const next = !softClipEnabled;
                setSoftClipEnabled(next);
                engine.setSoftClipProtection(next);
              }}
              onUpdateTrack={handleUpdateTrack}
              onUpdateMasterVolume={(db) => {
                setProject((p) => ({ ...p, masterVolumeDb: db }));
                engine.setMasterVolumeDb(db);
              }}
              onUpdateMasterPan={(pan) => {
                setProject((p) => ({ ...p, masterPan: pan }));
                engine.setMasterPan(pan);
              }}
              onOpenTrackEffects={(trackId) =>
                setEffectsModal({ open: true, tab: 'eq', trackId })
              }
            />
          )}
        </div>
      </div>

      <TransportFooter
        isPlaying={isPlaying}
        isRecording={isRecording}
        loopEnabled={project.loopEnabled}
        cursorSec={cursorSec}
        bpm={project.bpm}
        sampleRate={project.sampleRate}
        bitDepth={project.bitDepth}
        inputLevelDb={inputLevelDb}
        countdownRemaining={countdownRemaining}
        driverStatus={`WASAPI · ${project.sampleRate / 1000} kHz`}
        punchEnabled={Boolean(project.punchEnabled)}
        punchInSec={project.punchInSec ?? 2}
        punchOutSec={project.punchOutSec ?? 6}
        onTogglePunch={() =>
          setProject((p) => ({ ...p, punchEnabled: !p.punchEnabled }))
        }
        onChangePunchRange={(inSec, outSec) =>
          setProject((p) => ({
            ...p,
            punchInSec: Math.max(0, inSec),
            punchOutSec: Math.max(inSec + 0.5, outSec),
          }))
        }
        onPlayPause={() => void handlePlayPause()}
        onStop={handleStop}
        onRecordToggle={() => void handleRecordToggle()}
        onRewind={() => setCursorSec((s) => Math.max(0, s - 5))}
        onForward={() => setCursorSec((s) => s + 5)}
        onToggleLoop={() =>
          setProject((p) => ({ ...p, loopEnabled: !p.loopEnabled }))
        }
        onChangeBpm={(bpm) => setProject((p) => ({ ...p, bpm }))}
        onChangeSampleRate={async (sr: SampleRateOption) => {
          setProject((p) => ({ ...p, sampleRate: sr }));
          await engine.ensureContext(sr, latencyMode);
        }}
        onChangeBitDepth={(bd: BitDepthOption) =>
          setProject((p) => ({ ...p, bitDepth: bd }))
        }
      />

      {showWelcome && (
        <WelcomeModal
          recentProjects={recentProjects}
          onNewProject={() => {
            setProject(createInitialProject());
            setAssetPcms(new Map());
          }}
          onOpenProject={() => void handleOpenProject()}
          onOpenRecentProject={(fp) => void handleOpenProjectPath(fp)}
          onImportAudio={() => void handleImportAudio()}
          onClose={() => setShowWelcome(false)}
        />
      )}

      {showExport && (
        <ExportModal
          defaultName={activeAsset?.name.replace(/\.[^.]+$/, '') ?? project.name}
          defaultSampleRate={project.sampleRate}
          defaultBitDepth={project.bitDepth}
          hasMultitrackClips={project.tracks.some((t) => t.clips.length > 0)}
          onExport={handleExportAudio}
          onClose={() => setShowExport(false)}
        />
      )}

      {effectsModal.open && (
        <EffectsRestorationModal
          initialTab={effectsModal.tab}
          rack={modalTrack ? modalTrack.effects : project.masterEffects}
          sampleRate={project.sampleRate}
          activePcm={activePcm}
          trackLabel={modalTrack ? modalTrack.name : 'Audio Activo / Master'}
          onUpdateRack={(rack: TrackEffectRack) => {
            if (modalTrack) {
              handleUpdateTrack(modalTrack.id, { effects: rack });
            } else {
              setProject((p) => ({ ...p, masterEffects: rack }));
              engine.updateLivePreviewRack(rack);
            }
          }}
          onApplyProcessedPcm={async (pcm, desc) => {
            pushHistory(desc);
            const base = activeAsset?.name.replace(/\.[^.]+$/, '') ?? 'Audio';
            await saveProcessedAsset(pcm, `${base} [${desc}].wav`, 'processed', false);
            notify(`Procesado aplicado y guardado en Archivos Procesados: ${desc}`);
          }}
          onPreviewPcm={(pcm, rack) => void engine.playPcm(pcm, { rack })}
          onStopPreview={() => engine.stop()}
          onClose={() => setEffectsModal({ ...effectsModal, open: false })}
        />
      )}

      {showMastering && (
        <MasteringModal
          chain={project.mastering}
          sourcePcm={
            project.tracks.some((t) => t.clips.length > 0)
              ? renderMultitrackMixdown(project, assetPcms)
              : activePcm
          }
          getSpectrumData={() => engine.getMasterFrequencyData()}
          onUpdateChain={(mastering) => setProject((p) => ({ ...p, mastering }))}
          onPreviewMaster={(pcm) => void engine.playPcm(pcm)}
          onRenderMasteredAsset={async (pcm, profileName) => {
            pushHistory(`Masterización (${profileName})`);
            await saveProcessedAsset(pcm, `${project.name} [Master ${profileName}].wav`, 'processed', false);
            notify(`Versión masterizada (${profileName}) creada.`);
          }}
          onClose={() => setShowMastering(false)}
        />
      )}

      {showAi && (
        <AiAssistantModal
          activePcm={activePcm}
          assetName={activeAsset?.name}
          onApplyAction={async (actionId) => {
            if (!activePcm || !activeAsset) return;
            pushHistory(`AI Assistant: ${actionId}`);
            let out = activePcm;
            if (actionId === 'normalize-safe') out = normalizePcm(activePcm, -1.0);
            else if (actionId === 'remove-hum-50') out = await dspWorker.removeHum(activePcm, 50, 4);
            else if (actionId === 'remove-hum-60') out = await dspWorker.removeHum(activePcm, 60, 4);
            else if (actionId === 'clean-noise') out = await dspWorker.cleanNoise(activePcm, 0.5);
            else if (actionId === 'smart-lufs-14') out = normalizeToLufs(activePcm, -14);
            else if (actionId === 'eq-clarity') {
              out = applyParametricEqPcm(activePcm, {
                enabled: true,
                bandCount: 4,
                bands: [
                  { id: 'ai1', enabled: true, type: 'highpass', frequency: 80, gainDb: 0, q: 0.71 },
                  { id: 'ai2', enabled: true, type: 'peaking', frequency: 300, gainDb: -3, q: 1.4 },
                  { id: 'ai3', enabled: true, type: 'peaking', frequency: 3000, gainDb: 2.5, q: 1.2 },
                  { id: 'ai4', enabled: true, type: 'highshelf', frequency: 10000, gainDb: 1.5, q: 0.71 },
                ],
              });
            } else if (actionId === 'auto-voice-polish') {
              const voicePreset = VOICE_PRESETS[0];
              out = await dspWorker.applyRestoration(activePcm, RESTORATION_PROFILES['pro-voice']);
              if (voicePreset.rack.parametricEq) {
                out = applyParametricEqPcm(out, voicePreset.rack.parametricEq);
              }
              if (voicePreset.rack.compressor) {
                out = applyCompressorPcm(out, voicePreset.rack.compressor);
              }
            }
            await saveProcessedAsset(out, `${activeAsset.name} [AI].wav`, 'processed', false);
            notify(`Corrección AI aplicada: ${actionId}`);
          }}
          onSeparateMs={async (mode) => {
            if (!activePcm || !activeAsset) return;
            const suffix = mode === 'isolate-voice' ? 'Voz_Aislada_MS' : 'Musica_Fondo_MS';
            const out = await dspWorker.separateMs(
              activePcm,
              mode,
              (percent, stage) => setWorkerProgress({ percent, stage })
            );
            setWorkerProgress(null);
            const base = activeAsset.name.replace(/\.[^.]+$/, '') ?? 'Audio';
            await saveProcessedAsset(out, `${base} [${suffix}].wav`, 'processed', false);
            notify(`Separación M/S creada: ${suffix}`);
          }}
          onAutoBalanceTracks={() => {
            const adj = autoBalanceTracks(project, assetPcms);
            setProject((prev) => ({
              ...prev,
              tracks: prev.tracks.map((t) =>
                adj[t.id] !== undefined ? { ...t, volumeDb: adj[t.id] } : t
              ),
            }));
            notify('Pistas multipista balanceadas automáticamente (-20 LUFS/pista).');
          }}
          onRunOnnxModel={async (modelPath) => {
            if (!activePcm || !activeAsset) {
              notify('Abra o seleccione un archivo de audio primero en Modo Forma de Onda.');
              return;
            }
            try {
              const processedChannels: Float32Array[] = [];
              for (let ch = 0; ch < activePcm.channels.length; ch++) {
                setWorkerProgress({
                  percent: Math.round(((ch + 1) / activePcm.channels.length) * 80),
                  stage: `Inferencia ONNX: Procesando canal ${ch + 1}/${activePcm.channels.length}...`,
                });
                const outChannel = await window.audioStudio.runOnnxWaveform(
                  modelPath,
                  activePcm.channels[ch]
                );
                processedChannels.push(outChannel);
              }
              setWorkerProgress(null);
              const resultPcm: PcmAudioData = {
                sampleRate: activePcm.sampleRate,
                channels: processedChannels,
              };
              const base = activeAsset.name.replace(/\.[^.]+$/, '') || 'Audio';
              await saveProcessedAsset(resultPcm, `${base} [ONNX].wav`, 'processed', false);
              notify(`Inferencia neuronal ONNX aplicada: ${base} [ONNX].wav`);
            } catch (err) {
              setWorkerProgress(null);
              notify(`Error en modelo ONNX: ${err instanceof Error ? err.message : String(err)}`);
              throw err;
            }
          }}
          onClose={() => setShowAi(false)}
        />
      )}

      {showPreferences && (
        <PreferencesModal
          theme={theme}
          latencyMode={latencyMode}
          inputDeviceId={inputDeviceId}
          outputDeviceId={outputDeviceId}
          inputGainDb={inputGainDb}
          monitorInput={monitorInput}
          countdownSec={countdownSec}
          shortcuts={shortcuts}
          projectVersions={projectVersions}
          devices={devices}
          onChangeTheme={setTheme}
          onChangeLatency={async (m) => {
            setLatencyMode(m);
            await engine.ensureContext(project.sampleRate, m);
          }}
          onChangeInputDevice={setInputDeviceId}
          onChangeOutputDevice={async (id) => {
            setOutputDeviceId(id);
            await engine.setOutputDevice(id);
          }}
          onChangeInputGain={(db) => {
            setInputGainDb(db);
            engine.setRecordingInputGainDb(db);
          }}
          onChangeMonitorInput={(v) => {
            setMonitorInput(v);
            engine.setRecordingMonitor(v);
          }}
          onChangeCountdown={setCountdownSec}
          onSaveShortcuts={async (map) => {
            setShortcuts(map);
            await window.audioStudio.setShortcuts(map);
            notify('Atajos de teclado actualizados.');
          }}
          onRestoreVersion={async (versionId) => {
            if (!project.filePath) return;
            const restored = await window.audioStudio.restoreProjectVersion(
              project.filePath,
              versionId
            );
            await loadProjectAssetsFromDisk(restored);
            notify(`Versión #${versionId} restaurada.`);
            setShowPreferences(false);
          }}
          onRefreshDevices={() => void engine.enumerateDevices().then(setDevices)}
          onClose={() => setShowPreferences(false)}
        />
      )}
    </div>
  );
};
