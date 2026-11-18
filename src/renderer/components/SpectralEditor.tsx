import React, { useEffect, useRef, useState } from 'react';
import { PcmAudioData, getDurationSec } from '../../audio/dsp/pcmBuffer';
import { SpectrogramData } from '../../audio/dsp/restoration';
import { dspWorker } from '../../audio/workers/DspWorkerClient';
import { MediaAsset, SpectralSelection } from '../../shared/types';

interface SpectralEditorProps {
  asset?: MediaAsset;
  pcm?: PcmAudioData;
  cursorSec: number;
  onSeek: (sec: number) => void;
  onAttenuateSelection: (sel: SpectralSelection, attenuationDb: number) => void;
  onDeHum: (hz: 50 | 60) => void;
  onDeClick: () => void;
  onSpectralNoiseClean: () => void;
  onImportAudio: () => void;
}

function dbToMagmaColor(db: number): [number, number, number] {
  const norm = Math.max(0, Math.min(1, (db + 90) / 85));
  if (norm < 0.25) {
    const t = norm / 0.25;
    return [Math.round(t * 45), Math.round(t * 15), Math.round(20 + t * 90)];
  }
  if (norm < 0.55) {
    const t = (norm - 0.25) / 0.3;
    return [Math.round(45 + t * 145), Math.round(15 + t * 35), Math.round(110 - t * 20)];
  }
  if (norm < 0.85) {
    const t = (norm - 0.55) / 0.3;
    return [Math.round(190 + t * 60), Math.round(50 + t * 140), Math.round(90 - t * 75)];
  }
  const t = (norm - 0.85) / 0.15;
  return [255, Math.round(190 + t * 65), Math.round(15 + t * 200)];
}

