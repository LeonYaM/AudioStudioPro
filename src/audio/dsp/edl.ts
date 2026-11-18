import {
  PcmAudioData,
  applyGainPcm,
  fadePcm,
  getFrameCount,
  invertPhasePcm,
  joinPcm,
  reversePcm,
  silenceRangePcm,
} from './pcmBuffer';

/**
 * Lightweight, non-destructive Edit Decision List (EDL) for a waveform asset.
 * Stores segment references & transforms instead of duplicating Float32Array buffers
 * on every edit or Undo/Redo snapshot.
 */
export interface EdlSegment {
  id: string;
  sourceAssetId: string;
  sourceStartFrame: number;
  sourceEndFrame: number;
  gainDb: number;
  invertPhase: boolean;
  reversed: boolean;
  fadeInSec: number;
  fadeOutSec: number;
  isSilence?: boolean;
}

export interface WaveformEdl {
  sampleRate: number;
  channels: number;
  segments: EdlSegment[];
}

export function createInitialEdl(
  assetId: string,
  sampleRate: number,
  channels: number,
  totalFrames: number
): WaveformEdl {
  return {
    sampleRate,
    channels,
    segments: [
      {
        id: `seg-${Date.now()}`,
        sourceAssetId: assetId,
        sourceStartFrame: 0,
        sourceEndFrame: totalFrames,
        gainDb: 0,
        invertPhase: false,
        reversed: false,
        fadeInSec: 0,
        fadeOutSec: 0,
      },
    ],
  };
}

export function getEdlTotalFrames(edl: WaveformEdl): number {
  return edl.segments.reduce(
    (acc, s) => acc + Math.max(0, s.sourceEndFrame - s.sourceStartFrame),
    0
  );
}

/**
 * Splits EDL segments cleanly at `framePos` without touching source PCM data.
 */
export function splitEdlAtFrame(edl: WaveformEdl, framePos: number): WaveformEdl {
  const next: EdlSegment[] = [];
  let cursor = 0;
  for (const seg of edl.segments) {
    const len = Math.max(0, seg.sourceEndFrame - seg.sourceStartFrame);
    const segEnd = cursor + len;
    if (framePos > cursor && framePos < segEnd) {
      const localOffset = framePos - cursor;
      const splitSource = seg.reversed
        ? seg.sourceEndFrame - localOffset
        : seg.sourceStartFrame + localOffset;
      if (seg.reversed) {
        next.push({ ...seg, id: `${seg.id}-a`, sourceStartFrame: splitSource });
        next.push({ ...seg, id: `${seg.id}-b`, sourceEndFrame: splitSource });
      } else {
        next.push({ ...seg, id: `${seg.id}-a`, sourceEndFrame: splitSource });
        next.push({ ...seg, id: `${seg.id}-b`, sourceStartFrame: splitSource });
      }
    } else {
      next.push(seg);
    }
    cursor = segEnd;
  }
  return { ...edl, segments: next };
}

export function deleteEdlRange(
  edl: WaveformEdl,
  startSec: number,
  endSec: number
): { result: WaveformEdl; removed: WaveformEdl } {
  const startFrame = Math.max(0, Math.round(startSec * edl.sampleRate));
  const endFrame = Math.max(startFrame, Math.round(endSec * edl.sampleRate));
  const s1 = splitEdlAtFrame(edl, startFrame);
  const s2 = splitEdlAtFrame(s1, endFrame);

  const kept: EdlSegment[] = [];
  const removedSegs: EdlSegment[] = [];
  let cursor = 0;
  for (const seg of s2.segments) {
    const len = seg.sourceEndFrame - seg.sourceStartFrame;
    if (cursor >= startFrame && cursor + len <= endFrame) {
      removedSegs.push(seg);
    } else {
      kept.push(seg);
    }
    cursor += len;
  }
  return {
    result: { ...edl, segments: kept },
    removed: { ...edl, segments: removedSegs },
  };
}

