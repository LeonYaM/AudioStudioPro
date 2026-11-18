import React, { useEffect, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { LatencyMode } from '../../audio/engine/AudioEngine';
import {
  AudioDeviceInfo,
  ShortcutMap,
  VstPluginInfo,
  WindowsDriverInfo,
} from '../../shared/types';

interface PreferencesModalProps {
  theme: 'dark' | 'light';
  latencyMode: LatencyMode;
  inputDeviceId: string;
  outputDeviceId: string;
  inputGainDb: number;
  monitorInput: boolean;
  countdownSec: number;
  shortcuts: ShortcutMap;
  projectVersions: Array<{ versionId: number; savedAt: string; label: string }>;
  devices: AudioDeviceInfo[];
  onChangeTheme: (t: 'dark' | 'light') => void;
  onChangeLatency: (m: LatencyMode) => void;
  onChangeInputDevice: (id: string) => void;
  onChangeOutputDevice: (id: string) => void;
  onChangeInputGain: (db: number) => void;
  onChangeMonitorInput: (v: boolean) => void;
  onChangeCountdown: (sec: number) => void;
  onSaveShortcuts: (map: ShortcutMap) => void;
  onRestoreVersion: (versionId: number) => void;
  onRefreshDevices: () => void;
  onClose: () => void;
}

export const PreferencesModal: React.FC<PreferencesModalProps> = ({
  theme,
  latencyMode,
  inputDeviceId,
  outputDeviceId,
  inputGainDb,
  monitorInput,
  countdownSec,
  shortcuts,
  projectVersions,
  devices,
  onChangeTheme,
  onChangeLatency,
  onChangeInputDevice,
  onChangeOutputDevice,
  onChangeInputGain,
  onChangeMonitorInput,
  onChangeCountdown,
  onSaveShortcuts,
  onRestoreVersion,
  onRefreshDevices,
  onClose,
}) => {
  const [tab, setTab] = useState<'audio' | 'plugins' | 'shortcuts' | 'versions' | 'logs'>('audio');
  const [drivers, setDrivers] = useState<WindowsDriverInfo[]>([]);
  const [hwDevices, setHwDevices] = useState<string[]>([]);
  const [plugins, setPlugins] = useState<VstPluginInfo[]>([]);
  const [nativeHostStatus, setNativeHostStatus] = useState<{
    compiled: boolean;
    executablePath: string;
    running: boolean;
    notes: string;
  } | null>(null);
  const [logs, setLogs] = useState<Array<{ createdAt: string; context: string; message: string }>>([]);
  const [localShortcuts, setLocalShortcuts] = useState<ShortcutMap>(shortcuts);
  const [vstFeedback, setVstFeedback] = useState<string | null>(null);

  useEffect(() => {
    window.audioStudio?.inspectAudioDrivers().then((res) => {
      setDrivers(res.drivers);
      setHwDevices(res.hardwareDevices);
    });
    window.audioStudio?.scanPlugins().then(setPlugins);
    window.audioStudio?.getNativeHostStatus().then(setNativeHostStatus);
    window.audioStudio?.getErrorLogs().then(setLogs);
  }, []);

  const inputs = devices.filter((d) => d.kind === 'audioinput');
  const outputs = devices.filter((d) => d.kind === 'audiooutput');

  return (
    <div className="modal-backdrop">
      <div className="modal-card" style={{ width: 820, height: 600 }}>
        <div className="modal-header">
          <span>Preferencias, Dispositivos Windows, Plugins y Atajos</span>
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
              ['audio', 'Audio, Grabación y Drivers'],
              ['plugins', 'Plugins (Native DSP / VST3)'],
              ['shortcuts', 'Atajos de Teclado'],
              ['versions', 'Versiones del Proyecto'],
              ['logs', 'Registro de Errores'],
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

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {tab === 'audio' && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <label>
                  Dispositivo de Entrada (Micrófono / Interfaz)
                  <select
                    value={inputDeviceId}
                    onChange={(e) => onChangeInputDevice(e.target.value)}
                    style={{ width: '100%', marginTop: 4 }}
                  >
                    <option value="default">Predeterminado de Windows</option>
                    {inputs.map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Dispositivo de Salida (Monitores / Auriculares)
                  <select
                    value={outputDeviceId}
                    onChange={(e) => onChangeOutputDevice(e.target.value)}
                    style={{ width: '100%', marginTop: 4 }}
                  >
                    <option value="default">Predeterminado de Windows</option>
                    {outputs.map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Modo de Latencia / Buffer
                  <select
                    value={latencyMode}
                    onChange={(e) => onChangeLatency(e.target.value as LatencyMode)}
                    style={{ width: '100%', marginTop: 4 }}
                  >
                    <option value="interactive">Baja latencia (Grabación / Monitoreo)</option>
                    <option value="balanced">Equilibrado (Edición multipista)</option>
                    <option value="playback">Buffer amplio (Mezcla pesada)</option>
                  </select>
                </label>

                <label>
                  Tema de Interfaz
                  <select
                    value={theme}
                    onChange={(e) => onChangeTheme(e.target.value as 'dark' | 'light')}
                    style={{ width: '100%', marginTop: 4 }}
                  >
                    <option value="dark">Oscuro Profesional (Grafito / Negro Mate)</option>
                    <option value="light">Tema Claro</option>
                  </select>
                </label>

                <label>
                  Ganancia de Entrada ({inputGainDb} dB)
                  <input
                    type="range"
                    min={-12}
                    max={24}
                    step={0.5}
                    value={inputGainDb}
                    onChange={(e) => onChangeInputGain(Number(e.target.value))}
                    style={{ width: '100%' }}
                  />
                </label>

                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={monitorInput}
                      onChange={(e) => onChangeMonitorInput(e.target.checked)}
                    />
                    Monitorización directa
                  </label>
                  <label style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                    Cuenta regresiva (s):
                    <input
                      type="number"
                      min={0}
                      max={10}
                      value={countdownSec}
                      onChange={(e) => onChangeCountdown(Number(e.target.value))}
                      style={{ width: 48 }}
                    />
                  </label>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 700 }}>
                  Estado Real de Controladores Windows (WASAPI / ASIO / DirectSound)
                </span>
                <button className="btn-secondary" onClick={onRefreshDevices}>
                  <RefreshCw size={12} /> Re-escanear dispositivos
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {drivers.map((drv, i) => (
                  <div
                    key={i}
                    style={{
                      background: 'var(--bg-elevated)',
                      padding: 8,
                      borderRadius: 5,
                      border: '1px solid var(--border-dark)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <strong>{drv.name}</strong>
                      <span className={`badge ${drv.available ? 'badge-ok' : 'badge-warn'}`}>
                        {drv.available ? 'Disponible' : 'No detectado'}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                      {drv.notes}
                    </div>
                  </div>
                ))}
                {hwDevices.length > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    Hardware detectado por Windows: {hwDevices.join(' · ')}
                  </div>
                )}
              </div>
            </>
          )}

          {tab === 'plugins' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {nativeHostStatus && (
                <div
                  style={{
                    background: 'var(--bg-elevated)',
                    padding: 8,
                    borderRadius: 5,
                    border: '1px solid var(--border-dark)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700 }}>
                      Host Nativo Aislado JUCE (ASIO / VST3 Out-of-Process)
                    </div>
                    <div style={{ fontSize: 10.5, color: 'var(--text-secondary)' }}>
                      {nativeHostStatus.notes}
                    </div>
                  </div>
                  <span className={`badge ${nativeHostStatus.compiled ? 'badge-ok' : 'badge-warn'}`}>
                    {nativeHostStatus.compiled ? 'Compilado' : 'Pendiente compilar C++'}
                  </span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                  Escaneo real de carpetas VST3/VST2 de Windows y módulos DSP nativos.
                </span>
                <button
                  className="btn-secondary"
                  onClick={async () => {
                    const folder = await window.audioStudio.selectFolder();
                    const res = await window.audioStudio.scanPlugins(folder ? [folder] : []);
                    setPlugins(res);
                  }}
                >
                  Escanear carpeta personalizada...
                </button>
              </div>
              {plugins.map((pl) => (
                <div
                  key={pl.id}
                  style={{
                    background: 'var(--bg-elevated)',
                    padding: 8,
                    borderRadius: 5,
                    border: '1px solid var(--border-dark)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700 }}>
                      {pl.name}{' '}
                      <span className="badge badge-ok" style={{ marginLeft: 6 }}>
                        {pl.format}
                      </span>
                    </div>
                    <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                      {pl.vendor} · {pl.path}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {pl.format === 'VST3' && (
                      <button
                        className="mini-btn"
                        style={{ padding: '2px 8px' }}
                        onClick={() => {
                          if (!nativeHostStatus?.compiled) {
                            setVstFeedback(
                              'El host aislado C++/JUCE (audio-studio-native-host.exe) no está compilado aún. Se requiere Visual Studio Build Tools + CMake en Windows. No obstante, todos los efectos nativos de AUDIO STUDIO PRO (EQ, dinámicas, reverb, de-esser y restauración) funcionan al 100% integrados y con latencia cero.'
                            );
                          } else {
                            setVstFeedback(
                              `Host nativo JUCE disponible para procesar offline con el plugin: ${pl.name}.`
                            );
                          }
                        }}
                      >
                        Verificar VST3
                      </button>
                    )}
                    <span className="badge badge-ok">
                      {pl.format === 'NativeDSP' ? 'Activo' : 'Detectado en disco'}
                    </span>
                  </div>
                </div>
              ))}
              {vstFeedback && (
                <div
                  style={{
                    background: 'rgba(0, 150, 255, 0.08)',
                    border: '1px solid var(--accent-petroleum)',
                    borderRadius: 5,
                    padding: '8px 10px',
                    fontSize: 11,
                    color: 'var(--text-primary)',
                    marginTop: 6,
                  }}
                >
                  {vstFeedback}
                </div>
              )}
            </div>
          )}

          {tab === 'shortcuts' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                {(Object.keys(localShortcuts) as Array<keyof ShortcutMap>).map((k) => (
                  <label
                    key={k}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      background: 'var(--bg-elevated)',
                      padding: '6px 10px',
                      borderRadius: 5,
                    }}
                  >
                    <span>{k}</span>
                    <input
                      type="text"
                      value={localShortcuts[k]}
                      onChange={(e) =>
                        setLocalShortcuts({ ...localShortcuts, [k]: e.target.value })
                      }
                      style={{ width: 120, fontFamily: 'var(--font-mono)' }}
                    />
                  </label>
                ))}
              </div>
              <div>
                <button
                  className="btn-primary"
                  onClick={() => onSaveShortcuts(localShortcuts)}
                >
                  Guardar Atajos Personalizados
                </button>
              </div>
            </div>
          )}

          {tab === 'versions' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {projectVersions.length === 0 ? (
                <div style={{ color: 'var(--text-muted)' }}>
                  Guarde el proyecto (.aspro) para generar historial de versiones restaurables.
                </div>
              ) : (
                projectVersions.map((v) => (
                  <div
                    key={v.versionId}
                    style={{
                      background: 'var(--bg-elevated)',
                      padding: 8,
                      borderRadius: 5,
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <div>
                      <strong>#{v.versionId} — {v.label}</strong>
                      <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                        {new Date(v.savedAt).toLocaleString()}
                      </div>
                    </div>
                    <button
                      className="btn-secondary"
                      onClick={() => onRestoreVersion(v.versionId)}
                    >
                      Restaurar esta versión
                    </button>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'logs' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {logs.length === 0 ? (
                <div style={{ color: 'var(--text-muted)' }}>Sin errores registrados.</div>
              ) : (
                logs.map((l, idx) => (
                  <div
                    key={idx}
                    style={{
                      background: 'var(--bg-elevated)',
                      padding: 7,
                      borderRadius: 4,
                      fontSize: 11,
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    [{l.createdAt}] ({l.context}) {l.message}
                  </div>
                ))
              )}
            </div>
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
