import fs from 'node:fs';
import { PcmAudioData } from '../audio/dsp/pcmBuffer';

export interface WavHeaderInfo {
  audioFormat: number;
  numChannels: number;
  sampleRate: number;
  bitDepth: number;
  dataOffset: number;
  dataSize: number;
  totalFrames: number;
}

/**
 * Parses a RIFF/WAVE header without loading the audio payload into memory.
 */
export function parseWavHeader(filePath: string): WavHeaderInfo {
  const fd = fs.openSync(filePath, 'r');
  try {
    const stat = fs.fstatSync(fd);
    const headerBuf = Buffer.alloc(Math.min(65536, stat.size));
    const bytesRead = fs.readSync(fd, headerBuf, 0, headerBuf.length, 0);
    if (bytesRead < 44) throw new Error('Archivo WAV inválido o demasiado pequeño');

    const riff = headerBuf.toString('ascii', 0, 4);
    const wave = headerBuf.toString('ascii', 8, 12);
    if (riff !== 'RIFF' || wave !== 'WAVE') {
      throw new Error('No es un archivo RIFF/WAVE válido');
    }

    let offset = 12;
    let audioFormat = 1;
    let numChannels = 2;
    let sampleRate = 48000;
    let bitDepth = 16;
    let dataOffset = 0;
    let dataSize = 0;

    while (offset + 8 <= bytesRead) {
      const chunkId = headerBuf.toString('ascii', offset, offset + 4);
      const chunkSize = headerBuf.readUInt32LE(offset + 4);
      if (chunkId === 'fmt ') {
        audioFormat = headerBuf.readUInt16LE(offset + 8);
        numChannels = headerBuf.readUInt16LE(offset + 10);
        sampleRate = headerBuf.readUInt32LE(offset + 12);
        bitDepth = headerBuf.readUInt16LE(offset + 22);
        if (audioFormat === 0xfffe && chunkSize >= 40) {
          audioFormat = headerBuf.readUInt16LE(offset + 32);
        }
      } else if (chunkId === 'data') {
        dataOffset = offset + 8;
        dataSize = Math.min(chunkSize, stat.size - dataOffset);
        break;
      }
      offset += 8 + chunkSize + (chunkSize % 2);
    }

    if (!dataOffset) throw new Error('Chunk data no encontrado en WAV');
    const bytesPerSample = Math.max(1, bitDepth / 8);
    const totalFrames = Math.floor(dataSize / (numChannels * bytesPerSample));

    return {
      audioFormat,
      numChannels,
      sampleRate,
      bitDepth,
      dataOffset,
      dataSize,
      totalFrames,
    };
  } finally {
    fs.closeSync(fd);
  }
}

function decodeSampleFromBuffer(
  buf: Buffer,
  pos: number,
  audioFormat: number,
  bitDepth: number
): number {
  if (audioFormat === 3 && bitDepth === 32) return buf.readFloatLE(pos);
  if (bitDepth === 16) return buf.readInt16LE(pos) / 32768;
  if (bitDepth === 24) {
    let raw = buf[pos] | (buf[pos + 1] << 8) | (buf[pos + 2] << 16);
    if (raw & 0x800000) raw |= ~0xffffff;
    return raw / 8388608;
  }
  if (bitDepth === 32) return buf.readInt32LE(pos) / 2147483648;
  if (bitDepth === 8) return (buf[pos] - 128) / 128;
  return 0;
}

/**
 * Streams a WAV file in bounded ~256 KB blocks to compute peak summary bins
 * without loading large files into RAM.
 */
export function computeWavPeakPyramid(
  filePath: string,
  targetBins = 1600
): { header: WavHeaderInfo; peaks: number[] } {
  const header = parseWavHeader(filePath);
  const { audioFormat, numChannels, bitDepth, dataOffset, totalFrames } = header;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const framesPerBin = Math.max(1, Math.ceil(totalFrames / targetBins));
  const chunkFrames = 16384; // ~128KB–384KB per disk read
  const readBuf = Buffer.alloc(chunkFrames * blockAlign);

  const peaks: number[] = [];
  const fd = fs.openSync(filePath, 'r');
  try {
    let frameCursor = 0;
    let binPeak = 0;
    let binFrames = 0;

    while (frameCursor < totalFrames) {
      const toRead = Math.min(chunkFrames, totalFrames - frameCursor);
      const bytePos = dataOffset + frameCursor * blockAlign;
      const bytesRead = fs.readSync(fd, readBuf, 0, toRead * blockAlign, bytePos);
      const framesRead = Math.floor(bytesRead / blockAlign);
      if (framesRead === 0) break;

      for (let i = 0; i < framesRead; i++) {
        let frameMax = 0;
        const base = i * blockAlign;
        for (let c = 0; c < numChannels; c++) {
          const v = Math.abs(
            decodeSampleFromBuffer(readBuf, base + c * bytesPerSample, audioFormat, bitDepth)
          );
          if (v > frameMax) frameMax = v;
        }
        if (frameMax > binPeak) binPeak = frameMax;
        binFrames++;
        if (binFrames >= framesPerBin) {
          peaks.push(Number(binPeak.toFixed(4)));
          binPeak = 0;
          binFrames = 0;
        }
      }
      frameCursor += framesRead;
    }
    if (binFrames > 0) peaks.push(Number(binPeak.toFixed(4)));
  } finally {
    fs.closeSync(fd);
  }

  return { header, peaks };
}

/**
 * Reads only a specific [startFrame, startFrame + frameCount) window from a WAV file on disk.
 */
export function readWavFrameWindow(
  filePath: string,
  startFrame: number,
  frameCount: number
): PcmAudioData {
  const header = parseWavHeader(filePath);
  const { audioFormat, numChannels, sampleRate, bitDepth, dataOffset, totalFrames } = header;
  const clampedStart = Math.max(0, Math.min(totalFrames, Math.floor(startFrame)));
  const clampedCount = Math.max(0, Math.min(totalFrames - clampedStart, Math.floor(frameCount)));
  const channels = Array.from({ length: numChannels }, () => new Float32Array(clampedCount));
  if (clampedCount === 0) return { sampleRate, channels };

  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const buf = Buffer.alloc(clampedCount * blockAlign);
  const fd = fs.openSync(filePath, 'r');
  try {
    fs.readSync(fd, buf, 0, buf.length, dataOffset + clampedStart * blockAlign);
    for (let i = 0; i < clampedCount; i++) {
      const base = i * blockAlign;
      for (let c = 0; c < numChannels; c++) {
        channels[c][i] = decodeSampleFromBuffer(
          buf,
          base + c * bytesPerSample,
          audioFormat,
          bitDepth
        );
      }
    }
  } finally {
    fs.closeSync(fd);
  }

  return { sampleRate, channels };
}
