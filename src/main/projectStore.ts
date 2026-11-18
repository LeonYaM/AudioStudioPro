import fs from 'node:fs';
import path from 'node:path';
import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import {
  DEFAULT_SHORTCUTS,
} from '../shared/presets';
import {
  RecentProjectEntry,
  ShortcutMap,
  StudioProject,
} from '../shared/types';

let sqlPromise: Promise<SqlJsStatic> | null = null;

function resolveWasmPath(): string {
  const candidates = [
    path.join(process.resourcesPath ?? '', 'bin', 'sql-wasm.wasm'),
    path.join(__dirname, '../../node_modules/sql.js/dist/sql-wasm.wasm'),
    path.join(process.cwd(), 'node_modules/sql.js/dist/sql-wasm.wasm'),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return candidates[candidates.length - 1];
}

async function getSql(): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    const wasmPath = resolveWasmPath();
    sqlPromise = initSqlJs({
      locateFile: () => wasmPath,
    });
  }
  return sqlPromise;
}

function saveDbAtomic(db: Database, filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const data = db.export();
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, Buffer.from(data));
  fs.renameSync(tmpPath, filePath);
}

/**
 * Global application SQLite database (recent projects, preferences, shortcuts, error logs).
 */
export class AppConfigStore {
  private db: Database | null = null;
  constructor(private readonly dbPath: string) {}

  async init(): Promise<void> {
    if (this.db) return;
    const SQL = await getSql();
    if (fs.existsSync(this.dbPath)) {
      const buf = fs.readFileSync(this.dbPath);
      this.db = new SQL.Database(buf);
    } else {
      this.db = new SQL.Database();
    }

    this.db.run(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS recent_projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sample_rate INTEGER NOT NULL,
        track_count INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS error_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        context TEXT NOT NULL,
        message TEXT NOT NULL
      );
    `);
    saveDbAtomic(this.db, this.dbPath);
  }

  private ensureDb(): Database {
    if (!this.db) throw new Error('AppConfigStore not initialized');
    return this.db;
  }

  getSetting<T>(key: string, fallback: T): T {
    const db = this.ensureDb();
    const stmt = db.prepare('SELECT value FROM settings WHERE key = ?');
    stmt.bind([key]);
    let result = fallback;
    if (stmt.step()) {
      const row = stmt.getAsObject();
      try {
        result = JSON.parse(String(row.value)) as T;
      } catch {
        result = fallback;
      }
    }
    stmt.free();
    return result;
  }

  setSetting<T>(key: string, value: T): void {
    const db = this.ensureDb();
    db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [
      key,
      JSON.stringify(value),
    ]);
    saveDbAtomic(db, this.dbPath);
  }

  getShortcuts(): ShortcutMap {
    return this.getSetting<ShortcutMap>('shortcuts', DEFAULT_SHORTCUTS);
  }

  setShortcuts(map: ShortcutMap): void {
    this.setSetting('shortcuts', map);
  }

  upsertRecentProject(entry: RecentProjectEntry): void {
    const db = this.ensureDb();
    db.run(
      `INSERT OR REPLACE INTO recent_projects (id, name, file_path, updated_at, sample_rate, track_count)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        entry.id,
        entry.name,
        entry.filePath,
        entry.updatedAt,
        entry.sampleRate,
        entry.trackCount,
      ]
    );
    saveDbAtomic(db, this.dbPath);
  }

  getRecentProjects(limit = 15): RecentProjectEntry[] {
    const db = this.ensureDb();
    const stmt = db.prepare(
      'SELECT id, name, file_path, updated_at, sample_rate, track_count FROM recent_projects ORDER BY updated_at DESC LIMIT ?'
    );
    stmt.bind([limit]);
    const list: RecentProjectEntry[] = [];
    while (stmt.step()) {
      const r = stmt.getAsObject();
      list.push({
        id: String(r.id),
        name: String(r.name),
        filePath: String(r.file_path),
        updatedAt: String(r.updated_at),
        sampleRate: Number(r.sample_rate),
        trackCount: Number(r.track_count),
      });
    }
    stmt.free();
    return list;
  }

  logError(context: string, message: string): void {
    if (!this.db) return;
    this.db.run(
      'INSERT INTO error_logs (created_at, context, message) VALUES (?, ?, ?)',
      [new Date().toISOString(), context, message]
    );
    saveDbAtomic(this.db, this.dbPath);
  }

  getErrorLogs(limit = 50): Array<{ createdAt: string; context: string; message: string }> {
    const db = this.ensureDb();
    const stmt = db.prepare(
      'SELECT created_at, context, message FROM error_logs ORDER BY id DESC LIMIT ?'
    );
    stmt.bind([limit]);
    const out: Array<{ createdAt: string; context: string; message: string }> = [];
    while (stmt.step()) {
      const r = stmt.getAsObject();
      out.push({
        createdAt: String(r.created_at),
        context: String(r.context),
        message: String(r.message),
      });
    }
    stmt.free();
    return out;
  }
}

/**
 * Copies all project audio assets into `<projectDir>/Media/` and sets `relativeMediaPath`
 * so the project folder is 100% self-contained and portable.
 */
