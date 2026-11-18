import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { TrackMeterLevel } from '../../audio/engine/AudioEngine';
import { MeteringSnapshot, MultitrackTrack, StudioProject, TrackEffectRack } from '../../shared/types';

interface MixerPanelProps {
  project: StudioProject;
  meter: MeteringSnapshot;
  trackMeters: Record<string, TrackMeterLevel>;
  softClipEnabled: boolean;
  onToggleSoftClip: () => void;
  onUpdateTrack: (trackId: string, patch: Partial<MultitrackTrack>) => void;
  onUpdateMasterVolume: (db: number) => void;
  onUpdateMasterPan: (pan: number) => void;
  onOpenTrackEffects: (trackId: string) => void;
}

function dbToPercent(db: number): number {
  return Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
}

function hasAnyEffectEnabled(rack: TrackEffectRack): boolean {
  return (
    rack.parametricEq.enabled ||
    rack.graphicEq.enabled ||
    rack.compressor.enabled ||
    rack.limiter.enabled ||
    rack.gate.enabled ||
    rack.multiband.enabled ||
    rack.deEsser.enabled ||
    rack.reverb.enabled ||
    rack.delay.enabled ||
    rack.modulation.enabled ||
    rack.saturation.enabled ||
    rack.widener.enabled ||
    rack.pitchTempo.enabled
  );
}

