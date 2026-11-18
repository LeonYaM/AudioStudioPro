import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { VstPluginInfo, WindowsDriverInfo } from '../shared/types';

const execFileAsync = promisify(execFile);

/**
 * Queries Windows for real audio hardware drivers:
 * - WASAPI (native Windows Audio Session API via Chromium/WebAudio)
 * - ASIO (reads HKLM\SOFTWARE\ASIO registry keys for installed ASIO drivers)
 * - DirectSound (legacy Windows audio devices via Win32_SoundDevice)
 */
export async function inspectWindowsAudioDrivers(): Promise<{
  drivers: WindowsDriverInfo[];
  hardwareDevices: string[];
}> {
  const drivers: WindowsDriverInfo[] = [
    {
      api: 'WASAPI',
      name: 'Windows Audio Session API (WASAPI)',
      available: process.platform === 'win32',
      notes: 'Motor de baja latencia nativo de Windows activo mediante AudioWorklet/WebAudio.',
    },
  ];

  let hardwareDevices: string[] = [];
  let asioDrivers: string[] = [];

  if (process.platform === 'win32') {
    try {
      const psScript = `
        $devs = Get-CimInstance Win32_SoundDevice -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name;
        $asio = @();
        if (Test-Path 'HKLM:\\SOFTWARE\\ASIO') {
          $asio = Get-ChildItem 'HKLM:\\SOFTWARE\\ASIO' -ErrorAction SilentlyContinue | ForEach-Object { $_.PSChildName };
        }
        [PSCustomObject]@{ devices = @($devs); asio = @($asio) } | ConvertTo-Json -Compress
      `;
      const { stdout } = await execFileAsync('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        psScript,
      ]);
      const parsed = JSON.parse(stdout || '{}');
      if (Array.isArray(parsed.devices)) hardwareDevices = parsed.devices.filter(Boolean);
      else if (typeof parsed.devices === 'string') hardwareDevices = [parsed.devices];
      if (Array.isArray(parsed.asio)) asioDrivers = parsed.asio.filter(Boolean);
      else if (typeof parsed.asio === 'string') asioDrivers = [parsed.asio];
    } catch {
      // Non-fatal fallback
    }

    if (asioDrivers.length > 0) {
      for (const name of asioDrivers) {
        drivers.push({
          api: 'ASIO',
          name: `ASIO: ${name}`,
          available: true,
          notes: 'Controlador ASIO detectado en el registro de Windows (HKLM\\SOFTWARE\\ASIO).',
        });
      }
    } else {
      drivers.push({
        api: 'ASIO',
        name: 'ASIO (Sin controladores ASIO detectados)',
        available: false,
        notes:
          'No se encontraron controladores ASIO instalados en HKLM\\SOFTWARE\\ASIO. Instale ASIO4ALL o el driver de su interfaz; mientras tanto WASAPI está activo.',
      });
    }

    drivers.push({
      api: 'DirectSound',
      name: 'DirectSound (Compatibilidad Windows)',
      available: hardwareDevices.length > 0,
      notes: `${hardwareDevices.length} dispositivo(s) de sonido reportados por Windows.`,
    });
  }

  return { drivers, hardwareDevices };
}

/**
 * Scans real Windows VST3 & VST2 folders on disk (plus built-in Native DSP plugins).
 */
export function scanInstalledPlugins(extraFolders: string[] = []): VstPluginInfo[] {
  const plugins: VstPluginInfo[] = [
    {
      id: 'native-eq-param',
      name: 'ASP Parametric EQ (8 Bandas)',
      format: 'NativeDSP',
      path: 'internal://dsp/parametric-eq',
      vendor: 'AUDIO STUDIO PRO',
      enabled: true,
    },
    {
      id: 'native-dyn-comp',
      name: 'ASP Studio Compressor & Limiter',
      format: 'NativeDSP',
      path: 'internal://dsp/dynamics',
      vendor: 'AUDIO STUDIO PRO',
      enabled: true,
    },
    {
      id: 'native-multiband',
      name: 'ASP Multiband Mastering Dynamics',
      format: 'NativeDSP',
      path: 'internal://dsp/multiband',
      vendor: 'AUDIO STUDIO PRO',
      enabled: true,
    },
    {
      id: 'native-spectral-clean',
      name: 'ASP Spectral Noise & Hum Restorer',
      format: 'NativeDSP',
      path: 'internal://dsp/restoration',
      vendor: 'AUDIO STUDIO PRO',
      enabled: true,
    },
    {
      id: 'native-reverb-hall',
      name: 'ASP Schroeder Studio Reverb',
      format: 'NativeDSP',
      path: 'internal://dsp/reverb',
      vendor: 'AUDIO STUDIO PRO',
      enabled: true,
    },
  ];

  const defaultFolders = [
    'C:\\Program Files\\Common Files\\VST3',
    'C:\\Program Files (x86)\\Common Files\\VST3',
    'C:\\Program Files\\VSTPlugins',
    'C:\\Program Files\\Steinberg\\VSTPlugins',
    ...extraFolders,
  ];

  const seenPaths = new Set<string>();
  for (const folder of defaultFolders) {
    if (!folder || !fs.existsSync(folder)) continue;
    try {
      const entries = fs.readdirSync(folder, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(folder, entry.name);
        if (seenPaths.has(fullPath)) continue;
        if (entry.name.toLowerCase().endsWith('.vst3')) {
          seenPaths.add(fullPath);
          plugins.push({
            id: `vst3-${Buffer.from(fullPath).toString('base64url').slice(0, 16)}`,
            name: entry.name.replace(/\.vst3$/i, ''),
            format: 'VST3',
            path: fullPath,
            vendor: 'Externo (VST3 detectado)',
            enabled: false,
          });
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.dll') && folder.toLowerCase().includes('vst')) {
          seenPaths.add(fullPath);
          plugins.push({
            id: `vst2-${Buffer.from(fullPath).toString('base64url').slice(0, 16)}`,
            name: entry.name.replace(/\.dll$/i, ''),
            format: 'VST2',
            path: fullPath,
            vendor: 'Externo (VST2 detectado)',
            enabled: false,
          });
        }
      }
    } catch {
      // Skip unreadable directories
    }
  }

  return plugins;
}