export const SpectralEditor: React.FC<SpectralEditorProps> = ({
  asset,
  pcm,
  cursorSec,
  onSeek,
  onAttenuateSelection,
  onDeHum,
  onDeClick,
  onSpectralNoiseClean,
  onImportAudio,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selection, setSelection] = useState<SpectralSelection | null>(null);
  const [dragOrigin, setDragOrigin] = useState<{ t: number; hz: number } | null>(null);
  const [attenuationDb, setAttenuationDb] = useState(-36);
  const [spectrogram, setSpectrogram] = useState<SpectrogramData | null>(null);
  const [computing, setComputing] = useState(false);

  useEffect(() => {
    if (!pcm) {
      setSpectrogram(null);
      return;
    }
    let cancelled = false;
    setComputing(true);
    dspWorker
      .computeSpectrogram(pcm, 900, 320)
      .then((res) => {
        if (!cancelled) setSpectrogram(res);
      })
      .finally(() => {
        if (!cancelled) setComputing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pcm]);

  const duration = pcm ? getDurationSec(pcm) : 0;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !spectrogram) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height, magnitudesDb } = spectrogram;
    canvas.width = width;
    canvas.height = height;
    const img = ctx.createImageData(width, height);

    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        // y=0 top is high frequency; height-1 bottom is low frequency
        const freqRow = height - 1 - y;
        const db = magnitudesDb[x * height + freqRow];
        const [r, g, b] = dbToMagmaColor(db);
        const idx = (y * width + x) * 4;
        img.data[idx] = r;
        img.data[idx + 1] = g;
        img.data[idx + 2] = b;
        img.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [spectrogram]);

  const yRatioToFreq = (yRatio: number): number => {
    if (!spectrogram) return 1000;
    const logMin = Math.log10(spectrogram.minFreqHz);
    const logMax = Math.log10(spectrogram.maxFreqHz);
    // y=0 top -> maxFreq, y=1 bottom -> minFreq
    const frac = 1 - Math.max(0, Math.min(1, yRatio));
    return Math.pow(10, logMin + frac * (logMax - logMin));
  };

  const freqToYRatio = (freq: number): number => {
    if (!spectrogram) return 0.5;
    const logMin = Math.log10(spectrogram.minFreqHz);
    const logMax = Math.log10(spectrogram.maxFreqHz);
    const frac = (Math.log10(Math.max(spectrogram.minFreqHz, freq)) - logMin) / (logMax - logMin);
    return 1 - Math.max(0, Math.min(1, frac));
  };

  const getCoords = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const xRatio = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
    const yRatio = Math.max(0, Math.min(1, (e.clientY - rect.top) / Math.max(1, rect.height)));
    return {
      t: xRatio * duration,
      hz: yRatioToFreq(yRatio),
    };
  };

  if (computing && pcm && asset) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--accent-electric)',
          fontWeight: 600,
        }}
      >
        Calculando espectrograma de alta resolución (Web Worker)...
      </div>
    );
  }

  if (!pcm || !asset || !spectrogram) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          color: 'var(--text-secondary)',
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 600 }}>Editor Espectral (Frecuencia Logarítmica × Tiempo)</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Importe o seleccione un audio para visualizar su espectrograma y limpiar ruidos, clics o zumbidos por frecuencia.
        </div>
        <button className="btn-primary" onClick={onImportAudio}>
          Importar Archivo de Audio
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 8, gap: 8 }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 6,
          padding: '6px 8px',
          background: 'var(--bg-panel)',
          border: '1px solid var(--border-dark)',
          borderRadius: 6,
        }}
      >
        <span style={{ fontWeight: 700, color: 'var(--accent-electric)', marginRight: 6 }}>
          Espectral: {asset.name}
        </span>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span>Atenuación</span>
          <select
            value={attenuationDb}
            onChange={(e) => setAttenuationDb(Number(e.target.value))}
          >
            <option value={-12}>-12 dB (Suave)</option>
            <option value={-24}>-24 dB (Moderada)</option>
            <option value={-36}>-36 dB (Fuerte)</option>
            <option value={-60}>-60 dB (Eliminar)</option>
          </select>
        </label>
        <button
          className="btn-primary"
          disabled={!selection}
          onClick={() => selection && onAttenuateSelection(selection, attenuationDb)}
        >
          Atenuar región seleccionada
        </button>
        <button className="tool-btn" onClick={() => onDeHum(50)}>
          Eliminar zumbido 50 Hz
        </button>
        <button className="tool-btn" onClick={() => onDeHum(60)}>
          Eliminar zumbido 60 Hz
        </button>
        <button className="tool-btn" onClick={onDeClick}>
          Eliminar clics
        </button>
        <button className="tool-btn" onClick={onSpectralNoiseClean}>
          Limpieza espectral ruido
        </button>
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0, gap: 6 }}>
        {/* Log frequency axis */}
        <div
          style={{
            width: 52,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            fontSize: 10,
            color: 'var(--text-muted)',
            textAlign: 'right',
            paddingRight: 4,
            fontFamily: 'var(--font-mono)',
          }}
        >
          <span>20kHz</span>
          <span>10kHz</span>
          <span>4kHz</span>
          <span>1kHz</span>
          <span>250Hz</span>
          <span>60Hz</span>
          <span>20Hz</span>
        </div>

        <div
          onMouseDown={(e) => {
            const c = getCoords(e);
            onSeek(c.t);
            setDragOrigin(c);
            setSelection({ startSec: c.t, endSec: c.t, lowHz: c.hz, highHz: c.hz });
          }}
          onMouseMove={(e) => {
            if (!dragOrigin) return;
            const c = getCoords(e);
            setSelection({
              startSec: Math.min(dragOrigin.t, c.t),
              endSec: Math.max(dragOrigin.t, c.t),
              lowHz: Math.min(dragOrigin.hz, c.hz),
              highHz: Math.max(dragOrigin.hz, c.hz),
            });
          }}
          onMouseUp={() => setDragOrigin(null)}
          style={{
            flex: 1,
            position: 'relative',
            border: '1px solid var(--border-dark)',
            borderRadius: 6,
            overflow: 'hidden',
            cursor: 'crosshair',
            background: '#050508',
          }}
        >
          <canvas
            ref={canvasRef}
            style={{ width: '100%', height: '100%', display: 'block', imageRendering: 'auto' }}
          />

          {/* Cursor line */}
          {duration > 0 && (
            <div
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: `${(cursorSec / duration) * 100}%`,
                width: 2,
                background: '#facc15',
                pointerEvents: 'none',
              }}
            />
          )}

          {/* 2D Time x Frequency Selection Box */}
          {selection && duration > 0 && (
            <div
              style={{
                position: 'absolute',
                left: `${(selection.startSec / duration) * 100}%`,
                width: `${((selection.endSec - selection.startSec) / duration) * 100}%`,
                top: `${freqToYRatio(selection.highHz) * 100}%`,
                height: `${Math.max(
                  1,
                  (freqToYRatio(selection.lowHz) - freqToYRatio(selection.highHz)) * 100
                )}%`,
                background: 'rgba(0, 168, 232, 0.25)',
                border: '1px dashed #38bdf8',
                pointerEvents: 'none',
              }}
            />
          )}
        </div>
      </div>

      <div style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between' }}>
        <span>
          Arrastre un rectángulo en el espectrograma para seleccionar un rango exacto de tiempo y frecuencia.
        </span>
        {selection && (
          <span style={{ color: 'var(--accent-electric)', fontFamily: 'var(--font-mono)' }}>
            {selection.startSec.toFixed(2)}s–{selection.endSec.toFixed(2)}s |{' '}
            {Math.round(selection.lowHz)} Hz–{Math.round(selection.highHz)} Hz
          </span>
        )}
      </div>
    </div>
  );
};
