import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { analyzeMetering } from '../../audio/dsp/metering';
import { PcmAudioData } from '../../audio/dsp/pcmBuffer';
import { dspWorker } from '../../audio/workers/DspWorkerClient';
import { MASTERING_PROFILES } from '../../shared/presets';
import { MasteringChain } from '../../shared/types';

interface MasteringModalProps {
  chain: MasteringChain;
  sourcePcm?: PcmAudioData;
  getSpectrumData: () => Uint8Array;
  onUpdateChain: (chain: MasteringChain) => void;
  onPreviewMaster: (pcm: PcmAudioData) => void;
  onRenderMasteredAsset: (pcm: PcmAudioData, profileName: string) => void;
  onClose: () => void;
}

export const MasteringModal: React.FC<MasteringModalProps> = ({
  chain,
  sourcePcm,
  getSpectrumData,
  onUpdateChain,
  onPreviewMaster,
  onRenderMasteredAsset,
  onClose,
}) => {
  const spectrumCanvasRef = useRef<HTMLCanvasElement>(null);
  const [savedChains, setSavedChains] = useState<Record<string, MasteringChain>>({});
  const [customName, setCustomName] = useState('Mi Master Personalizado');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    window.audioStudio
      ?.getSetting<Record<string, MasteringChain>>('customMasteringChains', {})
      .then((res) => setSavedChains(res || {}))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const canvas = spectrumCanvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const bins = getSpectrumData();
          ctx.fillStyle = '#090b0f';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          if (bins.length > 0) {
            const bars = 64;
            const barW = canvas.width / bars;
            for (let i = 0; i < bars; i++) {
              const idx = Math.floor((i / bars) * (bins.length * 0.65));
              const v = bins[idx] / 255;
              const h = v * canvas.height;
              ctx.fillStyle = v > 0.85 ? '#ef4444' : v > 0.65 ? '#eab308' : '#00a8e8';
              ctx.fillRect(i * barW + 1, canvas.height - h, barW - 2, h);
            }
          }
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [getSpectrumData]);

  const meter = React.useMemo(
    () => (sourcePcm ? analyzeMetering(sourcePcm) : null),
    [sourcePcm]
  );

  const handleSaveCustom = async () => {
    const next = { ...savedChains, [customName]: { ...chain, profileName: customName } };
    setSavedChains(next);
    await window.audioStudio?.setSetting('customMasteringChains', next);
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-card" style={{ width: 820, height: 600 }}>
        <div className="modal-header">
          <span>Estudio de Masterización — {chain.profileName}</span>
          <button className="mini-btn" style={{ width: 26, height: 24 }} onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>
              Perfiles de Masterización y Exportación
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {Object.keys(MASTERING_PROFILES).map((name) => (
                <button
                  key={name}
                  className={`ws-tab ${chain.profileName === name ? 'active' : ''}`}
                  onClick={() =>
                    onUpdateChain(JSON.parse(JSON.stringify(MASTERING_PROFILES[name])))
                  }
                >
                  {name}
                </button>
              ))}
              {Object.keys(savedChains).map((name) => (
                <button
                  key={`cust-${name}`}
                  className={`ws-tab ${chain.profileName === name ? 'active' : ''}`}
                  onClick={() => onUpdateChain(JSON.parse(JSON.stringify(savedChains[name])))}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>

          <canvas
            ref={spectrumCanvasRef}
            width={760}
            height={110}
            style={{
              width: '100%',
              height: 110,
              borderRadius: 6,
              border: '1px solid var(--border-dark)',
            }}
          />

          {meter && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                background: 'var(--bg-elevated)',
                padding: '7px 10px',
                borderRadius: 5,
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
              }}
            >
              <span>LUFS Integrado Actual: {meter.integratedLufs.toFixed(1)} LUFS</span>
              <span>True Peak: {meter.truePeakDb.toFixed(2)} dBTP</span>
              <span>Correlación Fase: {meter.phaseCorrelation.toFixed(2)}</span>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            <div style={{ background: 'var(--bg-elevated)', padding: 10, borderRadius: 6 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Objetivo LUFS y Limitador</div>
              <label>
                Target LUFS
                <input
                  type="number"
                  step={0.5}
                  min={-24}
                  max={-6}
                  value={chain.targetLufs}
                  onChange={(e) =>
                    onUpdateChain({ ...chain, targetLufs: Number(e.target.value) })
                  }
                  style={{ width: '100%', marginBottom: 6 }}
                />
              </label>
              <label>
                True Peak Ceiling (dBTP)
                <input
                  type="number"
                  step={0.1}
                  min={-6}
                  max={0}
                  value={chain.limiter.ceilingDb}
                  onChange={(e) =>
                    onUpdateChain({
                      ...chain,
                      limiter: { ...chain.limiter, ceilingDb: Number(e.target.value) },
                    })
                  }
                  style={{ width: '100%' }}
                />
              </label>
            </div>

            <div style={{ background: 'var(--bg-elevated)', padding: 10, borderRadius: 6 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Compresor Bus + Multibanda</div>
              <label>
                Threshold Bus (dB)
                <input
                  type="number"
                  value={chain.compressor.thresholdDb}
                  onChange={(e) =>
                    onUpdateChain({
                      ...chain,
                      compressor: { ...chain.compressor, thresholdDb: Number(e.target.value) },
                    })
                  }
                  style={{ width: '100%', marginBottom: 6 }}
                />
              </label>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={chain.multiband.enabled}
                  onChange={(e) =>
                    onUpdateChain({
                      ...chain,
                      multiband: { ...chain.multiband, enabled: e.target.checked },
                    })
                  }
                />
                Multibanda Activo
              </label>
            </div>

            <div style={{ background: 'var(--bg-elevated)', padding: 10, borderRadius: 6 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Imagen Estéreo y Saturación</div>
              <label>
                Stereo Imager ({chain.widener.width.toFixed(2)}x)
                <input
                  type="range"
                  min={0.5}
                  max={1.8}
                  step={0.05}
                  value={chain.widener.width}
                  onChange={(e) =>
                    onUpdateChain({
                      ...chain,
                      widener: { enabled: true, width: Number(e.target.value) },
                    })
                  }
                  style={{ width: '100%' }}
                />
              </label>
              <label>
                Drive Saturación ({Math.round(chain.saturation.drive * 100)}%)
                <input
                  type="range"
                  min={0}
                  max={0.6}
                  step={0.02}
                  value={chain.saturation.drive}
                  onChange={(e) =>
                    onUpdateChain({
                      ...chain,
                      saturation: {
                        ...chain.saturation,
                        enabled: true,
                        drive: Number(e.target.value),
                      },
                    })
                  }
                  style={{ width: '100%' }}
                />
              </label>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="text"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              style={{ flex: 1 }}
            />
            <button className="btn-secondary" onClick={handleSaveCustom}>
              Guardar Cadena Personalizada
            </button>
          </div>
        </div>

        <div className="modal-footer">
          <button
            className="btn-secondary"
            disabled={!sourcePcm || busy}
            onClick={async () => {
              if (!sourcePcm) return;
              setBusy(true);
              try {
                const res = await dspWorker.processMastering(sourcePcm, chain);
                onPreviewMaster(res);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Procesando...' : 'Previsualizar Master'}
          </button>
          <button
            className="btn-primary"
            disabled={!sourcePcm || busy}
            onClick={async () => {
              if (!sourcePcm) return;
              setBusy(true);
              try {
                const res = await dspWorker.processMastering(sourcePcm, chain);
                onRenderMasteredAsset(res, chain.profileName);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Masterizando...' : 'Procesar y Guardar Versión Masterizada'}
          </button>
        </div>
      </div>
    </div>
  );
};
