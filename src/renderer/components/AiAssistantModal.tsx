import React, { useEffect, useState } from 'react';
import { Brain, X } from 'lucide-react';
import { PcmAudioData } from '../../audio/dsp/pcmBuffer';
import { dspWorker } from '../../audio/workers/DspWorkerClient';
import { AiAnalysisReport } from '../../shared/types';

interface AiAssistantModalProps {
  activePcm?: PcmAudioData;
  assetName?: string;
  onApplyAction: (actionId: string) => void;
  onSeparateMs: (mode: 'isolate-voice' | 'isolate-music') => void;
  onAutoBalanceTracks: () => void;
  onRunOnnxModel?: (modelPath: string) => Promise<void>;
  onClose: () => void;
}

export const AiAssistantModal: React.FC<AiAssistantModalProps> = ({
  activePcm,
  assetName,
  onApplyAction,
  onSeparateMs,
  onAutoBalanceTracks,
  onRunOnnxModel,
  onClose,
}) => {
  const [report, setReport] = useState<AiAnalysisReport | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [onnxModels, setOnnxModels] = useState<Array<{ name: string; filePath: string; sizeBytes: number }>>([]);
  const [onnxStatus, setOnnxStatus] = useState<string | null>(null);
  const [runningModel, setRunningModel] = useState<string | null>(null);

  useEffect(() => {
    window.audioStudio?.listOnnxModels().then(setOnnxModels).catch(() => {});
  }, []);

  useEffect(() => {
    if (!activePcm) {
      setReport(null);
      return;
    }
    let cancelled = false;
    setAnalyzing(true);
    dspWorker
      .analyzeAi(activePcm)
      .then((res) => {
        if (!cancelled) setReport(res);
      })
      .finally(() => {
        if (!cancelled) setAnalyzing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activePcm]);

  return (
    <div className="modal-backdrop">
      <div className="modal-card" style={{ width: 760, height: 580 }}>
        <div className="modal-header">
          <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <Brain size={16} color="#00a8e8" />
            AI AUDIO ASSISTANT (Análisis DSP Local en Web Worker)
          </span>
          <button className="mini-btn" style={{ width: 26, height: 24 }} onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {analyzing ? (
            <div style={{ color: 'var(--accent-electric)', padding: 24, textAlign: 'center', fontWeight: 600 }}>
              Analizando espectro, ruido de fondo, zumbidos y sonoridad LUFS en segundo plano...
            </div>
          ) : !report || !activePcm ? (
            <div style={{ color: 'var(--text-secondary)', padding: 20, textAlign: 'center' }}>
              Seleccione o importe un archivo de audio para ejecutar el diagnóstico espectral y dinámico.
            </div>
          ) : (
            <>
              <div style={{ fontWeight: 700, color: 'var(--accent-electric)' }}>
                Archivo analizado: {assetName} ({report.durationSec.toFixed(2)}s)
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                <div style={{ background: 'var(--bg-elevated)', padding: 8, borderRadius: 5 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>LUFS / Pico</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                    {report.integratedLufs.toFixed(1)} LUFS / {report.peakDb.toFixed(1)} dB
                  </div>
                </div>
                <div style={{ background: 'var(--bg-elevated)', padding: 8, borderRadius: 5 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Piso Ruido / SNR</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                    {report.estimatedNoiseFloorDb.toFixed(1)} dB / {report.estimatedSnrDb.toFixed(1)} dB
                  </div>
                </div>
                <div style={{ background: 'var(--bg-elevated)', padding: 8, borderRadius: 5 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Presencia Vocal</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                    {Math.round(report.speechProbability * 100)}%
                  </div>
                </div>
                <div style={{ background: 'var(--bg-elevated)', padding: 8, borderRadius: 5 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Zumbido / Silencios</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                    {report.humDetectedHz ? `${report.humDetectedHz} Hz` : 'Limpio'} ·{' '}
                    {report.silentRegions.length} sil.
                  </div>
                </div>
              </div>

              <div>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>
                  Recomendaciones de Ingeniería ({report.recommendations.length})
                </div>
                {report.recommendations.length === 0 ? (
                  <div className="badge badge-ok">
                    Señal balanceada, sin clipping ni zumbidos detectados.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {report.recommendations.map((rec) => (
                      <div
                        key={rec.id}
                        style={{
                          background: 'var(--bg-elevated)',
                          border: '1px solid var(--border-dark)',
                          borderRadius: 6,
                          padding: '8px 10px',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: 10,
                        }}
                      >
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span
                              className={`badge ${
                                rec.severity === 'critical'
                                  ? 'badge-crit'
                                  : rec.severity === 'warning'
                                  ? 'badge-warn'
                                  : 'badge-ok'
                              }`}
                            >
                              {rec.category.toUpperCase()}
                            </span>
                            <span style={{ fontWeight: 700 }}>{rec.title}</span>
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 3 }}>
                            {rec.description}
                          </div>
                        </div>
                        <button
                          className="btn-primary"
                          onClick={() => onApplyAction(rec.actionId)}
                        >
                          Aplicar
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div
                style={{
                  background: 'var(--bg-elevated)',
                  padding: 10,
                  borderRadius: 6,
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 8,
                  alignItems: 'center',
                }}
              >
                <span style={{ fontWeight: 700, marginRight: 4 }}>Herramientas Inteligentes:</span>
                <button
                  className="btn-secondary"
                  onClick={() => onSeparateMs('isolate-voice')}
                >
                  Aislar Voz Central (M/S)
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => onSeparateMs('isolate-music')}
                >
                  Aislar Música Estéreo (M/S)
                </button>
                <button className="btn-secondary" onClick={onAutoBalanceTracks}>
                  Auto-Balancear Pistas Multipista
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => onApplyAction('smart-lufs-14')}
                >
                  Normalización Inteligente (-14 LUFS)
                </button>
              </div>

              <div
                style={{
                  background: 'var(--bg-elevated)',
                  padding: 10,
                  borderRadius: 6,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 700 }}>
                    Modelos de IA Local (ONNX Runtime: {onnxModels.length} cargado(s))
                  </span>
                  <button
                    className="btn-secondary"
                    onClick={async () => {
                      const added = await window.audioStudio.importOnnxModel();
                      if (added) {
                        const list = await window.audioStudio.listOnnxModels();
                        setOnnxModels(list);
                        const info = await window.audioStudio.inspectOnnxModel(added.filePath);
                        setOnnxStatus(
                          `Modelo ${added.name} listo (inputs: ${info.inputNames.join(', ')})`
                        );
                      }
                    }}
                  >
                    Importar modelo .onnx...
                  </button>
                </div>
                {onnxModels.length === 0 ? (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    Sin modelos .onnx importados. Puede cargar modelos locales compatibles (ej. RNNoise / DeepFilterNet / Demucs) para inferencia neuronal sin conexión.
                  </div>
                ) : (
                  onnxModels.map((m) => (
                    <div
                      key={m.filePath}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        fontSize: 11,
                        background: 'var(--bg-card)',
                        padding: '6px 8px',
                        borderRadius: 4,
                      }}
                    >
                      <span>
                        <strong>{m.name}</strong> ({(m.sizeBytes / 1024 / 1024).toFixed(2)} MB)
                      </span>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <button
                          className="mini-btn"
                          style={{ padding: '2px 8px' }}
                          onClick={async () => {
                            try {
                              setOnnxStatus(`Ejecutando ${m.name}...`);
                              const info = await window.audioStudio.inspectOnnxModel(m.filePath);
                              setOnnxStatus(
                                `Sesión ONNX verificada: ${m.name} [${info.inputNames.join(', ')} → ${info.outputNames.join(', ')}]`
                              );
                            } catch (err) {
                              setOnnxStatus(
                                `Error ONNX: ${err instanceof Error ? err.message : String(err)}`
                              );
                            }
                          }}
                        >
                          Verificar
                        </button>
                        <button
                          className="mini-btn btn-primary"
                          style={{ padding: '2px 10px' }}
                          disabled={!activePcm || runningModel !== null}
                          onClick={async () => {
                            if (!onRunOnnxModel) return;
                            try {
                              setRunningModel(m.filePath);
                              setOnnxStatus(`Procesando audio activo con modelo ${m.name}...`);
                              await onRunOnnxModel(m.filePath);
                              setOnnxStatus(`Modelo ${m.name} aplicado con éxito.`);
                            } catch (err) {
                              setOnnxStatus(
                                `Error al procesar: ${err instanceof Error ? err.message : String(err)}`
                              );
                            } finally {
                              setRunningModel(null);
                            }
                          }}
                        >
                          {runningModel === m.filePath ? 'Procesando...' : 'Aplicar al audio activo'}
                        </button>
                      </div>
                    </div>
                  ))
                )}
                {onnxStatus && (
                  <div style={{ fontSize: 11, color: 'var(--accent-electric)' }}>{onnxStatus}</div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
