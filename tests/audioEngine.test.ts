import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeAudioWithAiAssistant, separateVoiceAndMusicMs } from '../src/audio/dsp/aiAssistant';
import { applyGraphicEqPcm, applyParametricEqPcm, evaluateEqResponseCurve } from '../src/audio/dsp/biquad';
import {
  applyCompressorPcm,
  applyDeEsserPcm,
  applyGateExpanderPcm,
  applyLimiterPcm,
  applyMultibandPcm,
} from '../src/audio/dsp/dynamics';
import {
  applyDelayPcm,
  applyModulationPcm,
  applyReverbPcm,
  applySaturationPcm,
  applyStereoWidenerPcm,
  processMasteringChainPcm,
} from '../src/audio/dsp/effects';
import { analyzeMetering, normalizeToLufs } from '../src/audio/dsp/metering';
import { renderMultitrackMixdown } from '../src/audio/dsp/multitrackMixdown';
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
  joinPcm,
  normalizePcm,
  pitchShiftPcm,
  reversePcm,
  silenceRangePcm,
  slicePcm,
  splitPcm,
  stripSilencePcm,
  timeStretchPcm,
  trimPcm,
} from '../src/audio/dsp/pcmBuffer';
import {
  applyDeClick,
  applyHumRemoval,
  applyRestorationPipeline,
  attenuateSpectralRegion,
  computeSpectrogram,
  fft,
} from '../src/audio/dsp/restoration';
import { decodeAudioToFloatWav, exportWavToFormat, probeMediaFile } from '../src/main/ffmpegService';
import {
  consolidateProjectMedia,
  createProjectBackup,
  loadProjectSqlite,
  restoreProjectVersionSqlite,
  saveProjectSqlite,
} from '../src/main/projectStore';
import { computeWavPeakPyramid, parseWavHeader, readWavFrameWindow } from '../src/main/wavStreamService';
import {
  createInitialEdl,
  deleteEdlRange,
  insertEdlAt,
  materializeEdl,
  silenceEdlRange,
  transformEdlRange,
} from '../src/audio/dsp/edl';
import { RESTORATION_PROFILES, createDefaultMasteringChain, createInitialProject } from '../src/shared/presets';

function makeSine(freq: number, durSec: number, sr = 48000, amp = 0.5, channels = 2): PcmAudioData {
  const frames = Math.round(durSec * sr);
  const chs = Array.from({ length: channels }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) {
    const s = Math.sin((2 * Math.PI * freq * i) / sr) * amp;
    for (let c = 0; c < channels; c++) chs[c][i] = s;
  }
  return { sampleRate: sr, channels: chs };
}

