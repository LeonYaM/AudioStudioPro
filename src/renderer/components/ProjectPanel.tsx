import React, { useState } from 'react';
import { FileAudio, FolderOpen, Mic, Plus, Sparkles } from 'lucide-react';
import { AudioFolderKind, MediaAsset } from '../../shared/types';

interface ProjectPanelProps {
  assets: MediaAsset[];
  activeAssetId?: string;
  historyEntries: string[];
  onImportAudio: () => void;
  onSelectAsset: (assetId: string) => void;
  onInsertToMultitrack: (assetId: string) => void;
}

type PanelView = 'all' | AudioFolderKind | 'history';

export const ProjectPanel: React.FC<ProjectPanelProps> = ({
  assets,
  activeAssetId,
  historyEntries,
  onImportAudio,
  onSelectAsset,
  onInsertToMultitrack,
}) => {
  const [view, setView] = useState<PanelView>('all');

  const filtered =
    view === 'all'
      ? assets
      : view === 'history'
      ? []
      : assets.filter((a) => a.folder === view);

  const fmtDur = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = (sec % 60).toFixed(1).padStart(4, '0');
    return `${m}:${s}`;
  };

  return (
    <aside className="left-panel">
      <div className="panel-header">
        <span>Proyecto y Medios</span>
        <button
          className="tool-btn"
          style={{ height: 22, padding: '0 6px' }}
          onClick={onImportAudio}
          title="Importar archivos de audio"
        >
          <Plus size={12} /> Importar
        </button>
      </div>

      <div className="folder-tabs">
        <button className={`folder-tab ${view === 'all' ? 'active' : ''}`} onClick={() => setView('all')}>
          Todos ({assets.length})
        </button>
        <button className={`folder-tab ${view === 'imported' ? 'active' : ''}`} onClick={() => setView('imported')}>
          Importados
        </button>
        <button className={`folder-tab ${view === 'recordings' ? 'active' : ''}`} onClick={() => setView('recordings')}>
          Grabaciones
        </button>
        <button className={`folder-tab ${view === 'processed' ? 'active' : ''}`} onClick={() => setView('processed')}>
          Procesados
        </button>
        <button className={`folder-tab ${view === 'custom' ? 'active' : ''}`} onClick={() => setView('custom')}>
          Carpetas
        </button>
        <button className={`folder-tab ${view === 'history' ? 'active' : ''}`} onClick={() => setView('history')}>
          Historial
        </button>
      </div>

      <div className="asset-list">
        {view === 'history' ? (
          historyEntries.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', padding: 10 }}>
              Sin operaciones recientes todavía.
            </div>
          ) : (
            historyEntries.map((item, idx) => (
              <div className="asset-card" key={`hist-${idx}`}>
                <div className="asset-name">{item}</div>
              </div>
            ))
          )
        ) : filtered.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', padding: 12, textAlign: 'center', lineHeight: 1.5 }}>
            <FolderOpen size={24} style={{ marginBottom: 6, opacity: 0.6 }} />
            <div>Sin archivos en esta vista.</div>
            <div style={{ fontSize: 10 }}>
              Use "Importar" o arrastre WAV, MP3, FLAC, AIFF, OGG, M4A, AAC o WMA.
            </div>
          </div>
        ) : (
          filtered.map((asset) => (
            <div
              key={asset.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('application/x-asp-asset', asset.id);
              }}
              className={`asset-card ${activeAssetId === asset.id ? 'selected' : ''}`}
              onClick={() => onSelectAsset(asset.id)}
              onDoubleClick={() => onInsertToMultitrack(asset.id)}
              title="Clic: abrir en editor | Doble clic o arrastrar: insertar en multipista"
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {asset.folder === 'recordings' ? (
                  <Mic size={12} color="#ef4444" />
                ) : asset.folder === 'processed' ? (
                  <Sparkles size={12} color="#00a8e8" />
                ) : (
                  <FileAudio size={12} color="#22c55e" />
                )}
                <span className="asset-name">{asset.name}</span>
              </div>
              <div className="asset-meta">
                <span>
                  {fmtDur(asset.duration)} · {asset.sampleRate / 1000}kHz ·{' '}
                  {asset.channels === 1 ? 'Mono' : `${asset.channels}ch`}
                </span>
                <span>{asset.format}</span>
              </div>
              <button
                className="tool-btn"
                style={{ height: 20, fontSize: 10, marginTop: 2 }}
                onClick={(e) => {
                  e.stopPropagation();
                  onInsertToMultitrack(asset.id);
                }}
              >
                + Enviar a Multipista
              </button>
            </div>
          ))
        )}
      </div>
    </aside>
  );
};
