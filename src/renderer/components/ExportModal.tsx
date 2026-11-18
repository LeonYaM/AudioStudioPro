import React, { useState } from 'react';
import { X } from 'lucide-react';
import {
  BitDepthOption,
  ExportFormat,
  ExportSettings,
  SampleRateOption,
} from '../../shared/types';

interface ExportModalProps {
  defaultName: string;
  defaultSampleRate: SampleRateOption;
  defaultBitDepth: BitDepthOption;
  hasMultitrackClips: boolean;
  onExport: (
    settings: ExportSettings,
    source: 'active-asset' | 'multitrack-mix',
    applyMastering: boolean
  ) => Promise<void>;
  onClose: () => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  defaultName,
  defaultSampleRate,
  defaultBitDepth,
  hasMultitrackClips,
  onExport,
  onClose,
}) => {
  const [source, setSource] = useState<'active-asset' | 'multitrack-mix'>(
    hasMultitrackClips ? 'multitrack-mix' : 'active-asset'
  );
  const [format, setFormat] = useState<ExportFormat>('wav');
  const [sampleRate, setSampleRate] = useState<SampleRateOption>(defaultSampleRate);
  const [bitDepth, setBitDepth] = useState<BitDepthOption>(defaultBitDepth);
  const [bitrateKbps, setBitrateKbps] = useState(320);
  const [channels, setChannels] = useState<1 | 2>(2);
  const [normalizeEnabled, setNormalizeEnabled] = useState(true);
  const [normalizeTargetDb, setNormalizeTargetDb] = useState(-1.0);
  const [applyMastering, setApplyMastering] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRun = async () => {
    setError(null);
    const outPath = await window.audioStudio.selectExportPath(defaultName, format);
    if (!outPath) return;
    setBusy(true);
    try {
      await onExport(
        {
          outputPath: outPath,
          format,
          sampleRate,
          bitDepth,
          bitrateKbps,
          channels,
          normalizeEnabled,
          normalizeTargetDb,
        },
        source,
        applyMastering
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-card" style={{ width: 520 }}>
        <div className="modal-header">
          <span>Exportar Audio Profesional</span>
          <button className="mini-btn" style={{ width: 26, height: 24 }} onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label>
            Origen de exportación
            <select
              value={source}
              onChange={(e) => setSource(e.target.value as typeof source)}
              style={{ width: '100%', marginTop: 4 }}
            >
              <option value="active-asset">Archivo activo (Editor Forma de Onda / Espectral)</option>
              <option value="multitrack-mix">Mezcla Multipista Completa</option>
            </select>
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label>
              Formato
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value as ExportFormat)}
                style={{ width: '100%', marginTop: 4 }}
              >
                <option value="wav">WAV (Sin pérdida)</option>
                <option value="flac">FLAC (Sin pérdida comprimido)</option>
                <option value="aiff">AIFF (Sin pérdida)</option>
                <option value="mp3">MP3 (LAME)</option>
                <option value="ogg">OGG Vorbis</option>
                <option value="m4a">M4A (AAC)</option>
              </select>
            </label>

            <label>
              Frecuencia de muestreo
              <select
                value={sampleRate}
                onChange={(e) => setSampleRate(Number(e.target.value) as SampleRateOption)}
                style={{ width: '100%', marginTop: 4 }}
              >
                <option value={44100}>44.1 kHz</option>
                <option value={48000}>48 kHz</option>
                <option value={88200}>88.2 kHz</option>
                <option value={96000}>96 kHz</option>
              </select>
            </label>

            <label>
              Profundidad de bits
              <select
                value={bitDepth}
                onChange={(e) => setBitDepth(Number(e.target.value) as BitDepthOption)}
                style={{ width: '100%', marginTop: 4 }}
              >
                <option value={16}>16-bit PCM</option>
                <option value={24}>24-bit PCM</option>
                <option value={32}>32-bit float</option>
              </select>
            </label>

            <label>
              Canales
              <select
                value={channels}
                onChange={(e) => setChannels(Number(e.target.value) as 1 | 2)}
                style={{ width: '100%', marginTop: 4 }}
              >
                <option value={2}>Estéreo (2 ch)</option>
                <option value={1}>Mono (1 ch)</option>
              </select>
            </label>
          </div>

          {(format === 'mp3' || format === 'ogg' || format === 'm4a') && (
            <label>
              Bitrate (kbps)
              <select
                value={bitrateKbps}
                onChange={(e) => setBitrateKbps(Number(e.target.value))}
                style={{ width: '100%', marginTop: 4 }}
              >
                <option value={128}>128 kbps</option>
                <option value={192}>192 kbps</option>
                <option value={256}>256 kbps</option>
                <option value={320}>320 kbps (Máxima calidad)</option>
              </select>
            </label>
          )}

          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                checked={normalizeEnabled}
                onChange={(e) => setNormalizeEnabled(e.target.checked)}
              />
              Normalizar pico a (dB)
            </label>
            <input
              type="number"
              step={0.1}
              max={0}
              min={-12}
              value={normalizeTargetDb}
              onChange={(e) => setNormalizeTargetDb(Number(e.target.value))}
              style={{ width: 70 }}
            />
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={applyMastering}
              onChange={(e) => setApplyMastering(e.target.checked)}
            />
            Aplicar Cadena de Masterización activa durante la exportación
          </label>

          {error && <div className="badge badge-crit">{error}</div>}
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button className="btn-primary" onClick={handleRun} disabled={busy}>
            {busy ? 'Exportando con FFmpeg...' : 'Exportar Archivo'}
          </button>
        </div>
      </div>
    </div>
  );
};