describe('AUDIO STUDIO PRO - Core DSP, FFmpeg & SQLite Verification', () => {
  it('encodes and decodes 32-bit float and 16-bit WAV accurately', () => {
    const src = makeSine(440, 0.25, 48000, 0.5);
    const wav32 = encodeWavBytes(src, 32);
    const dec32 = decodeWavBytes(wav32);
    expect(dec32.sampleRate).toBe(48000);
    expect(getFrameCount(dec32)).toBe(12000);
    expect(dec32.channels[0][100]).toBeCloseTo(src.channels[0][100], 5);

    const wav16 = encodeWavBytes(src, 16);
    const dec16 = decodeWavBytes(wav16);
    expect(dec16.channels[0][100]).toBeCloseTo(src.channels[0][100], 3);
  });

  it('performs non-destructive PCM waveform operations accurately', () => {
    const src = makeSine(440, 1.0, 48000, 0.25);

    const norm = normalizePcm(src, 0);
    const normPeak = Math.max(...Array.from(norm.channels[0]).map(Math.abs));
    expect(normPeak).toBeCloseTo(1.0, 2);

    const inv = invertPhasePcm(src);
    expect(inv.channels[0][55]).toBeCloseTo(-src.channels[0][55], 5);

    const rev = reversePcm(src);
    expect(rev.channels[0][0]).toBeCloseTo(src.channels[0][47999], 5);

    const [p1, p2] = splitPcm(src, 0.4);
    expect(getDurationSec(p1)).toBeCloseTo(0.4, 3);
    expect(getDurationSec(p2)).toBeCloseTo(0.6, 3);

    const joined = joinPcm([p1, p2]);
    expect(getFrameCount(joined)).toBe(48000);

    const xfade = crossfadeJoinPcm(p1, p2, 0.05);
    expect(getFrameCount(xfade)).toBe(48000 - Math.round(0.05 * 48000));

    const { result: deleted, removed } = deleteRangePcm(src, 0.2, 0.5);
    expect(getDurationSec(deleted)).toBeCloseTo(0.7, 3);
    expect(getDurationSec(removed)).toBeCloseTo(0.3, 3);

    const pasted = insertPcm(deleted, removed, 0.2);
    expect(getDurationSec(pasted)).toBeCloseTo(1.0, 3);

    const silenced = silenceRangePcm(src, 0.1, 0.3);
    expect(silenced.channels[0][Math.round(0.2 * 48000)]).toBe(0);

    const trimmed = trimPcm(src, 0.25, 0.75);
    expect(getDurationSec(trimmed)).toBeCloseTo(0.5, 3);

    const faded = fadePcm(src, 'in', 0, 0.2);
    expect(Math.abs(faded.channels[0][0])).toBeLessThan(1e-5);

    const gained = applyGainPcm(src, 6.0206);
    expect(gained.channels[0][100]).toBeCloseTo(src.channels[0][100] * 2, 2);

    // Silence strip
    const withSilence = joinPcm([
      makeSine(440, 0.3, 48000, 0.4),
      makeSine(440, 0.5, 48000, 0.0),
      makeSine(440, 0.3, 48000, 0.4),
    ]);
    const stripped = stripSilencePcm(withSilence, -40, 0.2, 0.02);
    expect(stripped.removedSeconds).toBeGreaterThan(0.35);
    expect(getDurationSec(stripped.result)).toBeLessThan(0.8);

    // Peak detection
    const peaks = detectPeaksPcm(norm, -1, 0.05);
    expect(peaks.length).toBeGreaterThan(5);

    // Speed, Time Stretch (WSOLA), Pitch Shift
    const fast = changeSpeedPcm(src, 2.0);
    expect(getDurationSec(fast)).toBeCloseTo(0.5, 2);

    const stretched = timeStretchPcm(src, 1.25);
    expect(getDurationSec(stretched)).toBeCloseTo(0.8, 1);

    const pitched = pitchShiftPcm(src, 4);
    expect(getDurationSec(pitched)).toBeCloseTo(1.0, 1);
  });

  it('computes Peak, RMS, True Peak, Clipping, Phase Correlation and LUFS', () => {
    const tone = makeSine(1000, 1.5, 48000, 0.5);
    const m = analyzeMetering(tone);
    expect(m.peakLeftDb).toBeCloseTo(-6.02, 1);
    expect(m.rmsLeftDb).toBeCloseTo(-9.03, 1);
    expect(m.phaseCorrelation).toBeCloseTo(1, 3);
    expect(m.clipping).toBe(false);
    expect(m.integratedLufs).toBeGreaterThan(-15);
    expect(m.integratedLufs).toBeLessThan(-4);

    const normLufs = normalizeToLufs(tone, -14);
    const m2 = analyzeMetering(normLufs);
    expect(m2.integratedLufs).toBeCloseTo(-14, 0);
  });

  it('processes EQ, Dynamics and Creative Effects effectively', () => {
    const lowTone = makeSine(80, 0.5, 48000, 0.5);
    const highPassed = applyParametricEqPcm(lowTone, {
      enabled: true,
      bandCount: 4,
      bands: [{ id: 'b1', enabled: true, type: 'highpass', frequency: 500, gainDb: 0, q: 0.71 }],
    });
    const mBefore = analyzeMetering(lowTone);
    const mAfter = analyzeMetering(highPassed);
    expect(mAfter.rmsLeftDb).toBeLessThan(mBefore.rmsLeftDb - 15);

    const graphic = applyGraphicEqPcm(lowTone, {
      enabled: true,
      bandsDb: [6, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    });
    expect(analyzeMetering(graphic).rmsLeftDb).toBeGreaterThan(mBefore.rmsLeftDb);

    const curve = evaluateEqResponseCurve(
      {
        enabled: true,
        bandCount: 4,
        bands: [{ id: 'p1', enabled: true, type: 'peaking', frequency: 1000, gainDb: 6, q: 1.4 }],
      },
      { enabled: false, bandsDb: new Array(10).fill(0) },
      48000,
      [100, 1000, 10000]
    );
    expect(curve[1]).toBeCloseTo(6, 1);

    const hot = makeSine(440, 0.5, 48000, 0.9);
    const comp = applyCompressorPcm(hot, {
      enabled: true,
      thresholdDb: -20,
      ratio: 6,
      attackMs: 2,
      releaseMs: 50,
      kneeDb: 0,
      makeupGainDb: 0,
    });
    expect(analyzeMetering(comp).rmsLeftDb).toBeLessThan(analyzeMetering(hot).rmsLeftDb - 5);

    const limited = applyLimiterPcm(applyGainPcm(hot, 6), {
      enabled: true,
      ceilingDb: -1,
      releaseMs: 50,
      lookaheadMs: 2,
    });
    expect(analyzeMetering(limited).peakLeftDb).toBeLessThanOrEqual(-0.95);

    const gated = applyGateExpanderPcm(makeSine(440, 0.3, 48000, 0.005), {
      enabled: true,
      mode: 'gate',
      thresholdDb: -30,
      ratio: 4,
      attackMs: 2,
      releaseMs: 40,
      rangeDb: -40,
    });
    expect(analyzeMetering(gated).rmsLeftDb).toBeLessThan(-65);

    const mb = applyMultibandPcm(hot, {
      enabled: true,
      lowCrossHz: 200,
      highCrossHz: 3000,
      lowThresholdDb: -20,
      midThresholdDb: -20,
      highThresholdDb: -20,
      ratio: 3,
      makeupDb: 0,
    });
    expect(getFrameCount(mb)).toBe(getFrameCount(hot));

    const sibilant = makeSine(6800, 0.3, 48000, 0.6);
    const deEssed = applyDeEsserPcm(sibilant, {
      enabled: true,
      frequencyHz: 6000,
      thresholdDb: -24,
      reductionDb: 10,
    });
    expect(analyzeMetering(deEssed).rmsLeftDb).toBeLessThan(analyzeMetering(sibilant).rmsLeftDb - 3);

    // Reverb, Delay, Modulation, Saturation, Widener, Mastering
    const rev = applyReverbPcm(lowTone, { enabled: true, roomSize: 0.6, damping: 0.4, preDelayMs: 10, mix: 0.4 });
    const del = applyDelayPcm(lowTone, { enabled: true, mode: 'delay', timeMs: 120, feedback: 0.4, mix: 0.4, pingPong: true });
    const mod = applyModulationPcm(lowTone, { enabled: true, type: 'chorus', rateHz: 1.5, depth: 0.5, mix: 0.5 });
    const sat = applySaturationPcm(lowTone, { enabled: true, mode: 'saturation', drive: 0.5, toneHz: 8000, mix: 0.6 });
    const wide = applyStereoWidenerPcm(lowTone, { enabled: true, width: 1.5 });
    const master = processMasteringChainPcm(lowTone, createDefaultMasteringChain());
    expect(getFrameCount(rev)).toBe(getFrameCount(lowTone));
    expect(getFrameCount(del)).toBe(getFrameCount(lowTone));
    expect(getFrameCount(mod)).toBe(getFrameCount(lowTone));
    expect(getFrameCount(sat)).toBe(getFrameCount(lowTone));
    expect(getFrameCount(wide)).toBe(getFrameCount(lowTone));
    expect(analyzeMetering(master).truePeakDb).toBeLessThanOrEqual(-0.5);
  });

  it('performs FFT roundtrip, Spectral Editor 2D attenuation, De-Hum, De-Click & Restoration', () => {
    const n = 512;
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.sin((2 * Math.PI * 8 * i) / n);
    const orig = new Float32Array(re);
    fft(re, im, false);
    fft(re, im, true);
    for (let i = 0; i < n; i++) expect(re[i]).toBeCloseTo(orig[i], 4);

    // Mix 440Hz + 3200Hz and attenuate 2800-3600 Hz spectrally
    const a = makeSine(440, 0.5, 48000, 0.3);
    const b = makeSine(3200, 0.5, 48000, 0.3);
    for (let i = 0; i < a.channels[0].length; i++) {
      a.channels[0][i] += b.channels[0][i];
      a.channels[1][i] += b.channels[1][i];
    }

    const spec = computeSpectrogram(a, 2048, 64, 64);
    expect(spec.width).toBeGreaterThan(10);

    const cleanedSpec = attenuateSpectralRegion(
      a,
      { startSec: 0, endSec: 0.5, lowHz: 2600, highHz: 3800 },
      -40
    );
    expect(analyzeMetering(cleanedSpec).rmsLeftDb).toBeLessThan(analyzeMetering(a).rmsLeftDb - 1.5);

    // Hum 60Hz removal (measure steady-state tail after filter settling)
    const hum = makeSine(60, 0.8, 48000, 0.4);
    const deHummed = applyHumRemoval(hum, 60, 3);
    const deHumTail = slicePcm(deHummed, 0.3, 0.8);
    expect(analyzeMetering(deHumTail).rmsLeftDb).toBeLessThan(analyzeMetering(hum).rmsLeftDb - 20);

    // De-click
    const clicky = makeSine(440, 0.2, 48000, 0.1);
    clicky.channels[0][2400] = 0.95;
    const deClicked = applyDeClick(clicky, 0.8);
    expect(Math.abs(deClicked.channels[0][2400])).toBeLessThan(0.3);

    // Restoration pipeline
    const restored = applyRestorationPipeline(a, RESTORATION_PROFILES['pro-voice']);
    expect(getFrameCount(restored)).toBe(getFrameCount(a));
  });

  it('runs AI Audio Assistant analysis & MS separation honestly on real signals', () => {
    const frames = 48000;
    const sr = 48000;
    const L = new Float32Array(frames);
    const R = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      // Speech-band 800Hz + 60Hz hum + silent middle gap
      if (i < 16000 || i > 34000) {
        L[i] = 0.35 * Math.sin((2 * Math.PI * 800 * i) / sr) + 0.18 * Math.sin((2 * Math.PI * 60 * i) / sr);
        R[i] = L[i];
      }
    }
    const report = analyzeAudioWithAiAssistant({ sampleRate: sr, channels: [L, R] });
    expect(report.humDetectedHz).toBe(60);
    expect(report.silentRegions.length).toBeGreaterThanOrEqual(1);
    expect(report.speechProbability).toBeGreaterThan(0.5);
    expect(report.recommendations.some((r) => r.actionId === 'remove-hum-60')).toBe(true);

    // MS separation
    const stereoMusic: PcmAudioData = {
      sampleRate: sr,
      channels: [
        makeSine(1000, 0.2, sr, 0.4, 1).channels[0],
        makeSine(1000, 0.2, sr, -0.4, 1).channels[0],
      ],
    };
    const isolatedVoice = separateVoiceAndMusicMs(stereoMusic, 'isolate-voice');
    expect(analyzeMetering(isolatedVoice).rmsLeftDb).toBeLessThan(-80);
  });

  it('renders multitrack mixdown with automation, fades, mute and solo', () => {
    const project = createInitialProject('Test Mix');
    const tone1 = makeSine(440, 0.5, 48000, 0.4);
    const tone2 = makeSine(880, 0.5, 48000, 0.4);
    const assets = new Map<string, PcmAudioData>([
      ['a1', tone1],
      ['a2', tone2],
    ]);
    project.tracks[0].clips.push({
      id: 'c1',
      assetId: 'a1',
      name: 'Clip 1',
      trackId: project.tracks[0].id,
      startTimeSec: 0,
      offsetSec: 0,
      durationSec: 0.5,
      gainDb: 0,
      fadeInSec: 0.02,
      fadeOutSec: 0.02,
      color: '#00a8e8',
      muted: false,
      locked: false,
    });
    project.tracks[1].clips.push({
      id: 'c2',
      assetId: 'a2',
      name: 'Clip 2',
      trackId: project.tracks[1].id,
      startTimeSec: 0,
      offsetSec: 0,
      durationSec: 0.5,
      gainDb: 0,
      fadeInSec: 0,
      fadeOutSec: 0,
      color: '#00c49a',
      muted: false,
      locked: false,
    });
    // Solo track 1
    project.tracks[0].solo = true;
    const mix = renderMultitrackMixdown(project, assets);
    expect(getDurationSec(mix)).toBeCloseTo(0.5, 2);
    expect(analyzeMetering(mix).rmsLeftDb).toBeCloseTo(-11.15, 1);
  });

  it('saves, loads, and restores SQLite projects (.aspro)', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asp-sqlite-'));
    const projPath = path.join(tmpDir, 'test.aspro');
    const p1 = createInitialProject('Mi Sesión SQLite');
    await saveProjectSqlite(p1, projPath, 'Versión 1');

    const p2 = { ...p1, bpm: 138 };
    await saveProjectSqlite(p2, projPath, 'Versión 2');

    const loaded = await loadProjectSqlite(projPath);
    expect(loaded.project.bpm).toBe(138);
    expect(loaded.versions.length).toBe(2);

    const v1 = loaded.versions[1];
    const restored = await restoreProjectVersionSqlite(projPath, v1.versionId);
    expect(restored.bpm).toBe(120);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('imports and exports real audio formats via FFmpeg & FFprobe', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asp-ffmpeg-'));
    const srcWav = path.join(tmpDir, 'input.wav');
    const mp3Path = path.join(tmpDir, 'output.mp3');
    const flacPath = path.join(tmpDir, 'output.flac');
    const reDecodedWav = path.join(tmpDir, 'redecoded.wav');

    const sine = makeSine(440, 0.5, 48000, 0.5);
    fs.writeFileSync(srcWav, encodeWavBytes(sine, 32));

    const info = await probeMediaFile(srcWav);
    expect(info.sampleRate).toBe(48000);
    expect(info.channels).toBe(2);
    expect(info.duration).toBeCloseTo(0.5, 1);

    await exportWavToFormat(srcWav, {
      outputPath: mp3Path,
      format: 'mp3',
      sampleRate: 44100,
      bitDepth: 16,
      bitrateKbps: 192,
      channels: 2,
      normalizeEnabled: false,
      normalizeTargetDb: -1,
    });
    expect(fs.existsSync(mp3Path)).toBe(true);

    await exportWavToFormat(srcWav, {
      outputPath: flacPath,
      format: 'flac',
      sampleRate: 48000,
      bitDepth: 24,
      bitrateKbps: 320,
      channels: 2,
      normalizeEnabled: false,
      normalizeTargetDb: -1,
    });
    expect(fs.existsSync(flacPath)).toBe(true);

    await decodeAudioToFloatWav(flacPath, reDecodedWav, 48000);
    const decodedPcm = decodeWavBytes(fs.readFileSync(reDecodedWav));
    expect(decodedPcm.sampleRate).toBe(48000);
    expect(getDurationSec(decodedPcm)).toBeCloseTo(0.5, 1);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('streams WAV peak pyramids and frame windows, executes EDL edits, consolidates media, and renders effect automation', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asp-stream-edl-'));
    const wavPath = path.join(tmpDir, 'long.wav');
    const src = makeSine(440, 1.0, 48000, 0.5);
    fs.writeFileSync(wavPath, encodeWavBytes(src, 16));

    // 1. Chunked WAV streaming
    const header = parseWavHeader(wavPath);
    expect(header.totalFrames).toBe(48000);
    const { peaks } = computeWavPeakPyramid(wavPath, 100);
    expect(peaks.length).toBeGreaterThan(50);
    expect(peaks[0]).toBeCloseTo(0.5, 2);

    const win = readWavFrameWindow(wavPath, 12000, 6000);
    expect(getFrameCount(win)).toBe(6000);

    // 2. Non-destructive EDL
    let edl = createInitialEdl('src1', 48000, 2, 48000);
    const { result: cutEdl, removed } = deleteEdlRange(edl, 0.25, 0.5);
    edl = insertEdlAt(cutEdl, removed, 0.25);
    edl = silenceEdlRange(edl, 0.0, 0.1);
    edl = transformEdlRange(edl, 0.5, 1.0, (seg) => ({ ...seg, invertPhase: true }));
    const mat = materializeEdl(edl, (id) => (id === 'src1' ? src : undefined));
    expect(getFrameCount(mat)).toBe(48000);
    expect(mat.channels[0][100]).toBe(0);
    expect(mat.channels[0][30000]).toBeCloseTo(-src.channels[0][30000], 4);

    // 3. Self-contained project consolidation & backup
    const proj = createInitialProject('Portable Session');
    proj.assets.push({
      id: 'a1',
      name: 'long.wav',
      originalPath: wavPath,
      cachedWavPath: wavPath,
      folder: 'imported',
      duration: 1.0,
      sampleRate: 48000,
      channels: 2,
      bitDepth: 16,
      format: 'WAV',
      sizeBytes: fs.statSync(wavPath).size,
      createdAt: new Date().toISOString(),
    });
    const projFile = path.join(tmpDir, 'session', 'Portable.aspro');
    fs.mkdirSync(path.dirname(projFile), { recursive: true });
    const consolidated = consolidateProjectMedia(proj, projFile);
    expect(consolidated.assets[0].relativeMediaPath).toContain('Media');
    await saveProjectSqlite(consolidated, projFile, 'Consolidated');
    createProjectBackup(projFile);
    expect(fs.existsSync(path.join(tmpDir, 'session', 'Backups'))).toBe(true);
    const reloaded = await loadProjectSqlite(projFile);
    expect(reloaded.project.assets[0].cachedWavPath).toContain('Media');

    // 4. Effect parameter automation (eq_gain & reverb_mix)
    proj.tracks[0].clips.push({
      id: 'c1',
      assetId: 'a1',
      name: 'Tone',
      trackId: proj.tracks[0].id,
      startTimeSec: 0,
      offsetSec: 0,
      durationSec: 0.5,
      gainDb: 0,
      fadeInSec: 0,
      fadeOutSec: 0,
      color: '#00a8e8',
      muted: false,
      locked: false,
    });
    const eqLane = proj.tracks[0].automation.find((a) => a.target === 'eq_gain')!;
    eqLane.points.push({ id: 'e1', timeSec: 0, value: -6 }, { id: 'e2', timeSec: 0.5, value: 6 });
    const revLane = proj.tracks[0].automation.find((a) => a.target === 'reverb_mix')!;
    revLane.points.push({ id: 'r1', timeSec: 0, value: 0 }, { id: 'r2', timeSec: 0.5, value: 0.5 });

    const autoMix = renderMultitrackMixdown(proj, new Map([['a1', src]]));
    expect(getDurationSec(autoMix)).toBeCloseTo(0.5, 2);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('validates Windows file associations and CLI .aspro argument parsing', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
    expect(pkg.build?.fileAssociations).toBeDefined();
    expect(pkg.build.fileAssociations[0].ext).toBe('aspro');
    expect(pkg.build.fileAssociations[0].role).toBe('Editor');

    const fakeArgs = ['electron.exe', '--some-flag', 'C:\\Projects\\MiSesion.aspro'];
    const found = fakeArgs.find((a) => a.toLowerCase().endsWith('.aspro'));
    expect(found).toBe('C:\\Projects\\MiSesion.aspro');
  });
});
