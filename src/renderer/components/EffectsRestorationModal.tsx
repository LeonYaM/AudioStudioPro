import React, { useMemo, useState } from 'react';
import { Play, Square, X } from 'lucide-react';
import { evaluateEqResponseCurve } from '../../audio/dsp/biquad';
import { PcmAudioData } from '../../audio/dsp/pcmBuffer';
import { dspWorker } from '../../audio/workers/DspWorkerClient';
import {
  GRAPHIC_EQ_FREQS,
  RESTORATION_PROFILES,
  VOICE_PRESETS,
  createDefaultEqBands,
} from '../../shared/presets';
import { RestorationOptions, TrackEffectRack } from '../../shared/types';

interface EffectsRestorationModalProps {
  initialTab: 'eq' | 'dynamics' | 'creative' | 'restoration' | 'voice';
  rack: TrackEffectRack;
  sampleRate: number;
  activePcm?: PcmAudioData;
  trackLabel: string;
  onUpdateRack: (rack: TrackEffectRack) => void;
  onApplyProcessedPcm: (pcm: PcmAudioData, description: string) => void;
  onPreviewPcm: (pcm: PcmAudioData, rack?: TrackEffectRack) => void;
  onStopPreview: () => void;
  onClose: () => void;
}

const CURVE_FREQS = [
  20, 30, 50, 80, 125, 200, 320, 500, 800, 1250, 2000, 3200, 5000, 8000, 12500, 20000,
];

