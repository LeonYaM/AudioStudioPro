import React from 'react';
import {
  Circle,
  Pause,
  Play,
  Repeat,
  Rewind,
  FastForward,
  Square,
} from 'lucide-react';
import { BitDepthOption, SampleRateOption } from '../../shared/types';

interface TransportFooterProps {
  isPlaying: boolean;
  isRecording: boolean;
  loopEnabled: boolean;
  cursorSec: number;
  bpm: number;
  sampleRate: SampleRateOption;
  bitDepth: BitDepthOption;
  inputLevelDb: number;
  countdownRemaining: number | null;
  driverStatus: string;
  punchEnabled: boolean;
  punchInSec: number;
  punchOutSec: number;
  onTogglePunch: () => void;
  onChangePunchRange: (inSec: number, outSec: number) => void;
  onPlayPause: () => void;
  onStop: () => void;
  onRecordToggle: () => void;
  onRewind: () => void;
  onForward: () => void;
  onToggleLoop: () => void;
  onChangeBpm: (bpm: number) => void;
  onChangeSampleRate: (sr: SampleRateOption) => void;
  onChangeBitDepth: (bd: BitDepthOption) => void;
}

export function formatTimecode(seconds: number): string {
  const s = Math.max(0, seconds);
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = Math.floor(s % 60);
  const ms = Math.floor((s - Math.floor(s)) * 1000);
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(
    secs
  ).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

export const TransportFooter: React.FC<TransportFooterProps> = ({
  isPlaying,
  isRecording,
  loopEnabled,
  cursorSec,
  bpm,
  sampleRate,
  bitDepth,
  inputLevelDb,
  countdownRemaining,
  driverStatus,
  punchEnabled,
  punchInSec,
  punchOutSec,
  onTogglePunch,
  onChangePunchRange,
  onPlayPause,
  onStop,
  onRecordToggle,
  onRewind,
  onForward,
  onToggleLoop,
  onChangeBpm,
  onChangeSampleRate,
  onChangeBitDepth,
}) => {
  const inputPct = Math.max(0, Math.min(100, ((inputLevelDb + 60) / 60) * 100));

  return (
    <footer className="transport-footer">
      <div className="transport-controls">
        <button className="t-btn" onClick={onRewind} title="Retroceso (-5s)">
          <Rewind size={14} />
        </button>
        <button
          className={`t-btn ${isPlaying ? 'playing' : ''}`}
          onClick={onPlayPause}
          title="Reproducir / Pausar (Espacio)"
        >
          {isPlaying ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <button className="t-btn" onClick={onStop} title="Detener">
          <Square size={13} />
        </button>
        <button
          className={`t-btn ${isRecording ? 'recording' : ''}`}
          onClick={onRecordToggle}
          title="Grabar (R)"
        >
          <Circle size={13} fill={isRecording ? '#fff' : '#ef4444'} color="#ef4444" />
        </button>
        <button className="t-btn" onClick={onForward} title="Avance (+5s)">
          <FastForward size={14} />
        </button>
        <button
          className={`t-btn ${loopEnabled ? 'loop-active' : ''}`}
          onClick={onToggleLoop}
          title="Repetición (Loop)"
        >
          <Repeat size={14} />
        </button>

        <button
          className={`tool-btn ${punchEnabled ? 'active' : ''}`}
          onClick={onTogglePunch}
          title="Grabación automática Punch In / Punch Out"
          style={{ marginLeft: 4 }}
        >
          Punch
        </button>
        {punchEnabled && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10 }}>
            <input
              type="number"
              min={0}
              step={0.5}
              value={punchInSec}
              onChange={(e) => onChangePunchRange(Number(e.target.value), punchOutSec)}
              title="Punch In (s)"
              style={{ width: 46, padding: '2px 4px' }}
            />
            <span>–</span>
            <input
              type="number"
              min={0.5}
              step={0.5}
              value={punchOutSec}
              onChange={(e) => onChangePunchRange(punchInSec, Number(e.target.value))}
              title="Punch Out (s)"
              style={{ width: 46, padding: '2px 4px' }}
            />
          </div>
        )}

        {countdownRemaining !== null && (
          <span className="badge badge-warn" style={{ marginLeft: 6 }}>
            Grabación en {countdownRemaining}...
          </span>
        )}
        {isRecording && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginLeft: 8 }}>
            <span style={{ fontSize: 10, color: '#f87171', fontWeight: 700 }}>IN</span>
            <div
              style={{
                width: 64,
                height: 8,
                background: '#090b0f',
                border: '1px solid var(--border-dark)',
                borderRadius: 3,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${inputPct}%`,
                  height: '100%',
                  background: inputLevelDb > -3 ? '#ef4444' : '#22c55e',
                }}
              />
            </div>
          </div>
        )}
      </div>

      <div className="timecode-display">{formatTimecode(cursorSec)}</div>

      <div className="status-controls">
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span>BPM</span>
          <input
            type="number"
            min={30}
            max={300}
            value={bpm}
            onChange={(e) => onChangeBpm(Math.max(30, Math.min(300, Number(e.target.value) || 120)))}
            style={{ width: 54 }}
          />
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span>SR</span>
          <select
            value={sampleRate}
            onChange={(e) => onChangeSampleRate(Number(e.target.value) as SampleRateOption)}
          >
            <option value={44100}>44.1 kHz</option>
            <option value={48000}>48 kHz</option>
            <option value={88200}>88.2 kHz</option>
            <option value={96000}>96 kHz</option>
          </select>
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span>Bits</span>
          <select
            value={bitDepth}
            onChange={(e) => onChangeBitDepth(Number(e.target.value) as BitDepthOption)}
          >
            <option value={16}>16-bit</option>
            <option value={24}>24-bit</option>
            <option value={32}>32-bit float</option>
          </select>
        </label>

        <span
          style={{
            fontSize: 10.5,
            color: 'var(--accent-electric)',
            borderLeft: '1px solid var(--border-dark)',
            paddingLeft: 8,
          }}
        >
          {driverStatus}
        </span>
      </div>
    </footer>
  );
};
