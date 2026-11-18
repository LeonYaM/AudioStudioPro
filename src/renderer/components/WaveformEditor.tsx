import React, { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import {
  EditTool,
  MediaAsset,
  TimelineMarker,
} from '../../shared/types';
import { PcmAudioData, encodeWavBytes, getDurationSec } from '../../audio/dsp/pcmBuffer';
import { analyzeMetering } from '../../audio/dsp/metering';

export interface WaveformAction {
  type:
    | 'cut'
    | 'copy'
    | 'paste'
    | 'delete'
    | 'trim'
    | 'split'
    | 'silence'
    | 'normalize'
    | 'invert-phase'
    | 'reverse'
    | 'gain'
    | 'fade-in'
    | 'fade-out'
    | 'crossfade-clipboard'
    | 'speed'
    | 'pitch'
    | 'time-stretch'
    | 'strip-silence'
    | 'detect-peaks';
  value?: number;
}

interface WaveformEditorProps {
  asset?: MediaAsset;
  pcm?: PcmAudioData;
  activeTool: EditTool;
  cursorSec: number;
  zoomLevel: number;
  selection: { startSec: number; endSec: number } | null;
  markers: TimelineMarker[];
  detectedPeaks: Array<{ timeSec: number; db: number }>;
  onSeek: (sec: number) => void;
  onChangeSelection: (sel: { startSec: number; endSec: number } | null) => void;
  onAction: (action: WaveformAction) => void;
  onJoinWithAsset?: () => void;
  onImportAudio: () => void;
}

export const WaveformEditor: React.FC<WaveformEditorProps> = ({
  asset,
  pcm,
  activeTool,
  cursorSec,
  zoomLevel,
  selection,
  markers,
  detectedPeaks,
  onSeek,
  onChangeSelection,
  onAction,
  onImportAudio,
}) => {
  const wsContainerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [dragStartSec, setDragStartSec] = useState<number | null>(null);
  const [gainInputDb, setGainInputDb] = useState(3);
  const [speedInput, setSpeedInput] = useState(1.1);
  const [pitchInput, setPitchInput] = useState(2);

  const duration = pcm ? getDurationSec(pcm) : 0;
  const meter = React.useMemo(() => (pcm ? analyzeMetering(pcm) : null), [pcm]);

  useEffect(() => {
    const container = wsContainerRef.current;
    if (!container || !pcm) return;

    const ws = WaveSurfer.create({
      container,
      waveColor: '#00a8e8',
      progressColor: '#0e7490',
      cursorColor: '#facc15',
      cursorWidth: 2,
      height: 230,
      normalize: false,
      splitChannels: pcm.channels.length > 1 ? [{ waveColor: '#00a8e8', progressColor: '#0e7490' }, { waveColor: '#22c55e', progressColor: '#15803d' }] : undefined,
      interact: false,
      minPxPerSec: Math.max(20, zoomLevel * 60),
    });

    const wavBytes = encodeWavBytes(pcm, 16);
    const blob = new Blob([wavBytes.buffer as ArrayBuffer], { type: 'audio/wav' });
    void ws.loadBlob(blob);
    wsRef.current = ws;

    return () => {
      ws.destroy();
      wsRef.current = null;
    };
  }, [pcm]);

  useEffect(() => {
    if (wsRef.current && duration > 0) {
      try {
        wsRef.current.zoom(Math.max(20, zoomLevel * 60));
      } catch {
        // WaveSurfer may still be loading
      }
    }
  }, [zoomLevel, duration]);

  useEffect(() => {
    if (wsRef.current && duration > 0) {
      wsRef.current.setTime(Math.max(0, Math.min(duration, cursorSec)));
    }
  }, [cursorSec, duration]);

  const clientXToTime = (clientX: number): number => {
    const el = overlayRef.current;
    if (!el || duration <= 0) return 0;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
    return ratio * duration;
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!pcm || duration <= 0) return;
    const t = clientXToTime(e.clientX);
    if (activeTool === 'razor') {
      onSeek(t);
      onAction({ type: 'split', value: t });
      return;
    }
    onSeek(t);
    setDragStartSec(t);
    onChangeSelection({ startSec: t, endSec: t });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (dragStartSec === null || !pcm || duration <= 0) return;
    const t = clientXToTime(e.clientX);
    onChangeSelection({
      startSec: Math.min(dragStartSec, t),
      endSec: Math.max(dragStartSec, t),
    });
  };

  const handleMouseUp = () => {
    if (dragStartSec === null) return;
    setDragStartSec(null);
    if (selection && Math.abs(selection.endSec - selection.startSec) < 0.01) {
      onChangeSelection(null);
    }
  };

  if (!pcm || !asset) {
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
        <div style={{ fontSize: 15, fontWeight: 600 }}>Editor de Forma de Onda (No Destructivo)</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Importe un archivo de audio o seleccione uno del Panel de Proyecto para comenzar a editar.
        </div>
        <button className="btn-primary" onClick={onImportAudio}>
          Importar Archivo de Audio (WAV, MP3, FLAC, AIFF, OGG, M4A, WMA)
        </button>
      </div>
    );
  }

  const selLeftPct = selection && duration > 0 ? (selection.startSec / duration) * 100 : 0;
  const selWidthPct =
    selection && duration > 0 ? ((selection.endSec - selection.startSec) / duration) * 100 : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 8, gap: 8 }}>
      {/* Action strip */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 5,
          padding: '6px 8px',
          background: 'var(--bg-panel)',
          border: '1px solid var(--border-dark)',
          borderRadius: 6,
        }}
      >
        <span style={{ fontWeight: 700, color: 'var(--accent-electric)', marginRight: 6 }}>
          {asset.name}
        </span>
        <button className="tool-btn" onClick={() => onAction({ type: 'normalize', value: -0.5 })}>
          Normalizar
        </button>
        <button className="tool-btn" onClick={() => onAction({ type: 'silence' })}>
          Silenciar
        </button>
        <button className="tool-btn" onClick={() => onAction({ type: 'trim' })}>
          Recortar
        </button>
        <button className="tool-btn" onClick={() => onAction({ type: 'invert-phase' })}>
          Invertir fase
        </button>
        <button className="tool-btn" onClick={() => onAction({ type: 'reverse' })}>
          Invertir audio
        </button>
        <button className="tool-btn" onClick={() => onAction({ type: 'fade-in' })}>
          Fundido entrada
        </button>
        <button className="tool-btn" onClick={() => onAction({ type: 'fade-out' })}>
          Fundido salida
        </button>
        <button className="tool-btn" onClick={() => onAction({ type: 'crossfade-clipboard' })}>
          Fundido cruzado
        </button>
        <button className="tool-btn" onClick={() => onAction({ type: 'strip-silence' })}>
          Eliminar silencios
        </button>
        <button className="tool-btn" onClick={() => onAction({ type: 'detect-peaks' })}>
          Detectar picos
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginLeft: 4 }}>
          <input
            type="number"
            step={0.5}
            value={gainInputDb}
            onChange={(e) => setGainInputDb(Number(e.target.value))}
            style={{ width: 52 }}
          />
          <button className="tool-btn" onClick={() => onAction({ type: 'gain', value: gainInputDb })}>
            Ganancia dB
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <input
            type="number"
            step={0.05}
            min={0.5}
            max={2}
            value={speedInput}
            onChange={(e) => setSpeedInput(Number(e.target.value))}
            style={{ width: 52 }}
          />
          <button className="tool-btn" onClick={() => onAction({ type: 'speed', value: speedInput })}>
            Velocidad
          </button>
          <button className="tool-btn" onClick={() => onAction({ type: 'time-stretch', value: speedInput })}>
            Duración
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <input
            type="number"
            step={1}
            min={-12}
            max={12}
            value={pitchInput}
            onChange={(e) => setPitchInput(Number(e.target.value))}
            style={{ width: 46 }}
          />
          <button className="tool-btn" onClick={() => onAction({ type: 'pitch', value: pitchInput })}>
            Tono (st)
          </button>
        </div>
      </div>

      {/* Waveform container */}
      <div
        style={{
          flex: 1,
          position: 'relative',
          background: '#0c0e12',
          border: '1px solid var(--border-dark)',
          borderRadius: 6,
          overflowX: 'auto',
          overflowY: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '12px 0',
        }}
      >
        <div
          ref={overlayRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          style={{
            position: 'relative',
            width: `${Math.max(100, zoomLevel * 100)}%`,
            minHeight: 240,
            cursor: activeTool === 'razor' ? 'crosshair' : 'text',
          }}
        >
          <div ref={wsContainerRef} />

          {/* Selection Overlay */}
          {selection && selWidthPct > 0 && (
            <div
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: `${selLeftPct}%`,
                width: `${selWidthPct}%`,
                background: 'rgba(0, 168, 232, 0.24)',
                borderLeft: '1px solid #38bdf8',
                borderRight: '1px solid #38bdf8',
                pointerEvents: 'none',
              }}
            />
          )}

          {/* Markers */}
          {markers.map((m) => (
            <div
              key={m.id}
              title={m.name}
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: `${duration > 0 ? (m.timeSec / duration) * 100 : 0}%`,
                width: 2,
                background: m.color,
                pointerEvents: 'none',
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  top: 2,
                  left: 3,
                  background: m.color,
                  color: '#000',
                  fontSize: 9,
                  fontWeight: 700,
                  padding: '1px 4px',
                  borderRadius: 2,
                  whiteSpace: 'nowrap',
                }}
              >
                {m.name}
              </span>
            </div>
          ))}

          {/* Detected peaks */}
          {detectedPeaks.map((p, idx) => (
            <div
              key={`pk-${idx}`}
              title={`Pico: ${p.db.toFixed(1)} dB @ ${p.timeSec.toFixed(2)}s`}
              style={{
                position: 'absolute',
                top: 0,
                left: `${duration > 0 ? (p.timeSec / duration) * 100 : 0}%`,
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: '#ef4444',
                transform: 'translateX(-3px)',
                pointerEvents: 'none',
              }}
            />
          ))}
        </div>
      </div>

      {/* Info Footer */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 11,
          color: 'var(--text-secondary)',
          padding: '2px 4px',
        }}
      >
        <span>
          Duración: {duration.toFixed(3)}s | {pcm.sampleRate} Hz | {pcm.channels.length} ch
          {selection
            ? ` | Selección: ${selection.startSec.toFixed(3)}s – ${selection.endSec.toFixed(3)}s (${(
                selection.endSec - selection.startSec
              ).toFixed(3)}s)`
            : ' | Sin selección (edición aplica a todo el archivo)'}
        </span>
        {meter && (
          <span>
            Peak: {Math.max(meter.peakLeftDb, meter.peakRightDb).toFixed(1)} dB | RMS:{' '}
            {Math.max(meter.rmsLeftDb, meter.rmsRightDb).toFixed(1)} dB | LUFS:{' '}
            {meter.integratedLufs.toFixed(1)} LUFS | True Peak: {meter.truePeakDb.toFixed(1)} dBTP
          </span>
        )}
      </div>
    </div>
  );
};
