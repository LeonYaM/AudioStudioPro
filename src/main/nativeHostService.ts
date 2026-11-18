import { app } from 'electron';
import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface NativeHostStatus {
  compiled: boolean;
  executablePath: string;
  running: boolean;
  notes: string;
}

/**
 * Manages the isolated out-of-process JUCE/C++ native host for ASIO & VST3 plugins.
 * If a third-party VST3 plugin crashes, only this child process terminates,
 * keeping AUDIO STUDIO PRO alive and responsive.
 */
export class NativeHostService {
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending: Array<{
    resolve: (v: Record<string, unknown>) => void;
    reject: (e: Error) => void;
  }> = [];
  private buffer = '';

  resolveExecutablePath(): string {
    const cwd = app?.getAppPath() ?? process.cwd();
    const candidates = [
      path.join(process.resourcesPath ?? '', 'bin', 'audio-studio-native-host.exe'),
      path.join(cwd, 'bin', 'audio-studio-native-host.exe'),
      path.join(cwd, 'native-audio-host', 'build', 'audio-studio-native-host_artefacts', 'Release', 'audio-studio-native-host.exe'),
      path.join(cwd, 'native-audio-host', 'build', 'Release', 'audio-studio-native-host.exe'),
      path.join(cwd, 'native-audio-host', 'build', 'bin', 'audio-studio-native-host.exe'),
    ];
    for (const c of candidates) {
      if (c && fs.existsSync(c)) return c;
    }
    return candidates[2];
  }

  getStatus(): NativeHostStatus {
    const exe = this.resolveExecutablePath();
    const compiled = fs.existsSync(exe);
    return {
      compiled,
      executablePath: exe,
      running: this.child !== null && !this.child.killed,
      notes: compiled
        ? 'Host nativo JUCE (ASIO/VST3 aislado) compilado y listo.'
        : 'Host nativo C++/JUCE aún no compilado en este equipo (requiere Visual Studio Build Tools + CMake).',
    };
  }

  private ensureStarted(): void {
    if (this.child && !this.child.killed) return;
    const exe = this.resolveExecutablePath();
    if (!fs.existsSync(exe)) {
      throw new Error(
        'Host nativo JUCE no compilado. Instale Visual Studio Build Tools + CMake y compile native-audio-host/.'
      );
    }
    this.child = spawn(exe, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdout.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString('utf8');
      let nl = this.buffer.indexOf('\n');
      while (nl !== -1) {
        const line = this.buffer.slice(0, nl).trim();
        this.buffer = this.buffer.slice(nl + 1);
        const waiter = this.pending.shift();
        if (waiter && line) {
          try {
            waiter.resolve(JSON.parse(line));
          } catch (err) {
            waiter.reject(err instanceof Error ? err : new Error(String(err)));
          }
        }
        nl = this.buffer.indexOf('\n');
      }
    });
    this.child.on('exit', () => {
      this.child = null;
      while (this.pending.length > 0) {
        this.pending.shift()?.reject(new Error('El proceso aislado VST3/ASIO se cerró inesperadamente.'));
      }
    });
  }

  sendCommand(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.ensureStarted();
    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject });
      this.child!.stdin.write(`${JSON.stringify(payload)}\n`);
    });
  }

  stop(): void {
    if (this.child && !this.child.killed) {
      this.child.kill();
      this.child = null;
    }
  }
}
