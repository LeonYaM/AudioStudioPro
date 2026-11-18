import React, { useRef, useState } from 'react';
import { Lock, Plus, Unlock } from 'lucide-react';
import { PcmAudioData } from '../../audio/dsp/pcmBuffer';
import {
  AudioClip,
  AutomationTarget,
  EditTool,
  MultitrackTrack,
  StudioProject,
} from '../../shared/types';

interface MultitrackEditorProps {
  project: StudioProject;
  assetMap: Map<string, PcmAudioData>;
  activeTool: EditTool;
  cursorSec: number;
  zoomLevel: number;
  selectedTrackId: string;
  selectedClipId: string | null;
  onSelectTrack: (trackId: string) => void;
  onSelectClip: (clipId: string | null) => void;
  onSeek: (sec: number) => void;
  onUpdateTrack: (trackId: string, patch: Partial<MultitrackTrack>) => void;
  onDropAssetOnTrack: (assetId: string, trackId: string, startSec: number) => void;
  onMoveClip: (trackId: string, clipId: string, newStartSec: number) => void;
  onResizeClip: (trackId: string, clipId: string, newDurationSec: number) => void;
  onSplitClipAt: (trackId: string, clipId: string, atSec: number) => void;
  onDuplicateClip: (trackId: string, clipId: string) => void;
  onDeleteClip: (trackId: string, clipId: string) => void;
  onCrossfadeNextClip: (trackId: string, clipId: string) => void;
  onAddAutomationPoint: (
    trackId: string,
    target: AutomationTarget,
    timeSec: number,
    value: number
  ) => void;
  onExpandTo64Tracks: () => void;
}