export const EffectsRestorationModal: React.FC<EffectsRestorationModalProps> = ({
  initialTab,
  rack,
  sampleRate,
  activePcm,
  trackLabel,
  onUpdateRack,
  onApplyProcessedPcm,
  onPreviewPcm,
  onStopPreview,
  onClose,
}) => {
  const [tab, setTab] = useState(initialTab);
  const [restoration, setRestoration] = useState<RestorationOptions>(
    RESTORATION_PROFILES['pro-voice']
  );
  const [abMode, setAbMode] = useState<'A' | 'B'>('B');
  const [busy, setBusy] = useState(false);

  const curveDb = useMemo(
    () =>
      evaluateEqResponseCurve(
        rack.parametricEq,
        rack.graphicEq,
        sampleRate,
        CURVE_FREQS
      ),
    [rack.parametricEq, rack.graphicEq, sampleRate]
  );

  const svgPoints = curveDb
    .map((db, idx) => {
      const x = (idx / (CURVE_FREQS.length - 1)) * 520;
      const y = 75 - Math.max(-18, Math.min(18, db)) * 3.5;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const handlePreview = async (mode: 'A' | 'B') => {
    setAbMode(mode);
    if (!activePcm) return;
    if (mode === 'A') {
      onPreviewPcm(activePcm);
      return;
    }
    if (tab === 'eq' || tab === 'dynamics' || tab === 'creative') {
      // Real-time AudioWorklet + Web Audio preview
      onPreviewPcm(activePcm, rack);
      return;
    }
    setBusy(true);
    try {
      let out = await dspWorker.processEffectRack(activePcm, rack);
      out = await dspWorker.applyRestoration(out, restoration);
      onPreviewPcm(out);
    } finally {
      setBusy(false);
    }
  };

  const handleApplyToAudio = async () => {
    if (!activePcm) return;
    setBusy(true);
    try {
      let out = await dspWorker.processEffectRack(activePcm, rack);
      if (tab === 'restoration' || tab === 'voice') {
        out = await dspWorker.applyRestoration(out, restoration);
      }
      onApplyProcessedPcm(
        out,
        tab === 'restoration'
          ? `Restauración (${restoration.profile})`
          : tab === 'voice'
          ? 'Cadena Vocal'
          : 'Rack de Efectos'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-card" style={{ width: 880, height: 640 }}>
        <div className="modal-header">
          <span>Procesadores, Efectos, Restauración y Voz — {trackLabel}</span>
          <button className="mini-btn" style={{ width: 26, height: 24 }} onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div
          style={{
            display: 'flex',
            gap: 4,
            padding: '8px 14px',
            borderBottom: '1px solid var(--border-dark)',
            background: 'var(--bg-main)',
          }}
        >
          {(
            [
              ['eq', 'Ecualización (Gráfico + Paramétrico)'],
              ['dynamics', 'Dinámica'],
              ['creative', 'Efectos Creativos'],
              ['restoration', 'Restauración de Audio'],
              ['voice', 'Módulo de Voz'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              className={`ws-tab ${tab === id ? 'active' : ''}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {tab === 'eq' && (
            <>
              <div
                style={{
                  background: '#090b0f',
                  border: '1px solid var(--border-dark)',
                  borderRadius: 6,
                  padding: 8,
                }}
              >
                <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginBottom: 4 }}>
                  Curva de Respuesta de Frecuencia (20 Hz – 20 kHz, ±18 dB)
                </div>
                <svg width="100%" height="150" viewBox="0 0 520 150">
                  <line x1="0" y1="75" x2="520" y2="75" stroke="#2c313c" strokeDasharray="4 4" />
                  <polyline fill="none" stroke="#00a8e8" strokeWidth="2.5" points={svgPoints} />
                </svg>
              </div>

              {/* Parametric EQ */}
              <div style={{ background: 'var(--bg-elevated)', padding: 10, borderRadius: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
                    <input
                      type="checkbox"
                      checked={rack.parametricEq.enabled}
                      onChange={(e) =>
                        onUpdateRack({
                          ...rack,
                          parametricEq: { ...rack.parametricEq, enabled: e.target.checked },
                        })
                      }
                    />
                    Ecualizador Paramétrico
                  </label>
                  <select
                    value={rack.parametricEq.bandCount}
                    onChange={(e) => {
                      const count = Number(e.target.value) as 4 | 6 | 8;
                      onUpdateRack({
                        ...rack,
                        parametricEq: {
                          ...rack.parametricEq,
                          bandCount: count,
                          bands: createDefaultEqBands(count),
                        },
                      });
                    }}
                  >
                    <option value={4}>4 bandas</option>
                    <option value={6}>6 bandas</option>
                    <option value={8}>8 bandas</option>
                  </select>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                  {rack.parametricEq.bands
                    .slice(0, rack.parametricEq.bandCount)
                    .map((b, idx) => (
                      <div
                        key={b.id}
                        style={{
                          background: 'var(--bg-panel)',
                          padding: 7,
                          borderRadius: 4,
                          border: '1px solid var(--border-dark)',
                          display: 'grid',
                          gridTemplateColumns: '78px 66px 64px 54px',
                          gap: 5,
                          alignItems: 'center',
                        }}
                      >
                        <select
                          value={b.type}
                          onChange={(e) => {
                            const bands = [...rack.parametricEq.bands];
                            bands[idx] = { ...b, type: e.target.value as typeof b.type };
                            onUpdateRack({
                              ...rack,
                              parametricEq: { ...rack.parametricEq, bands },
                            });
                          }}
                        >
                          <option value="peaking">Bell</option>
                          <option value="highpass">HighPass</option>
                          <option value="lowpass">LowPass</option>
                          <option value="lowshelf">LowShelf</option>
                          <option value="highshelf">HighShelf</option>
                          <option value="notch">Notch</option>
                        </select>
                        <input
                          type="number"
                          min={20}
                          max={20000}
                          value={b.frequency}
                          title="Frecuencia (Hz)"
                          onChange={(e) => {
                            const bands = [...rack.parametricEq.bands];
                            bands[idx] = { ...b, frequency: Number(e.target.value) || 100 };
                            onUpdateRack({
                              ...rack,
                              parametricEq: { ...rack.parametricEq, bands },
                            });
                          }}
                        />
                        <input
                          type="number"
                          step={0.5}
                          min={-18}
                          max={18}
                          value={b.gainDb}
                          title="Ganancia (dB)"
                          onChange={(e) => {
                            const bands = [...rack.parametricEq.bands];
                            bands[idx] = { ...b, gainDb: Number(e.target.value) };
                            onUpdateRack({
                              ...rack,
                              parametricEq: { ...rack.parametricEq, bands },
                            });
                          }}
                        />
                        <input
                          type="number"
                          step={0.1}
                          min={0.2}
                          max={12}
                          value={b.q}
                          title="Factor Q"
                          onChange={(e) => {
                            const bands = [...rack.parametricEq.bands];
                            bands[idx] = { ...b, q: Number(e.target.value) || 1 };
                            onUpdateRack({
                              ...rack,
                              parametricEq: { ...rack.parametricEq, bands },
                            });
                          }}
                        />
                      </div>
                    ))}
                </div>
              </div>

              {/* 10-band Graphic EQ */}
              <div style={{ background: 'var(--bg-elevated)', padding: 10, borderRadius: 6 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, marginBottom: 8 }}>
                  <input
                    type="checkbox"
                    checked={rack.graphicEq.enabled}
                    onChange={(e) =>
                      onUpdateRack({
                        ...rack,
                        graphicEq: { ...rack.graphicEq, enabled: e.target.checked },
                      })
                    }
                  />
                  Ecualizador Gráfico 10 Bandas
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: 6 }}>
                  {GRAPHIC_EQ_FREQS.map((freq, idx) => (
                    <div
                      key={freq}
                      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}
                    >
                      <input
                        type="range"
                        className="fader-vertical"
                        min={-12}
                        max={12}
                        step={0.5}
                        value={rack.graphicEq.bandsDb[idx] ?? 0}
                        onChange={(e) => {
                          const bandsDb = [...rack.graphicEq.bandsDb];
                          bandsDb[idx] = Number(e.target.value);
                          onUpdateRack({
                            ...rack,
                            graphicEq: { ...rack.graphicEq, bandsDb },
                          });
                        }}
                      />
                      <span style={{ fontSize: 10 }}>{freq >= 1000 ? `${freq / 1000}k` : freq}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {tab === 'dynamics' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
              {/* Compressor */}
              <div style={{ background: 'var(--bg-elevated)', padding: 10, borderRadius: 6 }}>
                <label style={{ fontWeight: 700, display: 'flex', gap: 6, marginBottom: 8 }}>
                  <input
                    type="checkbox"
                    checked={rack.compressor.enabled}
                    onChange={(e) =>
                      onUpdateRack({
                        ...rack,
                        compressor: { ...rack.compressor, enabled: e.target.checked },
                      })
                    }
                  />
                  Compresor
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <label>
                    Threshold (dB)
                    <input
                      type="number"
                      value={rack.compressor.thresholdDb}
                      onChange={(e) =>
                        onUpdateRack({
                          ...rack,
                          compressor: { ...rack.compressor, thresholdDb: Number(e.target.value) },
                        })
                      }
                    />
                  </label>
                  <label>
                    Ratio
                    <input
                      type="number"
                      step={0.5}
                      value={rack.compressor.ratio}
                      onChange={(e) =>
                        onUpdateRack({
                          ...rack,
                          compressor: { ...rack.compressor, ratio: Number(e.target.value) },
                        })
                      }
                    />
                  </label>
                  <label>
                    Attack (ms)
                    <input
                      type="number"
                      value={rack.compressor.attackMs}
                      onChange={(e) =>
                        onUpdateRack({
                          ...rack,
                          compressor: { ...rack.compressor, attackMs: Number(e.target.value) },
                        })
                      }
                    />
                  </label>
                  <label>
                    Release (ms)
                    <input
                      type="number"
                      value={rack.compressor.releaseMs}
                      onChange={(e) =>
                        onUpdateRack({
                          ...rack,
                          compressor: { ...rack.compressor, releaseMs: Number(e.target.value) },
                        })
                      }
                    />
                  </label>
                  <label>
                    Knee (dB)
                    <input
                      type="number"
                      value={rack.compressor.kneeDb}
                      onChange={(e) =>
                        onUpdateRack({
                          ...rack,
                          compressor: { ...rack.compressor, kneeDb: Number(e.target.value) },
                        })
                      }
                    />
                  </label>
                  <label>
                    Makeup Gain (dB)
                    <input
                      type="number"
                      step={0.5}
                      value={rack.compressor.makeupGainDb}
                      onChange={(e) =>
                        onUpdateRack({
                          ...rack,
                          compressor: { ...rack.compressor, makeupGainDb: Number(e.target.value) },
                        })
                      }
                    />
                  </label>
                </div>
              </div>

              {/* Limiter */}
              <div style={{ background: 'var(--bg-elevated)', padding: 10, borderRadius: 6 }}>
                <label style={{ fontWeight: 700, display: 'flex', gap: 6, marginBottom: 8 }}>
                  <input
                    type="checkbox"
                    checked={rack.limiter.enabled}
                    onChange={(e) =>
                      onUpdateRack({
                        ...rack,
                        limiter: { ...rack.limiter, enabled: e.target.checked },
                      })
                    }
                  />
                  Limitador True Peak
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <label>
                    Techo (dBTP)
                    <input
                      type="number"
                      step={0.1}
                      value={rack.limiter.ceilingDb}
                      onChange={(e) =>
                        onUpdateRack({
                          ...rack,
                          limiter: { ...rack.limiter, ceilingDb: Number(e.target.value) },
                        })
                      }
                    />
                  </label>
                  <label>
                    Release (ms)
                    <input
                      type="number"
                      value={rack.limiter.releaseMs}
                      onChange={(e) =>
                        onUpdateRack({
                          ...rack,
                          limiter: { ...rack.limiter, releaseMs: Number(e.target.value) },
                        })
                      }
                    />
                  </label>
                </div>
              </div>

              {/* Gate / Expander */}
              <div style={{ background: 'var(--bg-elevated)', padding: 10, borderRadius: 6 }}>
                <label style={{ fontWeight: 700, display: 'flex', gap: 6, marginBottom: 8 }}>
                  <input
                    type="checkbox"
                    checked={rack.gate.enabled}
                    onChange={(e) =>
                      onUpdateRack({ ...rack, gate: { ...rack.gate, enabled: e.target.checked } })
                    }
                  />
                  Gate / Expansor
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <label>
                    Modo
                    <select
                      value={rack.gate.mode}
                      onChange={(e) =>
                        onUpdateRack({
                          ...rack,
                          gate: { ...rack.gate, mode: e.target.value as 'gate' | 'expander' },
                        })
                      }
                      style={{ width: '100%' }}
                    >
                      <option value="gate">Noise Gate</option>
                      <option value="expander">Expansor</option>
                    </select>
                  </label>
                  <label>
                    Threshold (dB)
                    <input
                      type="number"
                      value={rack.gate.thresholdDb}
                      onChange={(e) =>
                        onUpdateRack({
                          ...rack,
                          gate: { ...rack.gate, thresholdDb: Number(e.target.value) },
                        })
                      }
                      style={{ width: '100%' }}
                    />
                  </label>
                  <label>
                    Attack / Release (ms)
                    <div style={{ display: 'flex', gap: 4 }}>
                      <input
                        type="number"
                        value={rack.gate.attackMs}
                        onChange={(e) =>
                          onUpdateRack({
                            ...rack,
                            gate: { ...rack.gate, attackMs: Number(e.target.value) },
                          })
                        }
                        style={{ width: '50%' }}
                      />
                      <input
                        type="number"
                        value={rack.gate.releaseMs}
                        onChange={(e) =>
                          onUpdateRack({
                            ...rack,
                            gate: { ...rack.gate, releaseMs: Number(e.target.value) },
                          })
                        }
                        style={{ width: '50%' }}
                      />
                    </div>
                  </label>
                  <label>
                    Rango (dB)
                    <input
                      type="number"
                      max={0}
                      min={-80}
                      value={rack.gate.rangeDb}
                      onChange={(e) =>
                        onUpdateRack({
                          ...rack,
                          gate: { ...rack.gate, rangeDb: Number(e.target.value) },
                        })
                      }
                      style={{ width: '100%' }}
                    />
                  </label>
                </div>
              </div>

              {/* De-Esser & Multiband */}
              <div style={{ background: 'var(--bg-elevated)', padding: 10, borderRadius: 6 }}>
                <label style={{ fontWeight: 700, display: 'flex', gap: 6, marginBottom: 6 }}>
                  <input
                    type="checkbox"
                    checked={rack.deEsser.enabled}
                    onChange={(e) =>
                      onUpdateRack({
                        ...rack,
                        deEsser: { ...rack.deEsser, enabled: e.target.checked },
                      })
                    }
                  />
                  De-Esser (Control de sibilancia)
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginBottom: 8 }}>
                  <label>
                    Freq (Hz)
                    <input
                      type="number"
                      value={rack.deEsser.frequencyHz}
                      onChange={(e) =>
                        onUpdateRack({
                          ...rack,
                          deEsser: { ...rack.deEsser, frequencyHz: Number(e.target.value) },
                        })
                      }
                      style={{ width: '100%' }}
                    />
                  </label>
                  <label>
                    Thresh (dB)
                    <input
                      type="number"
                      value={rack.deEsser.thresholdDb}
                      onChange={(e) =>
                        onUpdateRack({
                          ...rack,
                          deEsser: { ...rack.deEsser, thresholdDb: Number(e.target.value) },
                        })
                      }
                      style={{ width: '100%' }}
                    />
                  </label>
                  <label>
                    Red. (dB)
                    <input
                      type="number"
                      value={rack.deEsser.reductionDb}
                      onChange={(e) =>
                        onUpdateRack({
                          ...rack,
                          deEsser: { ...rack.deEsser, reductionDb: Number(e.target.value) },
                        })
                      }
                      style={{ width: '100%' }}
                    />
                  </label>
                </div>
                <label style={{ fontWeight: 700, display: 'flex', gap: 6, marginBottom: 6 }}>
                  <input
                    type="checkbox"
                    checked={rack.multiband.enabled}
                    onChange={(e) =>
                      onUpdateRack({
                        ...rack,
                        multiband: { ...rack.multiband, enabled: e.target.checked },
                      })
                    }
                  />
                  Compresor Multibanda (3 Bandas)
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 5 }}>
                  <label>
                    Low Thresh
                    <input
                      type="number"
                      value={rack.multiband.lowThresholdDb}
                      onChange={(e) =>
                        onUpdateRack({
                          ...rack,
                          multiband: { ...rack.multiband, lowThresholdDb: Number(e.target.value) },
                        })
                      }
                      style={{ width: '100%' }}
                    />
                  </label>
                  <label>
                    Mid Thresh
                    <input
                      type="number"
                      value={rack.multiband.midThresholdDb}
                      onChange={(e) =>
                        onUpdateRack({
                          ...rack,
                          multiband: { ...rack.multiband, midThresholdDb: Number(e.target.value) },
                        })
                      }
                      style={{ width: '100%' }}
                    />
                  </label>
                  <label>
                    High Thresh
                    <input
                      type="number"
                      value={rack.multiband.highThresholdDb}
                      onChange={(e) =>
                        onUpdateRack({
                          ...rack,
                          multiband: { ...rack.multiband, highThresholdDb: Number(e.target.value) },
                        })
                      }
                      style={{ width: '100%' }}
                    />
                  </label>
                </div>
              </div>
            </div>
          )}

          {tab === 'creative' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
              <div style={{ background: 'var(--bg-elevated)', padding: 10, borderRadius: 6 }}>
                <label style={{ fontWeight: 700, display: 'flex', gap: 6, marginBottom: 6 }}>
                  <input
                    type="checkbox"
                    checked={rack.reverb.enabled}
                    onChange={(e) =>
                      onUpdateRack({ ...rack, reverb: { ...rack.reverb, enabled: e.target.checked } })
                    }
                  />
                  Reverb
                </label>
                <label>
                  Tamaño sala ({Math.round(rack.reverb.roomSize * 100)}%)
                  <input
                    type="range"
                    min={0.1}
                    max={0.95}
                    step={0.05}
                    value={rack.reverb.roomSize}
                    onChange={(e) =>
                      onUpdateRack({
                        ...rack,
                        reverb: { ...rack.reverb, roomSize: Number(e.target.value) },
                      })
                    }
                    style={{ width: '100%' }}
                  />
                </label>
                <label>
                  Mezcla Wet ({Math.round(rack.reverb.mix * 100)}%)
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.02}
                    value={rack.reverb.mix}
                    onChange={(e) =>
                      onUpdateRack({
                        ...rack,
                        reverb: { ...rack.reverb, mix: Number(e.target.value) },
                      })
                    }
                    style={{ width: '100%' }}
                  />
                </label>
              </div>

              <div style={{ background: 'var(--bg-elevated)', padding: 10, borderRadius: 6 }}>
                <label style={{ fontWeight: 700, display: 'flex', gap: 6, marginBottom: 6 }}>
                  <input
                    type="checkbox"
                    checked={rack.delay.enabled}
                    onChange={(e) =>
                      onUpdateRack({ ...rack, delay: { ...rack.delay, enabled: e.target.checked } })
                    }
                  />
                  Delay / Echo
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <label>
                    Tiempo (ms)
                    <input
                      type="number"
                      value={rack.delay.timeMs}
                      onChange={(e) =>
                        onUpdateRack({
                          ...rack,
                          delay: { ...rack.delay, timeMs: Number(e.target.value) },
                        })
                      }
                      style={{ width: '100%' }}
                    />
                  </label>
                  <label>
                    Feedback
                    <input
                      type="number"
                      step={0.05}
                      min={0}
                      max={0.9}
                      value={rack.delay.feedback}
                      onChange={(e) =>
                        onUpdateRack({
                          ...rack,
                          delay: { ...rack.delay, feedback: Number(e.target.value) },
                        })
                      }
                      style={{ width: '100%' }}
                    />
                  </label>
                  <label>
                    Mix Wet ({Math.round(rack.delay.mix * 100)}%)
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.02}
                      value={rack.delay.mix}
                      onChange={(e) =>
                        onUpdateRack({
                          ...rack,
                          delay: { ...rack.delay, mix: Number(e.target.value) },
                        })
                      }
                      style={{ width: '100%' }}
                    />
                  </label>
                  <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 12 }}>
                    <input
                      type="checkbox"
                      checked={rack.delay.pingPong}
                      onChange={(e) =>
                        onUpdateRack({
                          ...rack,
                          delay: { ...rack.delay, pingPong: e.target.checked },
                        })
                      }
                    />
                    Ping-Pong Estéreo
                  </label>
                </div>
              </div>

              <div style={{ background: 'var(--bg-elevated)', padding: 10, borderRadius: 6 }}>
                <label style={{ fontWeight: 700, display: 'flex', gap: 6, marginBottom: 6 }}>
                  <input
                    type="checkbox"
                    checked={rack.modulation.enabled}
                    onChange={(e) =>
                      onUpdateRack({
                        ...rack,
                        modulation: { ...rack.modulation, enabled: e.target.checked },
                      })
                    }
                  />
                  Modulación (Chorus / Flanger / Phaser / Tremolo / Vibrato)
                </label>
                <select
                  value={rack.modulation.type}
                  onChange={(e) =>
                    onUpdateRack({
                      ...rack,
                      modulation: {
                        ...rack.modulation,
                        type: e.target.value as TrackEffectRack['modulation']['type'],
                      },
                    })
                  }
                  style={{ width: '100%', marginBottom: 6 }}
                >
                  <option value="chorus">Chorus</option>
                  <option value="flanger">Flanger</option>
                  <option value="phaser">Phaser</option>
                  <option value="tremolo">Tremolo</option>
                  <option value="vibrato">Vibrato</option>
                </select>
                <label>
                  Velocidad LFO ({rack.modulation.rateHz} Hz)
                  <input
                    type="range"
                    min={0.1}
                    max={10}
                    step={0.1}
                    value={rack.modulation.rateHz}
                    onChange={(e) =>
                      onUpdateRack({
                        ...rack,
                        modulation: { ...rack.modulation, rateHz: Number(e.target.value) },
                      })
                    }
                    style={{ width: '100%' }}
                  />
                </label>
              </div>

              <div style={{ background: 'var(--bg-elevated)', padding: 10, borderRadius: 6 }}>
                <label style={{ fontWeight: 700, display: 'flex', gap: 6, marginBottom: 6 }}>
                  <input
                    type="checkbox"
                    checked={rack.saturation.enabled}
                    onChange={(e) =>
                      onUpdateRack({
                        ...rack,
                        saturation: { ...rack.saturation, enabled: e.target.checked },
                      })
                    }
                  />
                  Saturación / Distorsión / Excitador + Stereo & Pitch
                </label>
                <select
                  value={rack.saturation.mode}
                  onChange={(e) =>
                    onUpdateRack({
                      ...rack,
                      saturation: {
                        ...rack.saturation,
                        mode: e.target.value as TrackEffectRack['saturation']['mode'],
                      },
                    })
                  }
                  style={{ width: '100%', marginBottom: 6 }}
                >
                  <option value="saturation">Saturación analógica</option>
                  <option value="distortion">Distorsión</option>
                  <option value="exciter">Excitador armónico</option>
                </select>
                <div style={{ display: 'flex', gap: 6 }}>
                  <label style={{ flex: 1 }}>
                    Ancho estéreo ({rack.widener.width.toFixed(2)}x)
                    <input
                      type="range"
                      min={0}
                      max={2}
                      step={0.05}
                      value={rack.widener.width}
                      onChange={(e) =>
                        onUpdateRack({
                          ...rack,
                          widener: { enabled: true, width: Number(e.target.value) },
                        })
                      }
                      style={{ width: '100%' }}
                    />
                  </label>
                  <label style={{ width: 90 }}>
                    Pitch (st)
                    <input
                      type="number"
                      min={-12}
                      max={12}
                      value={rack.pitchTempo.semitones}
                      onChange={(e) =>
                        onUpdateRack({
                          ...rack,
                          pitchTempo: {
                            ...rack.pitchTempo,
                            enabled: true,
                            semitones: Number(e.target.value),
                          },
                        })
                      }
                    />
                  </label>
                </div>
              </div>
            </div>
          )}

          {tab === 'restoration' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {(
                  [
                    ['pro-voice', 'Voz profesional'],
                    ['podcast', 'Podcast'],
                    ['church', 'Grabación de iglesia'],
                    ['ambient', 'Grabación ambiental'],
                    ['vintage', 'Audio antiguo'],
                    ['interview', 'Entrevistas'],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    className={`ws-tab ${restoration.profile === key ? 'active' : ''}`}
                    onClick={() => setRestoration(RESTORATION_PROFILES[key])}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                <label style={{ background: 'var(--bg-elevated)', padding: 8, borderRadius: 5 }}>
                  Reducción de ruido ambiental ({Math.round(restoration.noiseReductionAmount * 100)}%)
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={restoration.noiseReductionAmount}
                    onChange={(e) =>
                      setRestoration({
                        ...restoration,
                        profile: 'custom',
                        noiseReductionAmount: Number(e.target.value),
                      })
                    }
                    style={{ width: '100%' }}
                  />
                </label>

                <label style={{ background: 'var(--bg-elevated)', padding: 8, borderRadius: 5 }}>
                  Eliminación zumbido eléctrico
                  <select
                    value={restoration.humFreqHz}
                    onChange={(e) =>
                      setRestoration({
                        ...restoration,
                        profile: 'custom',
                        humFreqHz: Number(e.target.value) as 0 | 50 | 60,
                      })
                    }
                    style={{ width: '100%', marginTop: 4 }}
                  >
                    <option value={0}>Desactivado</option>
                    <option value={50}>50 Hz (Europa / Sudamérica)</option>
                    <option value={60}>60 Hz (Norteamérica / Centroamérica)</option>
                  </select>
                </label>

                <label style={{ background: 'var(--bg-elevated)', padding: 8, borderRadius: 5 }}>
                  Eliminación de clics y chasquidos ({Math.round(restoration.deClickAmount * 100)}%)
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={restoration.deClickAmount}
                    onChange={(e) =>
                      setRestoration({
                        ...restoration,
                        profile: 'custom',
                        deClickAmount: Number(e.target.value),
                      })
                    }
                    style={{ width: '100%' }}
                  />
                </label>

                <label style={{ background: 'var(--bg-elevated)', padding: 8, borderRadius: 5 }}>
                  Reducción de reverberación de sala ({Math.round(restoration.deReverbAmount * 100)}%)
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={restoration.deReverbAmount}
                    onChange={(e) =>
                      setRestoration({
                        ...restoration,
                        profile: 'custom',
                        deReverbAmount: Number(e.target.value),
                      })
                    }
                    style={{ width: '100%' }}
                  />
                </label>

                <label style={{ background: 'var(--bg-elevated)', padding: 8, borderRadius: 5 }}>
                  Control de respiraciones ({Math.round(restoration.breathReductionAmount * 100)}%)
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={restoration.breathReductionAmount}
                    onChange={(e) =>
                      setRestoration({
                        ...restoration,
                        profile: 'custom',
                        breathReductionAmount: Number(e.target.value),
                      })
                    }
                    style={{ width: '100%' }}
                  />
                </label>

                <label style={{ background: 'var(--bg-elevated)', padding: 8, borderRadius: 5 }}>
                  Mejora de inteligibilidad ({Math.round(restoration.clarityAmount * 100)}%)
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={restoration.clarityAmount}
                    onChange={(e) =>
                      setRestoration({
                        ...restoration,
                        profile: 'custom',
                        clarityAmount: Number(e.target.value),
                      })
                    }
                    style={{ width: '100%' }}
                  />
                </label>
              </div>
            </div>
          )}

          {tab === 'voice' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
              {VOICE_PRESETS.map((preset) => (
                <div
                  key={preset.id}
                  style={{
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-dark)',
                    borderRadius: 6,
                    padding: 10,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: 6,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, color: 'var(--accent-electric)' }}>
                      {preset.name}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                      {preset.description}
                    </div>
                  </div>
                  <button
                    className="btn-secondary"
                    onClick={() => {
                      onUpdateRack({
                        ...rack,
                        ...preset.rack,
                      });
                      setRestoration(preset.restoration);
                    }}
                  >
                    Cargar Preset Vocal
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button
              className={`btn-secondary ${abMode === 'A' ? 'active' : ''}`}
              disabled={!activePcm}
              onClick={() => handlePreview('A')}
            >
              <Play size={12} /> A (Original)
            </button>
            <button
              className={`btn-secondary ${abMode === 'B' ? 'active' : ''}`}
              disabled={!activePcm}
              onClick={() => handlePreview('B')}
            >
              <Play size={12} /> B (Procesado)
            </button>
            <button className="btn-secondary" onClick={onStopPreview}>
              <Square size={12} /> Detener
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn-primary"
              disabled={!activePcm || busy}
              onClick={() => void handleApplyToAudio()}
            >
              {busy ? 'Procesando en Worker...' : 'Aplicar al Audio Activo'}
            </button>
            <button className="btn-secondary" onClick={onClose}>
              Cerrar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
