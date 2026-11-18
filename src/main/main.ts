import { app, BrowserWindow, dialog, ipcMain, session } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ExportSettings, ShortcutMap, StudioProject } from '../shared/types';
import { inspectWindowsAudioDrivers, scanInstalledPlugins } from './audioDeviceService';
import {
  decodeAudioToFloatWav,
  exportWavToFormat,
  probeMediaFile,
} from './ffmpegService';
import {
  AppConfigStore,
  consolidateProjectMedia,
  createProjectBackup,
  loadProjectSqlite,
  restoreProjectVersionSqlite,
  saveProjectSqlite,
} from './projectStore';
import { NativeHostService } from './nativeHostService';
import {
  importOnnxModel,
  inspectOnnxModel,
  listOnnxModels,
  runOnnxWaveformModel,
} from './onnxAiService';
import {
  checkForAppUpdates,
  downloadAppUpdate,
  initAutoUpdater,
  installAppUpdate,
} from './updaterService';
import { computeWavPeakPyramid, readWavFrameWindow } from './wavStreamService';

let mainWindow: BrowserWindow | null = null;
let configStore: AppConfigStore;
let pendingInitialFile: string | null = null;
const nativeHost = new NativeHostService();
const authorizedRoots = new Set<string>();
const authorizedFiles = new Set<string>();

function parseAsproFromArgs(args: string[]): string | null {
  for (const arg of args) {
    if (typeof arg === 'string' && arg.toLowerCase().endsWith('.aspro')) {
      const resolved = path.resolve(arg);
      if (fs.existsSync(resolved)) {
        return resolved;
      }
    }
  }
  return null;
}

function authorizePath(p: string, isDir = false): void {
  const resolved = path.resolve(p);
  if (isDir) authorizedRoots.add(resolved);
  else {
    authorizedFiles.add(resolved);
    authorizedRoots.add(path.dirname(resolved));
  }
}

function isPathAuthorized(targetPath: string): boolean {
  const resolved = path.resolve(targetPath);
  if (authorizedFiles.has(resolved)) return true;
  const defaults = [app.getPath('userData'), app.getPath('temp')].map((d) => path.resolve(d));
  for (const root of [...defaults, ...authorizedRoots]) {
    const rel = path.relative(root, resolved);
    if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) return true;
  }
  return false;
}

