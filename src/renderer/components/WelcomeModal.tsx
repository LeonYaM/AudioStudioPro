import React from 'react';
import { Disc3, FileAudio, FolderOpen, Plus, X } from 'lucide-react';
import { RecentProjectEntry } from '../../shared/types';

interface WelcomeModalProps {
  recentProjects: RecentProjectEntry[];
  onNewProject: () => void;
  onOpenProject: () => void;
  onOpenRecentProject: (filePath: string) => void;
  onImportAudio: () => void;
  onClose: () => void;
}

export const WelcomeModal: React.FC<WelcomeModalProps> = ({
  recentProjects,
  onNewProject,
  onOpenProject,
  onOpenRecentProject,
  onImportAudio,
  onClose,
}) => {
  return (
    <div className="modal-backdrop">
      <div className="modal-card" style={{ width: 720 }}>
        <div className="modal-header">
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#00a8e8' }}>
            <Disc3 size={18} /> AUDIO STUDIO PRO — Estación de Trabajo de Audio Digital
          </span>
          <button className="mini-btn" style={{ width: 26, height: 24 }} onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="modal-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1.1fr', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>Inicio Rápido</div>
            <button
              className="btn-primary"
              style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', padding: 10 }}
              onClick={() => {
                onNewProject();
                onClose();
              }}
            >
              <Plus size={15} /> Crear Nuevo Proyecto (32–64 Pistas)
            </button>
            <button
              className="btn-secondary"
              style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', padding: 9 }}
              onClick={() => {
                onImportAudio();
                onClose();
              }}
            >
              <FileAudio size={15} /> Abrir Archivo de Audio (WAV/MP3/FLAC/M4A...)
            </button>
            <button
              className="btn-secondary"
              style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', padding: 9 }}
              onClick={() => {
                onOpenProject();
                onClose();
              }}
            >
              <FolderOpen size={15} /> Abrir Proyecto Existente (.aspro)
            </button>

            <div
              style={{
                marginTop: 6,
                background: 'var(--bg-elevated)',
                padding: 10,
                borderRadius: 6,
                fontSize: 11,
                lineHeight: 1.55,
                color: 'var(--text-secondary)',
              }}
            >
              <strong style={{ color: 'var(--text-primary)' }}>Guía Rápida:</strong>
              <div>1. Importe audio o grabe directo desde su micrófono/interfaz.</div>
              <div>2. Edite sin alterar el original en <strong>Forma de Onda</strong>, mezcle en <strong>Multipista</strong> o limpie frecuencias en <strong>Espectral</strong>.</div>
              <div>3. Use <strong>Efectos</strong>, <strong>Restauración</strong>, <strong>Master</strong> o el <strong>AI Audio Assistant</strong> y exporte vía FFmpeg.</div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>Proyectos Recientes</div>
            <div
              style={{
                flex: 1,
                background: 'var(--bg-elevated)',
                borderRadius: 6,
                border: '1px solid var(--border-dark)',
                padding: 8,
                overflowY: 'auto',
                maxHeight: 280,
                display: 'flex',
                flexDirection: 'column',
                gap: 5,
              }}
            >
              {recentProjects.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', padding: 12 }}>
                  No hay proyectos guardados todavía.
                </div>
              ) : (
                recentProjects.map((rp) => (
                  <button
                    key={rp.id}
                    className="asset-card"
                    style={{ textAlign: 'left' }}
                    onClick={() => {
                      onOpenRecentProject(rp.filePath);
                      onClose();
                    }}
                  >
                    <div className="asset-name">{rp.name}</div>
                    <div className="asset-meta">
                      <span>{rp.sampleRate / 1000} kHz · {rp.trackCount} pistas</span>
                      <span>{new Date(rp.updatedAt).toLocaleDateString()}</span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>
            Continuar al Estudio
          </button>
        </div>
      </div>
    </div>
  );
};