export const MixerPanel: React.FC<MixerPanelProps> = ({
  project,
  meter,
  trackMeters,
  softClipEnabled,
  onToggleSoftClip,
  onUpdateTrack,
  onUpdateMasterVolume,
  onUpdateMasterPan,
  onOpenTrackEffects,
}) => {
  const audioTracks = project.tracks.filter(
    (t) => t.type === 'audio' && (t.index <= 8 || t.clips.length > 0 || t.armed || t.solo)
  );
  const submixes = project.tracks.filter((t) => t.type === 'submix');
  const auxBuses = project.tracks.filter((t) => t.type === 'aux');
  const channels = [...audioTracks, ...submixes, ...auxBuses];

  const meterLeftPct = dbToPercent(meter.peakLeftDb);
  const meterRightPct = dbToPercent(meter.peakRightDb);

  return (
    <section className="mixer-dock">
      <div className="panel-header">
        <span>Mezclador Consola Digital ({channels.length} canales activos + Master)</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5 }}>
            LUFS: {meter.integratedLufs > -100 ? meter.integratedLufs.toFixed(1) : '-∞'} | RMS:{' '}
            {Math.max(meter.rmsLeftDb, meter.rmsRightDb).toFixed(1)} dB | Corr:{' '}
            {meter.phaseCorrelation.toFixed(2)}
          </span>
          {meter.clipping && <span className="badge badge-crit">CLIPPING!</span>}
          <button
            className={`tool-btn ${softClipEnabled ? 'active' : ''}`}
            style={{ height: 21, fontSize: 10 }}
            onClick={onToggleSoftClip}
            title="Protección digital contra saturación (Soft-Clip Limiter)"
          >
            <ShieldCheck size={12} /> Anti-Clip
          </button>
        </div>
      </div>

      <div className="mixer-strips">
        {channels.map((track) => {
          const trackLevel = trackMeters[track.id];
          const trackPct = track.mute || !trackLevel ? 0 : dbToPercent(trackLevel.peakDb);
          const fxActive = hasAnyEffectEnabled(track.effects);

          return (
            <div className="channel-strip" key={track.id}>
              <div className="strip-title" style={{ borderLeftColor: track.color }} title={track.name}>
                {track.name}
              </div>

              <div className="strip-buttons">
                <button
                  className={`mini-btn mute ${track.mute ? 'active' : ''}`}
                  onClick={() => onUpdateTrack(track.id, { mute: !track.mute })}
                  title="Silenciar"
                >
                  M
                </button>
                <button
                  className={`mini-btn solo ${track.solo ? 'active' : ''}`}
                  onClick={() => onUpdateTrack(track.id, { solo: !track.solo })}
                  title="Solo"
                >
                  S
                </button>
                <button
                  className={`mini-btn rec ${track.armed ? 'active' : ''}`}
                  onClick={() => onUpdateTrack(track.id, { armed: !track.armed })}
                  title="Armar grabación"
                >
                  R
                </button>
                <button
                  className={`mini-btn phase ${track.phaseInvert ? 'active' : ''}`}
                  onClick={() => onUpdateTrack(track.id, { phaseInvert: !track.phaseInvert })}
                  title="Invertir fase"
                >
                  Ø
                </button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 9 }}>
                <span>Pan</span>
                <input
                  type="range"
                  min={-1}
                  max={1}
                  step={0.05}
                  value={track.pan}
                  onChange={(e) => onUpdateTrack(track.id, { pan: Number(e.target.value) })}
                  style={{ width: 58 }}
                />
              </div>

              <div className="fader-row">
                <input
                  type="range"
                  className="fader-vertical"
                  min={-48}
                  max={12}
                  step={0.5}
                  value={track.volumeDb}
                  onChange={(e) => onUpdateTrack(track.id, { volumeDb: Number(e.target.value) })}
                />
                <div
                  className="meter-bar-bg"
                  title={
                    trackLevel
                      ? `Peak: ${trackLevel.peakDb.toFixed(1)} dB | RMS: ${trackLevel.rmsDb.toFixed(1)} dB`
                      : 'Sin señal'
                  }
                >
                  <div className="meter-bar-fill" style={{ height: `${trackPct}%` }} />
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: 9.5,
                  fontFamily: 'var(--font-mono)',
                }}
              >
                <span>{track.volumeDb.toFixed(1)} dB</span>
                <button
                  className={`mini-btn ${fxActive ? 'solo active' : ''}`}
                  style={{ padding: '1px 5px' }}
                  onClick={() => onOpenTrackEffects(track.id)}
                  title="Abrir EQ, Compresor y Efectos de esta pista"
                >
                  FX
                </button>
              </div>

              {track.type === 'audio' && (
                <>
                  <div style={{ display: 'flex', gap: 2, fontSize: 9, alignItems: 'center' }}>
                    <span title="Envío Aux 1 (Reverb)">A1</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={track.auxSends['aux-1'] ?? 0}
                      onChange={(e) =>
                        onUpdateTrack(track.id, {
                          auxSends: { ...track.auxSends, 'aux-1': Number(e.target.value) },
                        })
                      }
                      style={{ width: 28 }}
                    />
                    <span title="Envío Aux 2 (Delay)">A2</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={track.auxSends['aux-2'] ?? 0}
                      onChange={(e) =>
                        onUpdateTrack(track.id, {
                          auxSends: { ...track.auxSends, 'aux-2': Number(e.target.value) },
                        })
                      }
                      style={{ width: 28 }}
                    />
                  </div>
                  <select
                    value={track.outputBusId || 'master'}
                    onChange={(e) => onUpdateTrack(track.id, { outputBusId: e.target.value })}
                    title="Bus de salida"
                    style={{ width: '100%', padding: '1px 3px', fontSize: 9 }}
                  >
                    <option value="master">Out: Master</option>
                    {submixes.map((s) => (
                      <option key={s.id} value={s.id}>
                        Out: {s.name}
                      </option>
                    ))}
                  </select>
                </>
              )}
            </div>
          );
        })}

        {/* Master Stereo Strip */}
        <div className="channel-strip master-strip">
          <div className="strip-title" style={{ borderLeftColor: '#00a8e8' }}>
            MASTER ESTÉREO
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9.5 }}>
            <span>Pan</span>
            <input
              type="range"
              min={-1}
              max={1}
              step={0.05}
              value={project.masterPan}
              onChange={(e) => onUpdateMasterPan(Number(e.target.value))}
              style={{ flex: 1 }}
            />
          </div>

          <div className="fader-row">
            <input
              type="range"
              className="fader-vertical"
              min={-48}
              max={6}
              step={0.5}
              value={project.masterVolumeDb}
              onChange={(e) => onUpdateMasterVolume(Number(e.target.value))}
            />
            <div className="meter-bar-bg">
              <div className="meter-bar-fill" style={{ height: `${meterLeftPct}%` }} />
            </div>
            <div className="meter-bar-bg">
              <div className="meter-bar-fill" style={{ height: `${meterRightPct}%` }} />
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 10,
              fontFamily: 'var(--font-mono)',
            }}
          >
            <span>{project.masterVolumeDb.toFixed(1)} dB</span>
            <span style={{ color: meter.clipping ? '#ef4444' : '#4ade80' }}>
              {Math.max(meter.peakLeftDb, meter.peakRightDb).toFixed(1)}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
};