function getCacheDir(projectId: string): string {
  const dir = path.join(app.getPath('userData'), 'media-cache', projectId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getRecoveryPath(): string {
  return path.join(app.getPath('userData'), 'autosave-recovery.aspro');
}

function createWindow(): void {
  const iconPath = path.join(__dirname, '../../build/icon.ico');
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1120,
    minHeight: 700,
    backgroundColor: '#181a1f',
    title: 'AUDIO STUDIO PRO',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (!app.isPackaged && process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function registerIpcHandlers(): void {
  ipcMain.handle('dialog:openAudioFiles', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Importar archivos de audio',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Archivos de audio',
          extensions: ['wav', 'mp3', 'flac', 'aiff', 'aif', 'ogg', 'm4a', 'aac', 'wma'],
        },
        { name: 'Todos los archivos', extensions: ['*'] },
      ],
    });
      const files = res.canceled ? [] : res.filePaths;
      files.forEach((f) => authorizePath(f));
      return files;
  });

  ipcMain.handle('dialog:openFolder', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Seleccionar carpeta',
      properties: ['openDirectory'],
    });
    return res.canceled ? null : res.filePaths[0] ?? null;
  });

  ipcMain.handle('dialog:saveProject', async (_e, defaultName: string) => {
    const res = await dialog.showSaveDialog({
      title: 'Guardar proyecto de AUDIO STUDIO PRO',
      defaultPath: `${defaultName || 'Proyecto'}.aspro`,
      filters: [{ name: 'Proyecto AUDIO STUDIO PRO', extensions: ['aspro'] }],
    });
    return res.canceled ? null : res.filePath ?? null;
  });

  ipcMain.handle('dialog:openProject', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Abrir proyecto de AUDIO STUDIO PRO',
      properties: ['openFile'],
      filters: [{ name: 'Proyecto AUDIO STUDIO PRO', extensions: ['aspro'] }],
    });
    return res.canceled ? null : res.filePaths[0] ?? null;
  });

  ipcMain.handle('dialog:exportAudio', async (_e, defaultName: string, format: string) => {
    const ext = format.toLowerCase();
    const res = await dialog.showSaveDialog({
      title: 'Exportar audio',
      defaultPath: `${defaultName || 'Exportacion'}.${ext}`,
      filters: [{ name: `Audio ${ext.toUpperCase()}`, extensions: [ext] }],
    });
    return res.canceled ? null : res.filePath ?? null;
  });

  ipcMain.handle(
    'audio:import',
    async (_e, filePath: string, projectId: string, targetSampleRate?: number) => {
      if (!fs.existsSync(filePath)) {
        throw new Error(`El archivo no existe: ${filePath}`);
      }
      const info = await probeMediaFile(filePath);
      const hash = crypto
        .createHash('sha1')
        .update(`${filePath}:${targetSampleRate ?? info.sampleRate}`)
        .digest('hex')
        .slice(0, 12);
      const base = path.basename(filePath, path.extname(filePath));
      const cachedWavPath = path.join(getCacheDir(projectId), `${base}-${hash}.wav`);
      await decodeAudioToFloatWav(filePath, cachedWavPath, targetSampleRate);
      return {
        originalPath: filePath,
        cachedWavPath,
        name: path.basename(filePath),
        info,
      };
    }
  );

  ipcMain.handle('fs:readBinary', async (_e, filePath: string) => {
    if (!isPathAuthorized(filePath)) {
      throw new Error(`Acceso denegado a ruta no autorizada: ${filePath}`);
    }
    const buf = fs.readFileSync(filePath);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  });

  ipcMain.handle('fs:writeBinary', async (_e, filePath: string, data: Uint8Array) => {
    if (!isPathAuthorized(filePath)) {
      throw new Error(`Escritura denegada a ruta no autorizada: ${filePath}`);
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, Buffer.from(data));
  });

  ipcMain.handle('fs:getCachePath', async (_e, projectId: string, filename: string) => {
    return path.join(getCacheDir(projectId), filename);
  });

  ipcMain.handle(
    'audio:export',
    async (_e, sourceWavBytes: Uint8Array, settings: ExportSettings) => {
      const tmpWav = path.join(
        app.getPath('temp'),
        `asp-export-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.wav`
      );
      try {
        fs.writeFileSync(tmpWav, Buffer.from(sourceWavBytes));
        await exportWavToFormat(tmpWav, settings);
      } finally {
        if (fs.existsSync(tmpWav)) fs.unlinkSync(tmpWav);
      }
    }
  );

  ipcMain.handle(
    'project:save',
    async (_e, project: StudioProject, filePath: string, label?: string) => {
      createProjectBackup(filePath);
      await saveProjectSqlite(project, filePath, label ?? 'Guardado manual');
      configStore.upsertRecentProject({
        id: project.id,
        name: project.name,
        filePath,
        updatedAt: new Date().toISOString(),
        sampleRate: project.sampleRate,
        trackCount: project.tracks.length,
      });
    }
  );

  ipcMain.handle(
    'project:consolidateAndSave',
    async (_e, project: StudioProject, filePath: string) => {
      createProjectBackup(filePath);
      const consolidated = consolidateProjectMedia(project, filePath);
      await saveProjectSqlite(consolidated, filePath, 'Sesión autocontenida');
      configStore.upsertRecentProject({
        id: consolidated.id,
        name: consolidated.name,
        filePath,
        updatedAt: new Date().toISOString(),
        sampleRate: consolidated.sampleRate,
        trackCount: consolidated.tracks.length,
      });
      return consolidated;
    }
  );

  ipcMain.handle('wav:computePeaks', async (_e, filePath: string, targetBins?: number) => {
    return computeWavPeakPyramid(filePath, targetBins ?? 1600);
  });

  ipcMain.handle(
    'wav:readWindow',
    async (_e, filePath: string, startFrame: number, frameCount: number) => {
      return readWavFrameWindow(filePath, startFrame, frameCount);
    }
  );

  ipcMain.handle('project:autosave', async (_e, project: StudioProject) => {
    const recPath = getRecoveryPath();
    await saveProjectSqlite(project, recPath, 'Autoguardado');
    return recPath;
  });

  ipcMain.handle('project:checkRecovery', async () => {
    const recPath = getRecoveryPath();
    if (!fs.existsSync(recPath)) return null;
    try {
      const { project } = await loadProjectSqlite(recPath);
      return project;
    } catch {
      return null;
    }
  });

  ipcMain.handle('project:clearRecovery', async () => {
    const recPath = getRecoveryPath();
    if (fs.existsSync(recPath)) fs.unlinkSync(recPath);
  });

  ipcMain.handle('project:load', async (_e, filePath: string) => {
    authorizePath(filePath);
    const res = await loadProjectSqlite(filePath);
    configStore.upsertRecentProject({
      id: res.project.id,
      name: res.project.name,
      filePath,
      updatedAt: res.project.updatedAt,
      sampleRate: res.project.sampleRate,
      trackCount: res.project.tracks.length,
    });
    return res;
  });

  ipcMain.handle(
    'project:restoreVersion',
    async (_e, filePath: string, versionId: number) => {
      return restoreProjectVersionSqlite(filePath, versionId);
    }
  );

  ipcMain.handle('project:recent', async () => {
    return configStore.getRecentProjects();
  });

  ipcMain.handle('settings:getShortcuts', async () => {
    return configStore.getShortcuts();
  });

  ipcMain.handle('settings:setShortcuts', async (_e, map: ShortcutMap) => {
    configStore.setShortcuts(map);
  });

  ipcMain.handle('settings:get', async (_e, key: string, fallback: unknown) => {
    return configStore.getSetting(key, fallback);
  });

  ipcMain.handle('settings:set', async (_e, key: string, value: unknown) => {
    configStore.setSetting(key, value);
  });

  ipcMain.handle('audio:inspectDrivers', async () => {
    return inspectWindowsAudioDrivers();
  });

  ipcMain.handle('plugins:scan', async (_e, extraFolders?: string[]) => {
    return scanInstalledPlugins(extraFolders ?? []);
  });

  ipcMain.handle('logs:error', async (_e, context: string, message: string) => {
    configStore.logError(context, message);
  });

  ipcMain.handle('logs:get', async () => {
    return configStore.getErrorLogs();
  });

  ipcMain.handle('nativeHost:status', async () => {
    return nativeHost.getStatus();
  });

  ipcMain.handle('nativeHost:listDevices', async () => {
    return nativeHost.sendCommand({ cmd: 'list-devices' });
  });

  ipcMain.handle(
    'nativeHost:processVst3',
    async (_e, pluginPath: string, inputWav: string, outputWav: string) => {
      return nativeHost.sendCommand({ cmd: 'process-vst3', pluginPath, inputWav, outputWav });
    }
  );

  const modelsDir = path.join(app.getPath('userData'), 'models');

  ipcMain.handle('onnx:listModels', async () => {
    return listOnnxModels(modelsDir);
  });

  ipcMain.handle('onnx:importModel', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Importar modelo ONNX local (RNNoise / DeepFilterNet / Demucs)',
      properties: ['openFile'],
      filters: [{ name: 'Modelo ONNX', extensions: ['onnx'] }],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    const imported = importOnnxModel(res.filePaths[0], modelsDir);
    authorizePath(imported.filePath);
    return imported;
  });

  ipcMain.handle('onnx:inspectModel', async (_e, modelPath: string) => {
    authorizePath(modelPath);
    return inspectOnnxModel(modelPath);
  });

  ipcMain.handle(
    'onnx:runWaveform',
    async (_e, modelPath: string, samples: Float32Array) => {
      authorizePath(modelPath);
      return runOnnxWaveformModel(modelPath, samples);
    }
  );

  ipcMain.handle('app:getInitialFile', async () => {
    const file = pendingInitialFile;
    pendingInitialFile = null;
    return file;
  });

  ipcMain.handle('updater:check', async () => checkForAppUpdates());
  ipcMain.handle('updater:download', async () => downloadAppUpdate());
  ipcMain.handle('updater:install', () => installAppUpdate());
}

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      const asproPath = parseAsproFromArgs(commandLine);
      if (asproPath) {
        authorizePath(asproPath);
        mainWindow.webContents.send('project:openFile', asproPath);
      }
    }
  });

  app.whenReady().then(async () => {
    const initialArgFile = parseAsproFromArgs(process.argv);
    if (initialArgFile) {
      authorizePath(initialArgFile);
      pendingInitialFile = initialArgFile;
    }

    configStore = new AppConfigStore(path.join(app.getPath('userData'), 'audiostudio.sqlite'));
    await configStore.init();

    // Grant audio input capture ONLY for the app's own local origin
    session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
      const url = wc.getURL();
      const isOwnOrigin = url.startsWith('file://') || url.startsWith('http://localhost:5173');
      if (permission === 'media' && isOwnOrigin) {
        callback(true);
      } else {
        callback(false);
      }
    });

    registerIpcHandlers();
    initAutoUpdater(() => mainWindow);
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('will-quit', () => {
  nativeHost.stop();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
