import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  AudioWaveform,
  Brain,
  Disc3,
  Layers,
  Settings,
  Sliders,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { WorkspaceMode } from '../../shared/types';

export interface MenuActionCallbacks {
  onNewProject: () => void;
  onOpenProject: () => void;
  onSaveProject: () => void;
  onSaveProjectAs: () => void;
  onConsolidateAndSave: () => void;
  onImportAudio: () => void;
  onExportAudio: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onCut: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onDelete: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onToggleMixer: () => void;
  onToggleProjectPanel: () => void;
  onAddTracksTo64: () => void;
  onAddMarker: () => void;
  onSplitAtCursor: () => void;
  onNormalizeSelection: () => void;
  onOpenEffects: () => void;
  onOpenRestoration: () => void;
  onOpenVoice: () => void;
  onOpenMastering: () => void;
  onOpenAiAssistant: () => void;
  onToggleVolumeAuto: () => void;
  onTogglePanAuto: () => void;
  onToggleEqAuto: () => void;
  onToggleReverbAuto: () => void;
  onToggleDelayAuto: () => void;
  onOpenPreferences: () => void;
  onOpenWelcome: () => void;
  onCheckForUpdates: () => void;
}

interface TopMenuBarProps {
  projectName: string;
  workspace: WorkspaceMode;
  onChangeWorkspace: (mode: WorkspaceMode) => void;
  actions: MenuActionCallbacks;
}

interface MenuEntry {
  label: string;
  shortcut?: string;
  action?: () => void;
  separator?: boolean;
}