export function consolidateProjectMedia(
  project: StudioProject,
  projectFilePath: string
): StudioProject {
  const projectDir = path.dirname(projectFilePath);
  const mediaDir = path.join(projectDir, 'Media');
  fs.mkdirSync(mediaDir, { recursive: true });

  const updatedAssets = project.assets.map((asset) => {
    const srcPath =
      asset.cachedWavPath && fs.existsSync(asset.cachedWavPath)
        ? asset.cachedWavPath
        : asset.originalPath && fs.existsSync(asset.originalPath)
        ? asset.originalPath
        : null;
    if (!srcPath) return asset;

    const safeName = asset.name.replace(/[<>:"/\\|?*]/g, '_');
    const ext = path.extname(srcPath) || '.wav';
    const base = path.basename(safeName, path.extname(safeName));
    const destName = `${asset.id}_${base}${ext}`;
    const destAbs = path.join(mediaDir, destName);
    if (path.resolve(srcPath) !== path.resolve(destAbs)) {
      fs.copyFileSync(srcPath, destAbs);
    }
    return {
      ...asset,
      cachedWavPath: destAbs,
      relativeMediaPath: path.join('Media', destName),
    };
  });

  return {
    ...project,
    assets: updatedAssets,
  };
}

/**
 * Creates a rotating timestamped backup in `<projectDir>/Backups/` (retaining the latest 10).
 */
export function createProjectBackup(projectFilePath: string): void {
  if (!fs.existsSync(projectFilePath)) return;
  const projectDir = path.dirname(projectFilePath);
  const backupDir = path.join(projectDir, 'Backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const base = path.basename(projectFilePath, '.aspro');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `${base}_${stamp}.bak.aspro`);
  fs.copyFileSync(projectFilePath, backupPath);

  const backups = fs
    .readdirSync(backupDir)
    .filter((f) => f.endsWith('.bak.aspro'))
    .sort()
    .reverse();
  for (const old of backups.slice(10)) {
    fs.unlinkSync(path.join(backupDir, old));
  }
}

/**
 * Saves a StudioProject into a self-contained SQLite project file (.aspro)
 * including metadata, assets manifest, tracks, clips, automation, and version history.
 */
export async function saveProjectSqlite(
  project: StudioProject,
  filePath: string,
  versionLabel = 'Guardado manual'
): Promise<void> {
  const SQL = await getSql();
  let db: Database;
  if (fs.existsSync(filePath)) {
    db = new SQL.Database(fs.readFileSync(filePath));
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS project_meta (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sample_rate INTEGER NOT NULL,
      bit_depth INTEGER NOT NULL,
      bpm REAL NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS project_versions (
      version_id INTEGER PRIMARY KEY AUTOINCREMENT,
      saved_at TEXT NOT NULL,
      label TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
  `);

  const updated: StudioProject = {
    ...project,
    filePath,
    updatedAt: new Date().toISOString(),
  };
  const json = JSON.stringify(updated);

  db.run(
    `INSERT OR REPLACE INTO project_meta (id, name, updated_at, sample_rate, bit_depth, bpm, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      updated.id,
      updated.name,
      updated.updatedAt,
      updated.sampleRate,
      updated.bitDepth,
      updated.bpm,
      json,
    ]
  );

  db.run(
    'INSERT INTO project_versions (saved_at, label, payload_json) VALUES (?, ?, ?)',
    [updated.updatedAt, versionLabel, json]
  );

  // Retain last 25 versions inside the project database to keep size bounded
  db.run(
    `DELETE FROM project_versions WHERE version_id NOT IN (
      SELECT version_id FROM project_versions ORDER BY version_id DESC LIMIT 25
    )`
  );

  saveDbAtomic(db, filePath);
  db.close();
}

export async function loadProjectSqlite(filePath: string): Promise<{
  project: StudioProject;
  versions: Array<{ versionId: number; savedAt: string; label: string }>;
}> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`El archivo de proyecto no existe: ${filePath}`);
  }
  const SQL = await getSql();
  const db = new SQL.Database(fs.readFileSync(filePath));

  const metaStmt = db.prepare('SELECT payload_json FROM project_meta LIMIT 1');
  if (!metaStmt.step()) {
    metaStmt.free();
    db.close();
    throw new Error('Archivo de proyecto inválido o corrupto');
  }
  const payload = String(metaStmt.getAsObject().payload_json);
  metaStmt.free();

  const project = JSON.parse(payload) as StudioProject;
  project.filePath = filePath;
  const projectDir = path.dirname(filePath);
  project.assets = project.assets.map((asset) => {
    if (asset.relativeMediaPath) {
      const relAbs = path.join(projectDir, asset.relativeMediaPath);
      if (fs.existsSync(relAbs) && (!asset.cachedWavPath || !fs.existsSync(asset.cachedWavPath))) {
        return { ...asset, cachedWavPath: relAbs };
      }
    }
    return asset;
  });

  const verStmt = db.prepare(
    'SELECT version_id, saved_at, label FROM project_versions ORDER BY version_id DESC'
  );
  const versions: Array<{ versionId: number; savedAt: string; label: string }> = [];
  while (verStmt.step()) {
    const r = verStmt.getAsObject();
    versions.push({
      versionId: Number(r.version_id),
      savedAt: String(r.saved_at),
      label: String(r.label),
    });
  }
  verStmt.free();
  db.close();

  return { project, versions };
}

export async function restoreProjectVersionSqlite(
  filePath: string,
  versionId: number
): Promise<StudioProject> {
  const SQL = await getSql();
  const db = new SQL.Database(fs.readFileSync(filePath));
  const stmt = db.prepare('SELECT payload_json FROM project_versions WHERE version_id = ?');
  stmt.bind([versionId]);
  if (!stmt.step()) {
    stmt.free();
    db.close();
    throw new Error(`Versión ${versionId} no encontrada`);
  }
  const project = JSON.parse(String(stmt.getAsObject().payload_json)) as StudioProject;
  project.filePath = filePath;
  stmt.free();
  db.close();
  return project;
}