export function insertEdlAt(
  target: WaveformEdl,
  clipboard: WaveformEdl,
  atSec: number
): WaveformEdl {
  const atFrame = Math.max(0, Math.round(atSec * target.sampleRate));
  const split = splitEdlAtFrame(target, atFrame);
  const out: EdlSegment[] = [];
  let cursor = 0;
  let inserted = false;
  for (const seg of split.segments) {
    if (!inserted && cursor === atFrame) {
      out.push(...clipboard.segments.map((c, i) => ({ ...c, id: `${c.id}-ins-${Date.now()}-${i}` })));
      inserted = true;
    }
    out.push(seg);
    cursor += seg.sourceEndFrame - seg.sourceStartFrame;
  }
  if (!inserted) {
    out.push(...clipboard.segments.map((c, i) => ({ ...c, id: `${c.id}-ins-${Date.now()}-${i}` })));
  }
  return { ...target, segments: out };
}

export function transformEdlRange(
  edl: WaveformEdl,
  startSec: number,
  endSec: number,
  transform: (seg: EdlSegment) => EdlSegment
): WaveformEdl {
  const startFrame = Math.max(0, Math.round(startSec * edl.sampleRate));
  const endFrame = Math.max(startFrame, Math.round(endSec * edl.sampleRate));
  const s1 = splitEdlAtFrame(edl, startFrame);
  const s2 = splitEdlAtFrame(s1, endFrame);

  let cursor = 0;
  const segments = s2.segments.map((seg) => {
    const len = seg.sourceEndFrame - seg.sourceStartFrame;
    const inside = cursor >= startFrame && cursor + len <= endFrame;
    cursor += len;
    return inside ? transform(seg) : seg;
  });
  return { ...edl, segments };
}

/**
 * Materializes a WaveformEdl into a Float32 PcmAudioData buffer on demand
 * from immutable original source assets.
 */
export function materializeEdl(
  edl: WaveformEdl,
  resolveSource: (assetId: string) => PcmAudioData | undefined
): PcmAudioData {
  if (edl.segments.length === 0) {
    return {
      sampleRate: edl.sampleRate,
      channels: Array.from({ length: edl.channels }, () => new Float32Array(0)),
    };
  }

  const parts: PcmAudioData[] = [];
  for (const seg of edl.segments) {
    const len = Math.max(0, seg.sourceEndFrame - seg.sourceStartFrame);
    if (len === 0) continue;
    if (seg.isSilence) {
      parts.push({
        sampleRate: edl.sampleRate,
        channels: Array.from({ length: edl.channels }, () => new Float32Array(len)),
      });
      continue;
    }
    const src = resolveSource(seg.sourceAssetId);
    if (!src) continue;
    const total = getFrameCount(src);
    const s = Math.max(0, Math.min(total, seg.sourceStartFrame));
    const e = Math.max(s, Math.min(total, seg.sourceEndFrame));
    let chunk: PcmAudioData = {
      sampleRate: src.sampleRate,
      channels: src.channels.map((ch) => ch.slice(s, e)),
    };
    if (seg.reversed) chunk = reversePcm(chunk);
    if (seg.invertPhase) chunk = invertPhasePcm(chunk);
    if (Math.abs(seg.gainDb) > 0.01) chunk = applyGainPcm(chunk, seg.gainDb);
    const dur = len / chunk.sampleRate;
    if (seg.fadeInSec > 0.001) chunk = fadePcm(chunk, 'in', 0, Math.min(dur, seg.fadeInSec));
    if (seg.fadeOutSec > 0.001) {
      chunk = fadePcm(chunk, 'out', Math.max(0, dur - seg.fadeOutSec), dur);
    }
    parts.push(chunk);
  }
  return parts.length > 0
    ? joinPcm(parts)
    : {
        sampleRate: edl.sampleRate,
        channels: Array.from({ length: edl.channels }, () => new Float32Array(0)),
      };
}

export function silenceEdlRange(
  edl: WaveformEdl,
  startSec: number,
  endSec: number
): WaveformEdl {
  return transformEdlRange(edl, startSec, endSec, (seg) => ({ ...seg, isSilence: true }));
}
void silenceRangePcm;
