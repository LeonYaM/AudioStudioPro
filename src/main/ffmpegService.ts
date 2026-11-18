import { app } from 'electron';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { ExportSettings } from '../shared/types';

const execFileAsync = promisify(execFile);

export interface ProbedMediaInfo {
  duration: number;
  sampleRate: number;
  channels: number;
  bitDepth: number;
  format: string;
  sizeBytes: number;
}

export function resolveBinaries(): { ffmpegPath: string; ffprobePath: string } {
  const isPackaged = app && app.isPackaged;
  if (isPackaged) {
    const binDir = path.join(process.resourcesPath, 'bin');
    return {
      ffmpegPath: path.join(binDir, 'ffmpeg.exe'),
      ffprobePath: path.join(binDir, 'ffprobe.exe'),
    };
  }
  // Dev / test resolution
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ffmpegStatic: string = require('ffmpeg-static');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ffprobeStatic: { path: string } = require('ffprobe-static');
  return {
    ffmpegPath: ffmpegStatic,
    ffprobePath: ffprobeStatic.path,
  };
}

export async function probeMediaFile(filePath: string): Promise<ProbedMediaInfo> {
  const { ffprobePath } = resolveBinaries();
  const stat = fs.statSync(filePath);
  const { stdout } = await execFileAsync(ffprobePath, [
    '-v',
    'quiet',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    '-select_streams',
    'a:0',
    filePath,
  ]);

  const parsed = JSON.parse(stdout);
  const stream = parsed.streams?.[0] ?? {};
  const format = parsed.format ?? {};

  const sampleRate = Number(stream.sample_rate) || 48000;
  const channels = Number(stream.channels) || 2;
  const duration = Number(format.duration || stream.duration) || 0;
  const bits = Number(stream.bits_per_raw_sample || stream.bits_per_sample) || 16;

  return {
    duration,
    sampleRate,
    channels,
    bitDepth: bits,
    format: (format.format_name || path.extname(filePath).replace('.', '') || 'unknown')
      .split(',')[0]
      .toUpperCase(),
    sizeBytes: stat.size,
  };
}

/**
 * Decodes any FFmpeg-supported audio file (WAV, MP3, FLAC, AIFF, OGG, M4A, AAC, WMA)
 * to a 32-bit float IEEE WAV file so the audio engine works at full precision.
 */
export async function decodeAudioToFloatWav(
  inputPath: string,
  outputWavPath: string,
  targetSampleRate?: number
): Promise<void> {
  const { ffmpegPath } = resolveBinaries();
  fs.mkdirSync(path.dirname(outputWavPath), { recursive: true });
  const args = ['-y', '-i', inputPath, '-vn', '-c:a', 'pcm_f32le'];
  if (targetSampleRate) {
    args.push('-ar', String(targetSampleRate));
  }
  args.push(outputWavPath);
  await execFileAsync(ffmpegPath, args, { maxBuffer: 1024 * 1024 * 16 });
}

export async function exportWavToFormat(
  sourceWavPath: string,
  settings: ExportSettings
): Promise<void> {
  const { ffmpegPath } = resolveBinaries();
  fs.mkdirSync(path.dirname(settings.outputPath), { recursive: true });

  const args: string[] = [
    '-y',
    '-i',
    sourceWavPath,
    '-ar',
    String(settings.sampleRate),
    '-ac',
    String(settings.channels),
  ];

  switch (settings.format) {
    case 'wav': {
      const codec =
        settings.bitDepth === 32
          ? 'pcm_f32le'
          : settings.bitDepth === 24
          ? 'pcm_s24le'
          : 'pcm_s16le';
      args.push('-c:a', codec);
      break;
    }
    case 'aiff': {
      const codec = settings.bitDepth === 24 ? 'pcm_s24be' : 'pcm_s16be';
      args.push('-c:a', codec);
      break;
    }
    case 'flac': {
      args.push('-c:a', 'flac', '-compression_level', '6');
      if (settings.bitDepth === 16) args.push('-sample_fmt', 's16');
      else args.push('-sample_fmt', 's32');
      break;
    }
    case 'mp3': {
      args.push('-c:a', 'libmp3lame', '-b:a', `${settings.bitrateKbps}k`);
      break;
    }
    case 'ogg': {
      args.push('-c:a', 'libvorbis', '-b:a', `${settings.bitrateKbps}k`);
      break;
    }
    case 'm4a': {
      args.push('-c:a', 'aac', '-b:a', `${settings.bitrateKbps}k`, '-movflags', '+faststart');
      break;
    }
  }

  args.push(settings.outputPath);
  await execFileAsync(ffmpegPath, args, { maxBuffer: 1024 * 1024 * 16 });
}
