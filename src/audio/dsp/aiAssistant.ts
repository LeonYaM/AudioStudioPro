import { AiAnalysisReport } from '../../shared/types';
import { computeBiquad, processBiquadChannel } from './biquad';
import { analyzeMetering, linearToDb } from './metering';
import { PcmAudioData, clonePcm, getDurationSec, getFrameCount } from './pcmBuffer';
import { fft } from './restoration';

/**
 * Local, deterministic DSP-based AI Audio Assistant.
 * Performs real spectral, loudness, noise-floor, hum, clipping, VAD, and stereo MS analysis
 * without requiring internet connectivity or simulating fake results.
 */
export function analyzeAudioWithAiAssistant(data: PcmAudioData): AiAnalysisReport {
  const frames = getFrameCount(data);
  const sr = data.sampleRate;
  const durationSec = getDurationSec(data);
  const meter = analyzeMetering(data);

  if (frames === 0 || data.channels.length === 0) {
    return {
      analyzedAt: new Date().toISOString(),
      durationSec: 0,
      peakDb: -120,
      rmsDb: -120,
      integratedLufs: -120,
      estimatedNoiseFloorDb: -120,
      estimatedSnrDb: 0,
      clippingSampleCount: 0,
      silentRegions: [],
      humDetectedHz: 0,
      speechProbability: 0,
      spectralBalance: { lowDb: -60, midDb: -60, highDb: -60 },
      recommendations: [],
    };
  }

  // 1. Clipping sample count & block RMS distribution for noise floor + silence detection
  let clippingSampleCount = 0;
  for (const ch of data.channels) {
    for (let i = 0; i < ch.length; i++) {
      if (Math.abs(ch[i]) >= 0.999) clippingSampleCount++;
    }
  }

  const blockFrames = Math.max(64, Math.round(0.05 * sr)); // 50ms blocks
  const blockRmsDbs: number[] = [];
  const silentRegions: Array<{ startSec: number; endSec: number }> = [];
  let silentStart = -1;

  for (let start = 0; start < frames; start += blockFrames) {
    const end = Math.min(frames, start + blockFrames);
    let sq = 0;
    let count = 0;
    for (const ch of data.channels) {
      for (let i = start; i < end; i++) {
        sq += ch[i] * ch[i];
        count++;
      }
    }
    const rmsDb = linearToDb(Math.sqrt(sq / Math.max(1, count)));
    blockRmsDbs.push(rmsDb);

    if (rmsDb < -46) {
      if (silentStart < 0) silentStart = start / sr;
    } else if (silentStart >= 0) {
      const endSec = start / sr;
      if (endSec - silentStart >= 0.3) {
        silentRegions.push({ startSec: silentStart, endSec });
      }
      silentStart = -1;
    }
  }
  if (silentStart >= 0 && durationSec - silentStart >= 0.3) {
    silentRegions.push({ startSec: silentStart, endSec: durationSec });
  }

  const sortedBlocks = [...blockRmsDbs].sort((a, b) => a - b);
  const p10Idx = Math.min(sortedBlocks.length - 1, Math.floor(sortedBlocks.length * 0.1));
  const estimatedNoiseFloorDb = sortedBlocks[p10Idx] ?? -90;
  const activeRmsDb = Math.max(meter.rmsLeftDb, meter.rmsRightDb);
  const estimatedSnrDb = Math.max(0, activeRmsDb - estimatedNoiseFloorDb);

  // 2. Spectral band balance + 50Hz/60Hz hum detection + speech energy ratio (300Hz - 3400Hz)
  const fftSize = 4096;
  const re = new Float32Array(fftSize);
  const im = new Float32Array(fftSize);
  const accumMag = new Float32Array(fftSize / 2);
  const step = Math.max(fftSize, Math.floor(frames / 8));
  let windows = 0;

  for (let pos = 0; pos + fftSize <= frames; pos += step) {
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < fftSize; i++) {
      let s = 0;
      for (const ch of data.channels) s += ch[i + pos];
      re[i] = (s / data.channels.length) * 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
    }
    fft(re, im, false);
    for (let b = 0; b < fftSize / 2; b++) {
      accumMag[b] += Math.hypot(re[b], im[b]);
    }
    windows++;
  }

  let lowE = 0,
    midE = 0,
    highE = 0,
    speechE = 0,
    totalE = 0;
  let mag50 = 0,
    mag60 = 0,
    neighborHum = 0,
    neighborBins = 0;

  if (windows > 0) {
    for (let b = 1; b < fftSize / 2; b++) {
      const freq = (b * sr) / fftSize;
      const m = accumMag[b] / windows;
      const e = m * m;
      totalE += e;
      if (freq < 250) lowE += e;
      else if (freq < 3500) midE += e;
      else highE += e;
      if (freq >= 250 && freq <= 3400) speechE += e;

      if (Math.abs(freq - 50) < 6) mag50 = Math.max(mag50, m);
      if (Math.abs(freq - 60) < 6) mag60 = Math.max(mag60, m);
      if ((freq >= 22 && freq <= 34) || (freq >= 82 && freq <= 105)) {
        neighborHum += m;
        neighborBins++;
      }
    }
  }
  const avgNeighbor = neighborHum / Math.max(1, neighborBins);
  let humDetectedHz: 0 | 50 | 60 = 0;
  if (mag60 > avgNeighbor * 3.5 && mag60 > mag50) humDetectedHz = 60;
  else if (mag50 > avgNeighbor * 3.5) humDetectedHz = 50;

  const speechProbability =
    totalE > 1e-12 ? Math.min(1, Math.max(0, (speechE / totalE) * 1.25)) : 0;

  const spectralBalance = {
    lowDb: linearToDb(Math.sqrt(lowE / Math.max(1, totalE))),
    midDb: linearToDb(Math.sqrt(midE / Math.max(1, totalE))),
    highDb: linearToDb(Math.sqrt(highE / Math.max(1, totalE))),
  };

  // 3. Actionable engineering recommendations
  const recommendations: AiAnalysisReport['recommendations'] = [];

  if (clippingSampleCount > 0) {
    recommendations.push({
      id: 'rec-clip',
      category: 'level',
      title: `Clipping detectado (${clippingSampleCount} muestras)`,
      description: 'Se detectaron picos >= 0 dBFS. Se recomienda normalizar a -1 dBTP o aplicar limitador True Peak.',
      severity: 'critical',
      actionId: 'normalize-safe',
    });
  }

  if (humDetectedHz > 0) {
    recommendations.push({
      id: 'rec-hum',
      category: 'restoration',
      title: `Zumbido eléctrico detectado (${humDetectedHz} Hz)`,
      description: `Se encontró energía tonal persistente en ${humDetectedHz} Hz. Aplicar filtro Notch + armónicos.`,
      severity: 'warning',
      actionId: `remove-hum-${humDetectedHz}`,
    });
  }

  if (estimatedNoiseFloorDb > -52 && estimatedSnrDb < 32) {
    recommendations.push({
      id: 'rec-noise',
      category: 'restoration',
      title: `Ruido de fondo elevado (Piso: ${estimatedNoiseFloorDb.toFixed(1)} dB)`,
      description: 'La relación señal/ruido sugiere aplicar reducción espectral de ruido moderada.',
      severity: 'warning',
      actionId: 'clean-noise',
    });
  }

  if (spectralBalance.lowDb > spectralBalance.midDb + 5) {
    recommendations.push({
      id: 'rec-mud',
      category: 'eq',
      title: 'Exceso de energía en subgraves / turbidez',
      description: 'Aplicar filtro High-Pass suave (80 Hz) y atenuar ligeramente 250-350 Hz para mejorar claridad.',
      severity: 'info',
      actionId: 'eq-clarity',
    });
  }

  if (meter.integratedLufs < -20 || meter.integratedLufs > -9) {
    recommendations.push({
      id: 'rec-lufs',
      category: 'level',
      title: `Nivel integrado ${meter.integratedLufs.toFixed(1)} LUFS`,
      description: 'Ajustar sonoridad hacia estándar Streaming (-14 LUFS) o Podcast (-16 LUFS).',
      severity: 'info',
      actionId: 'smart-lufs-14',
    });
  }

  if (speechProbability > 0.55) {
    recommendations.push({
      id: 'rec-voice',
      category: 'voice',
      title: `Contenido vocal predominante (${Math.round(speechProbability * 100)}%)`,
      description: 'Aplicar cadena vocal (compresión 3:1, de-esser y realce de presencia).',
      severity: 'info',
      actionId: 'auto-voice-polish',
    });
  }

  return {
    analyzedAt: new Date().toISOString(),
    durationSec,
    peakDb: Math.max(meter.peakLeftDb, meter.peakRightDb),
    rmsDb: activeRmsDb,
    integratedLufs: meter.integratedLufs,
    estimatedNoiseFloorDb,
    estimatedSnrDb,
    clippingSampleCount,
    silentRegions,
    humDetectedHz,
    speechProbability,
    spectralBalance,
    recommendations,
  };
}

/**
 * Center-channel / Mid-Side vocal isolation or music/backing separation for stereo recordings.
 */
export function separateVoiceAndMusicMs(
  data: PcmAudioData,
  mode: 'isolate-voice' | 'isolate-music'
): PcmAudioData {
  if (data.channels.length < 2) return clonePcm(data);
  const out = clonePcm(data);
  const L = out.channels[0];
  const R = out.channels[1];

  for (let i = 0; i < L.length; i++) {
    const mid = 0.5 * (L[i] + R[i]);
    const side = 0.5 * (L[i] - R[i]);
    if (mode === 'isolate-voice') {
      // Retain center-panned vocal energy
      L[i] = mid;
      R[i] = mid;
    } else {
      // Cancel center-panned signal to retain stereo accompaniment
      L[i] = side;
      R[i] = -side;
    }
  }

  if (mode === 'isolate-voice') {
    const hp = computeBiquad('highpass', out.sampleRate, 110, 0, 0.707);
    const lp = computeBiquad('lowpass', out.sampleRate, 8500, 0, 0.707);
    for (const ch of out.channels) {
      processBiquadChannel(ch, hp);
      processBiquadChannel(ch, lp);
    }
  }

  return out;
}