export const TopMenuBar: React.FC<TopMenuBarProps> = ({
  projectName,
  workspace,
  onChangeWorkspace,
  actions,
}) => {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    window.addEventListener('mousedown', onDocClick);
    return () => window.removeEventListener('mousedown', onDocClick);
  }, []);

  const menus: Record<string, MenuEntry[]> = {
    Archivo: [
      { label: 'Proyecto nuevo', shortcut: 'Ctrl+N', action: actions.onNewProject },
      { label: 'Abrir proyecto...', shortcut: 'Ctrl+O', action: actions.onOpenProject },
      { label: 'Guardar proyecto', shortcut: 'Ctrl+S', action: actions.onSaveProject },
      { label: 'Guardar como...', action: actions.onSaveProjectAs },
      { label: 'Recopilar medios y guardar sesión...', action: actions.onConsolidateAndSave },
      { separator: true, label: '' },
      { label: 'Importar audio...', action: actions.onImportAudio },
      { label: 'Exportar mezcla / audio...', action: actions.onExportAudio },
    ],
    Edición: [
      { label: 'Deshacer', shortcut: 'Ctrl+Z', action: actions.onUndo },
      { label: 'Rehacer', shortcut: 'Ctrl+Y', action: actions.onRedo },
      { separator: true, label: '' },
      { label: 'Cortar', shortcut: 'Ctrl+X', action: actions.onCut },
      { label: 'Copiar', shortcut: 'Ctrl+C', action: actions.onCopy },
      { label: 'Pegar', shortcut: 'Ctrl+V', action: actions.onPaste },
      { label: 'Eliminar selección', shortcut: 'Supr', action: actions.onDelete },
    ],
    Vista: [
      { label: 'Modo Forma de Onda', action: () => onChangeWorkspace('waveform') },
      { label: 'Modo Multipista', action: () => onChangeWorkspace('multitrack') },
      { label: 'Modo Espectral', action: () => onChangeWorkspace('spectral') },
      { separator: true, label: '' },
      { label: 'Acercar zoom', shortcut: '+', action: actions.onZoomIn },
      { label: 'Alejar zoom', shortcut: '-', action: actions.onZoomOut },
      { label: 'Mostrar/Ocultar Mezclador', action: actions.onToggleMixer },
      { label: 'Mostrar/Ocultar Panel de Proyecto', action: actions.onToggleProjectPanel },
    ],
    Pista: [
      { label: 'Ampliar pistas hasta 64', action: actions.onAddTracksTo64 },
      { label: 'Insertar marcador en cursor', shortcut: 'M', action: actions.onAddMarker },
    ],
    Clip: [
      { label: 'Dividir en cursor', action: actions.onSplitAtCursor },
      { label: 'Normalizar (-0.5 dB)', action: actions.onNormalizeSelection },
    ],
    Efectos: [
      { label: 'Rack de Efectos y EQ...', action: actions.onOpenEffects },
      { label: 'Restauración de Audio...', action: actions.onOpenRestoration },
      { label: 'Módulo de Voz Profesional...', action: actions.onOpenVoice },
      { label: 'Cadena de Masterización...', action: actions.onOpenMastering },
      { separator: true, label: '' },
      { label: 'AI Audio Assistant...', action: actions.onOpenAiAssistant },
    ],
    Automatización: [
      { label: 'Mostrar carril de Volumen', action: actions.onToggleVolumeAuto },
      { label: 'Mostrar carril de Panorámica', action: actions.onTogglePanAuto },
      { separator: true, label: '' },
      { label: 'Mostrar carril de EQ Gain (1 kHz)', action: actions.onToggleEqAuto },
      { label: 'Mostrar carril de Reverb Mix', action: actions.onToggleReverbAuto },
      { label: 'Mostrar carril de Delay Mix', action: actions.onToggleDelayAuto },
    ],
    Ventana: [
      { label: 'Preferencias, Dispositivos y Atajos...', action: actions.onOpenPreferences },
      { label: 'Pantalla de Bienvenida...', action: actions.onOpenWelcome },
    ],
    Ayuda: [
      { label: 'Tutorial inicial y guía rápida', action: actions.onOpenWelcome },
      { label: 'Buscar actualizaciones...', action: actions.onCheckForUpdates },
    ],
  };

  return (
    <header className="menu-bar" ref={barRef}>
      <div className="menu-left">
        <div className="app-brand" title={projectName}>
          <Disc3 size={15} />
          <span>AUDIO STUDIO PRO</span>
        </div>
        {Object.keys(menus).map((menuName) => (
          <div className="menu-trigger-wrap" key={menuName}>
            <button
              className={`menu-trigger ${openMenu === menuName ? 'open' : ''}`}
              onClick={() => setOpenMenu(openMenu === menuName ? null : menuName)}
            >
              {menuName}
            </button>
            {openMenu === menuName && (
              <div className="menu-dropdown">
                {menus[menuName].map((entry, idx) =>
                  entry.separator ? (
                    <div className="menu-sep" key={`sep-${idx}`} />
                  ) : (
                    <button
                      className="menu-item"
                      key={entry.label}
                      onClick={() => {
                        setOpenMenu(null);
                        entry.action?.();
                      }}
                    >
                      <span>{entry.label}</span>
                      {entry.shortcut && (
                        <span className="shortcut-hint">{entry.shortcut}</span>
                      )}
                    </button>
                  )
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="workspace-tabs">
        <button
          className={`ws-tab ${workspace === 'waveform' ? 'active' : ''}`}
          onClick={() => onChangeWorkspace('waveform')}
        >
          <AudioWaveform size={13} />
          Forma de Onda
        </button>
        <button
          className={`ws-tab ${workspace === 'multitrack' ? 'active' : ''}`}
          onClick={() => onChangeWorkspace('multitrack')}
        >
          <Layers size={13} />
          Multipista
        </button>
        <button
          className={`ws-tab ${workspace === 'spectral' ? 'active' : ''}`}
          onClick={() => onChangeWorkspace('spectral')}
        >
          <Activity size={13} />
          Espectral
        </button>
      </div>

      <div className="module-pills">
        <button className="pill-btn" onClick={actions.onOpenEffects} title="Efectos y EQ">
          <Sliders size={12} /> Efectos
        </button>
        <button className="pill-btn" onClick={actions.onOpenRestoration} title="Restauración">
          <Wand2 size={12} /> Restaurar
        </button>
        <button className="pill-btn" onClick={actions.onOpenVoice} title="Voz">
          <Sparkles size={12} /> Voz
        </button>
        <button className="pill-btn" onClick={actions.onOpenMastering} title="Masterización">
          <Disc3 size={12} /> Master
        </button>
        <button
          className="pill-btn highlight"
          onClick={actions.onOpenAiAssistant}
          title="AI Audio Assistant"
        >
          <Brain size={12} /> AI
        </button>
        <button className="pill-btn" onClick={actions.onOpenPreferences} title="Preferencias">
          <Settings size={12} />
        </button>
      </div>
    </header>
  );
};