export const MultitrackEditor: React.FC<MultitrackEditorProps> = ({
  project,
  activeTool,
  cursorSec,
  zoomLevel,
  selectedTrackId,
  selectedClipId,
  onSelectTrack,
  onSelectClip,
  onSeek,
  onUpdateTrack,
  onDropAssetOnTrack,
  onMoveClip,
  onResizeClip,
  onSplitClipAt,
  onDuplicateClip,
  onDeleteClip,
  onCrossfadeNextClip,
  onAddAutomationPoint,
  onExpandTo64Tracks,
}) => {
  const pxPerSec = Math.max(24, zoomLevel * 65);
  const timelineSec = Math.max(
    60,
    ...project.tracks.flatMap((t) => t.clips.map((c) => c.startTimeSec + c.durationSec + 10))
  );
  const timelineWidth = timelineSec * pxPerSec;
  const beatSec = 60 / Math.max(30, project.bpm);

  const [dragging, setDragging] = useState<{
    mode: 'move' | 'resize';
    trackId: string;
    clipId: string;
    originX: number;
    origStart: number;
    origDur: number;
  } | null>(null);

  const lanesScrollRef = useRef<HTMLDivElement>(null);

  const snapTime = (t: number) => {
    if (!project.snapToGrid) return Math.max(0, t);
    const div =
      project.gridDivision === '1/1'
        ? beatSec * 4
        : project.gridDivision === '1/4'
        ? beatSec
        : project.gridDivision === '1/8'
        ? beatSec / 2
        : beatSec / 4;
    return Math.max(0, Math.round(t / div) * div);
  };

  const audioTrackCount = project.tracks.filter((t) => t.type === 'audio').length;
  const visibleTracks = project.tracks.filter((t) => t.type === 'audio' || t.type === 'submix');

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging) return;
    const dx = e.clientX - dragging.originX;
    const dt = dx / pxPerSec;
    if (dragging.mode === 'move') {
      onMoveClip(dragging.trackId, dragging.clipId, snapTime(dragging.origStart + dt));
    } else {
      onResizeClip(
        dragging.trackId,
        dragging.clipId,
        Math.max(0.05, dragging.origDur + dt)
      );
    }
  };

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}
      onMouseMove={handleMouseMove}
      onMouseUp={() => setDragging(null)}
    >
      {/* Multitrack Top Info Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '5px 10px',
          background: 'var(--bg-panel)',
          borderBottom: '1px solid var(--border-dark)',
          fontSize: 11,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontWeight: 700, color: 'var(--accent-electric)' }}>
            Multipista ({audioTrackCount} pistas de audio + Aux/Submix)
          </span>
          {audioTrackCount < 64 && (
            <button className="tool-btn" onClick={onExpandTo64Tracks}>
              <Plus size={12} /> Ampliar hasta 64 pistas
            </button>
          )}
          {selectedClipId && (
            <>
              <button
                className="tool-btn"
                onClick={() => onDuplicateClip(selectedTrackId, selectedClipId)}
              >
                Duplicar clip
              </button>
              <button
                className="tool-btn"
                onClick={() => onCrossfadeNextClip(selectedTrackId, selectedClipId)}
              >
                Fundido cruzado sig.
              </button>
              <button
                className="tool-btn"
                onClick={() => onDeleteClip(selectedTrackId, selectedClipId)}
              >
                Eliminar clip
              </button>
            </>
          )}
        </div>
        <span style={{ color: 'var(--text-muted)' }}>
          Arrastre archivos desde el Panel de Proyecto a cualquier pista · Herramienta Corte divide clips
        </span>
      </div>

      {/* Main Split: Track Headers + Timeline */}
      <div
        ref={lanesScrollRef}
        style={{ flex: 1, overflow: 'auto', display: 'flex', position: 'relative' }}
      >
        {/* Sticky Track Headers */}
        <div
          style={{
            width: 245,
            minWidth: 245,
            position: 'sticky',
            left: 0,
            zIndex: 20,
            background: 'var(--bg-panel)',
            borderRight: '1px solid var(--border-dark)',
          }}
        >
          {/* Ruler corner */}
          <div
            style={{
              height: 26,
              borderBottom: '1px solid var(--border-dark)',
              display: 'flex',
              alignItems: 'center',
              padding: '0 8px',
              fontSize: 10,
              fontWeight: 700,
              color: 'var(--text-muted)',
              background: 'var(--bg-panel)',
            }}
          >
            PISTAS ({visibleTracks.length})
          </div>

          {visibleTracks.map((track) => {
            const hasAutoVisible = track.automation.some((a) => a.visible);
            return (
              <div
                key={track.id}
                onClick={() => onSelectTrack(track.id)}
                style={{
                  height: hasAutoVisible ? 98 : 66,
                  borderBottom: '1px solid var(--border-dark)',
                  borderLeft: `4px solid ${track.color}`,
                  padding: '5px 7px',
                  background:
                    selectedTrackId === track.id ? 'var(--bg-elevated)' : 'var(--bg-panel)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                  <input
                    type="text"
                    value={track.name}
                    onChange={(e) => onUpdateTrack(track.id, { name: e.target.value })}
                    style={{
                      width: 112,
                      padding: '2px 4px',
                      fontSize: 11,
                      fontWeight: 700,
                      background: 'transparent',
                      borderColor: 'transparent',
                    }}
                  />
                  <div style={{ display: 'flex', gap: 2 }}>
                    <button
                      className={`mini-btn mute ${track.mute ? 'active' : ''}`}
                      style={{ width: 20 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onUpdateTrack(track.id, { mute: !track.mute });
                      }}
                    >
                      M
                    </button>
                    <button
                      className={`mini-btn solo ${track.solo ? 'active' : ''}`}
                      style={{ width: 20 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onUpdateTrack(track.id, { solo: !track.solo });
                      }}
                    >
                      S
                    </button>
                    <button
                      className={`mini-btn rec ${track.armed ? 'active' : ''}`}
                      style={{ width: 20 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onUpdateTrack(track.id, { armed: !track.armed });
                      }}
                    >
                      R
                    </button>
                    <button
                      className="mini-btn"
                      style={{ width: 20 }}
                      title="Bloquear pista"
                      onClick={(e) => {
                        e.stopPropagation();
                        onUpdateTrack(track.id, { locked: !track.locked });
                      }}
                    >
                      {track.locked ? <Lock size={10} /> : <Unlock size={10} />}
                    </button>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10 }}>
                  <span style={{ width: 38, fontFamily: 'var(--font-mono)' }}>
                    {track.volumeDb.toFixed(1)}dB
                  </span>
                  <input
                    type="range"
                    min={-48}
                    max={12}
                    step={0.5}
                    value={track.volumeDb}
                    onChange={(e) =>
                      onUpdateTrack(track.id, { volumeDb: Number(e.target.value) })
                    }
                    style={{ flex: 1 }}
                  />
                  <select
                    value={track.groupId ?? ''}
                    onChange={(e) =>
                      onUpdateTrack(track.id, { groupId: e.target.value || undefined })
                    }
                    title="Agrupar pista"
                    style={{ width: 56, padding: '1px 2px', fontSize: 9 }}
                  >
                    <option value="">Sin grp</option>
                    <option value="Grp A">Grp A</option>
                    <option value="Grp B">Grp B</option>
                    <option value="Voces">Voces</option>
                  </select>
                </div>

                {hasAutoVisible && (
                  <div style={{ fontSize: 9.5, color: 'var(--accent-electric)' }}>
                    Automatización activa (clic en carril para agregar puntos)
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Scrollable Timeline Canvas */}
        <div style={{ position: 'relative', width: timelineWidth, minWidth: '100%' }}>
          {/* Time Ruler */}
          <div
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              onSeek(snapTime((e.clientX - rect.left) / pxPerSec));
            }}
            style={{
              height: 26,
              position: 'sticky',
              top: 0,
              zIndex: 15,
              background: '#101216',
              borderBottom: '1px solid var(--border-dark)',
              cursor: 'pointer',
            }}
          >
            {Array.from({ length: Math.ceil(timelineSec) + 1 }, (_, sec) => (
              <div
                key={sec}
                style={{
                  position: 'absolute',
                  left: sec * pxPerSec,
                  top: 0,
                  bottom: 0,
                  borderLeft: sec % 5 === 0 ? '1px solid #4b5563' : '1px solid #262a33',
                  paddingLeft: 3,
                  fontSize: 9.5,
                  color: sec % 5 === 0 ? 'var(--text-secondary)' : 'var(--text-muted)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {sec}s
              </div>
            ))}

            {/* Loop brace */}
            {project.loopEnabled && project.loopEndSec > project.loopStartSec && (
              <div
                style={{
                  position: 'absolute',
                  left: project.loopStartSec * pxPerSec,
                  width: (project.loopEndSec - project.loopStartSec) * pxPerSec,
                  top: 0,
                  height: 6,
                  background: 'var(--accent-electric)',
                }}
              />
            )}

            {/* Punch In / Out brace */}
            {project.punchEnabled && (project.punchOutSec ?? 0) > (project.punchInSec ?? 0) && (
              <div
                style={{
                  position: 'absolute',
                  left: (project.punchInSec ?? 0) * pxPerSec,
                  width: ((project.punchOutSec ?? 0) - (project.punchInSec ?? 0)) * pxPerSec,
                  bottom: 0,
                  height: 5,
                  background: '#ef4444',
                }}
                title={`Punch In/Out: ${project.punchInSec}s – ${project.punchOutSec}s`}
              />
            )}

            {/* Markers */}
            {project.markers.map((m) => (
              <div
                key={m.id}
                style={{
                  position: 'absolute',
                  left: m.timeSec * pxPerSec,
                  top: 12,
                  background: m.color,
                  color: '#000',
                  fontSize: 9,
                  fontWeight: 700,
                  padding: '0 4px',
                  borderRadius: 2,
                }}
              >
                {m.name}
              </div>
            ))}
          </div>

          {/* Track Lanes */}
          {visibleTracks.map((track) => {
            const volAuto = track.automation.find((a) => a.target === 'volume');
            const panAuto = track.automation.find((a) => a.target === 'pan');
            const eqAuto = track.automation.find((a) => a.target === 'eq_gain');
            const revAuto = track.automation.find((a) => a.target === 'reverb_mix');
            const delAuto = track.automation.find((a) => a.target === 'delay_mix');
            const hasAutoVisible = track.automation.some((a) => a.visible);
            return (
              <div
                key={track.id}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (track.locked) return;
                  const assetId = e.dataTransfer.getData('application/x-asp-asset');
                  if (!assetId) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const startSec = snapTime((e.clientX - rect.left) / pxPerSec);
                  onDropAssetOnTrack(assetId, track.id, startSec);
                }}
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const clickSec = (e.clientX - rect.left) / pxPerSec;
                  if (activeTool === 'envelope' || hasAutoVisible) {
                    const yRatio = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
                    if (eqAuto?.visible) {
                      const eqDb = 12 - yRatio * 24;
                      onAddAutomationPoint(track.id, 'eq_gain', clickSec, Number(eqDb.toFixed(1)));
                    } else if (revAuto?.visible) {
                      onAddAutomationPoint(track.id, 'reverb_mix', clickSec, Number((1 - yRatio).toFixed(2)));
                    } else if (delAuto?.visible) {
                      onAddAutomationPoint(track.id, 'delay_mix', clickSec, Number((1 - yRatio).toFixed(2)));
                    } else if (panAuto?.visible && !volAuto?.visible) {
                      const panVal = 1 - yRatio * 2;
                      onAddAutomationPoint(track.id, 'pan', clickSec, Number(panVal.toFixed(2)));
                    } else {
                      const db = 12 - yRatio * 60;
                      onAddAutomationPoint(track.id, 'volume', clickSec, Number(db.toFixed(1)));
                    }
                  } else {
                    onSeek(snapTime(clickSec));
                  }
                }}
                style={{
                  height: hasAutoVisible ? 98 : 66,
                  position: 'relative',
                  borderBottom: '1px solid var(--border-dark)',
                  background:
                    selectedTrackId === track.id
                      ? 'rgba(0, 168, 232, 0.04)'
                      : 'rgba(15, 17, 22, 0.7)',
                }}
              >
                {track.clips.map((clip: AudioClip) => {
                  const left = clip.startTimeSec * pxPerSec;
                  const width = Math.max(12, clip.durationSec * pxPerSec);
                  const isSel = selectedClipId === clip.id;
                  return (
                    <div
                      key={clip.id}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        onSelectTrack(track.id);
                        onSelectClip(clip.id);
                        if (track.locked || clip.locked) return;
                        if (activeTool === 'razor') {
                          const rect = e.currentTarget.parentElement!.getBoundingClientRect();
                          const atSec = snapTime((e.clientX - rect.left) / pxPerSec);
                          onSplitClipAt(track.id, clip.id, atSec);
                          return;
                        }
                        setDragging({
                          mode: 'move',
                          trackId: track.id,
                          clipId: clip.id,
                          originX: e.clientX,
                          origStart: clip.startTimeSec,
                          origDur: clip.durationSec,
                        });
                      }}
                      style={{
                        position: 'absolute',
                        left,
                        top: 5,
                        width,
                        height: 54,
                        background: `${track.color}33`,
                        border: isSel ? '2px solid #facc15' : `1px solid ${track.color}`,
                        borderRadius: 4,
                        overflow: 'hidden',
                        cursor: activeTool === 'razor' ? 'crosshair' : 'grab',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div
                        style={{
                          background: track.color,
                          color: '#081018',
                          fontSize: 10,
                          fontWeight: 700,
                          padding: '1px 5px',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {clip.name}
                      </div>
                      <div
                        style={{
                          fontSize: 9.5,
                          padding: '0 5px 3px',
                          color: 'var(--text-secondary)',
                          fontFamily: 'var(--font-mono)',
                        }}
                      >
                        {clip.durationSec.toFixed(2)}s
                      </div>

                      {/* Right edge trim handle */}
                      <div
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          if (track.locked || clip.locked) return;
                          setDragging({
                            mode: 'resize',
                            trackId: track.id,
                            clipId: clip.id,
                            originX: e.clientX,
                            origStart: clip.startTimeSec,
                            origDur: clip.durationSec,
                          });
                        }}
                        style={{
                          position: 'absolute',
                          right: 0,
                          top: 0,
                          bottom: 0,
                          width: 6,
                          cursor: 'ew-resize',
                          background: 'rgba(255,255,255,0.18)',
                        }}
                        title="Ajustar duración"
                      />
                    </div>
                  );
                })}

                {/* Automation line preview (Volume, Pan, EQ, Reverb, Delay) */}
                {track.automation.some((a) => a.visible && a.points.length > 0) && (
                  <svg
                    style={{
                      position: 'absolute',
                      inset: 0,
                      width: '100%',
                      height: '100%',
                      pointerEvents: 'none',
                    }}
                  >
                    {track.automation
                      .filter((a) => a.visible && a.points.length > 0)
                      .map((lane) => {
                        const color =
                          lane.target === 'volume'
                            ? '#facc15'
                            : lane.target === 'pan'
                            ? '#38bdf8'
                            : lane.target === 'eq_gain'
                            ? '#4ade80'
                            : lane.target === 'reverb_mix'
                            ? '#c084fc'
                            : '#fb923c';
                        const valToY = (v: number) => {
                          if (lane.target === 'volume') return ((12 - v) / 60) * 90;
                          if (lane.target === 'pan') return ((1 - v) / 2) * 90;
                          if (lane.target === 'eq_gain') return ((12 - v) / 24) * 90;
                          return (1 - v) * 90;
                        };
                        const sorted = [...lane.points].sort((a, b) => a.timeSec - b.timeSec);
                        return (
                          <g key={lane.target}>
                            <polyline
                              fill="none"
                              stroke={color}
                              strokeWidth="1.5"
                              points={sorted
                                .map((p) => `${p.timeSec * pxPerSec},${Math.max(4, Math.min(92, valToY(p.value)))}`)
                                .join(' ')}
                            />
                            {sorted.map((p) => (
                              <circle
                                key={p.id}
                                cx={p.timeSec * pxPerSec}
                                cy={Math.max(4, Math.min(92, valToY(p.value)))}
                                r={3.5}
                                fill={color}
                              />
                            ))}
                          </g>
                        );
                      })}
                  </svg>
                )}
              </div>
            );
          })}

          {/* Playhead */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: cursorSec * pxPerSec,
              width: 2,
              background: '#facc15',
              pointerEvents: 'none',
              zIndex: 18,
            }}
          />
        </div>
      </div>
    </div>
  );
};
