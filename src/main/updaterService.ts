import { app, BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';

export interface UpdateCheckResult {
  status: 'dev-mode' | 'checking' | 'available' | 'up-to-date' | 'error';
  version?: string;
  message: string;
}

export function initAutoUpdater(getWindow: () => BrowserWindow | null): void {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  const send = (channel: string, payload?: unknown) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  };

  autoUpdater.on('update-available', (info) => {
    send('updater:event', { type: 'available', version: info.version });
  });

  autoUpdater.on('update-not-available', (info) => {
    send('updater:event', { type: 'up-to-date', version: info.version });
  });

  autoUpdater.on('download-progress', (progress) => {
    send('updater:event', {
      type: 'progress',
      percent: Math.round(progress.percent),
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    send('updater:event', { type: 'downloaded', version: info.version });
  });

  autoUpdater.on('error', (err) => {
    send('updater:event', {
      type: 'error',
      message: err?.message || String(err),
    });
  });
}

export async function checkForAppUpdates(): Promise<UpdateCheckResult> {
  if (!app.isPackaged) {
    return {
      status: 'dev-mode',
      version: app.getVersion(),
      message: `Modo desarrollo (v${app.getVersion()}). La comprobación de actualizaciones se activa en el ejecutable instalado.`,
    };
  }
  try {
    const res = await autoUpdater.checkForUpdates();
    if (res && res.updateInfo && res.updateInfo.version !== app.getVersion()) {
      return {
        status: 'available',
        version: res.updateInfo.version,
        message: `Nueva versión disponible: v${res.updateInfo.version}`,
      };
    }
    return {
      status: 'up-to-date',
      version: app.getVersion(),
      message: `AUDIO STUDIO PRO está actualizado (v${app.getVersion()}).`,
    };
  } catch (err) {
    return {
      status: 'error',
      version: app.getVersion(),
      message: `No se pudo conectar al servidor de actualizaciones: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
}

export async function downloadAppUpdate(): Promise<void> {
  if (!app.isPackaged) return;
  await autoUpdater.downloadUpdate();
}

export function installAppUpdate(): void {
  if (!app.isPackaged) return;
  autoUpdater.quitAndInstall();
}
