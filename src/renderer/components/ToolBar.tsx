import React from 'react';
import {
  Activity,
  BookmarkPlus,
  Clipboard,
  Copy,
  Magnet,
  MousePointer,
  Move,
  Redo2,
  Scissors,
  SlidersHorizontal,
  SquareDashedMousePointer,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { EditTool } from '../../shared/types';

interface ToolBarProps {
  activeTool: EditTool;
  onSelectTool: (tool: EditTool) => void;
  canUndo: boolean;
  canRedo: boolean;
  hasClipboard: boolean;
  snapToGrid: boolean;
  bpm: number;
  onUndo: () => void;
  onRedo: () => void;
  onCut: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onDelete: () => void;
  onSplit: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onToggleSnap: () => void;
  onAddMarker: () => void;
}

export const ToolBar: React.FC<ToolBarProps> = ({
  activeTool,
  onSelectTool,
  canUndo,
  canRedo,
  hasClipboard,
  snapToGrid,
  bpm,
  onUndo,
  onRedo,
  onCut,
  onCopy,
  onPaste,
  onDelete,
  onSplit,
  onZoomIn,
  onZoomOut,
  onToggleSnap,
  onAddMarker,
}) => {
  const tools: Array<{ id: EditTool; label: string; icon: React.ReactNode }> = [
    { id: 'select', label: 'Selección', icon: <MousePointer size={13} /> },
    { id: 'time-select', label: 'Selección de tiempo', icon: <SquareDashedMousePointer size={13} /> },
    { id: 'razor', label: 'Corte', icon: <Scissors size={13} /> },
    { id: 'move', label: 'Desplazamiento', icon: <Move size={13} /> },
    { id: 'zoom', label: 'Zoom', icon: <ZoomIn size={13} /> },
    { id: 'envelope', label: 'Envolvente', icon: <SlidersHorizontal size={13} /> },
    { id: 'spectral-select', label: 'Selección espectral', icon: <Activity size={13} /> },
  ];

  return (
    <div className="toolbar">
      <div className="toolbar-group">
        {tools.map((t) => (
          <button
            key={t.id}
            className={`tool-btn ${activeTool === t.id ? 'active' : ''}`}
            onClick={() => onSelectTool(t.id)}
            title={t.label}
          >
            {t.icon}
            <span style={{ fontSize: 10 }}>{t.label}</span>
          </button>
        ))}
      </div>

      <div className="toolbar-group">
        <button className="tool-btn" onClick={onUndo} disabled={!canUndo} title="Deshacer (Ctrl+Z)">
          <Undo2 size={13} />
        </button>
        <button className="tool-btn" onClick={onRedo} disabled={!canRedo} title="Rehacer (Ctrl+Y)">
          <Redo2 size={13} />
        </button>
        <button className="tool-btn" onClick={onCut} title="Cortar (Ctrl+X)">
          <Scissors size={13} />
        </button>
        <button className="tool-btn" onClick={onCopy} title="Copiar (Ctrl+C)">
          <Copy size={13} />
        </button>
        <button className="tool-btn" onClick={onPaste} disabled={!hasClipboard} title="Pegar (Ctrl+V)">
          <Clipboard size={13} />
        </button>
        <button className="tool-btn" onClick={onDelete} title="Eliminar (Supr)">
          <Trash2 size={13} />
        </button>
        <button className="tool-btn" onClick={onSplit} title="Dividir en cursor">
          Dividir
        </button>
      </div>

      <div className="toolbar-group">
        <button className="tool-btn" onClick={onZoomOut} title="Alejar (-)">
          <ZoomOut size={13} />
        </button>
        <button className="tool-btn" onClick={onZoomIn} title="Acercar (+)">
          <ZoomIn size={13} />
        </button>
        <button
          className={`tool-btn ${snapToGrid ? 'active' : ''}`}
          onClick={onToggleSnap}
          title={`Ajuste a rejilla (${bpm} BPM)`}
        >
          <Magnet size={13} /> Rejilla
        </button>
        <button className="tool-btn" onClick={onAddMarker} title="Insertar marcador (M)">
          <BookmarkPlus size={13} /> Marcador
        </button>
      </div>
    </div>
  );
};
