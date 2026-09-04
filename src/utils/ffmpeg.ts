/**
 * ffmpeg helpers for frame extraction.
 *
 * ffmpeg is an optional system dependency: it is only required by the
 * extract_video_frame tool. The binary is resolved from FFMPEG_PATH or PATH.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { VisionError } from '../types/Errors.js';

const execFileAsync = promisify(execFile);

const EXTRACT_TIMEOUT_MS = 60000;

let cachedFfmpegPath: string | null | undefined;

export async function resolveFfmpegPath(): Promise<string> {
  if (cachedFfmpegPath !== undefined) {
    if (cachedFfmpegPath === null) {
      throw ffmpegMissingError();
    }
    return cachedFfmpegPath;
  }

  const candidate = process.env.FFMPEG_PATH || 'ffmpeg';
  try {
    await execFileAsync(candidate, ['-version'], { timeout: 10000 });
    cachedFfmpegPath = candidate;
    return candidate;
  } catch {
    cachedFfmpegPath = null;
    throw ffmpegMissingError();
  }
}

function ffmpegMissingError(): VisionError {
  return new VisionError(
    'ffmpeg not found. Install it (e.g. "brew install ffmpeg") or set FFMPEG_PATH to the binary. ffmpeg is only required for extract_video_frame.',
    'FFMPEG_NOT_FOUND'
  );
}

/**
 * Parse a timestamp like "90", "01:30", "1:02:03" or "12.5" into seconds.
 */
export function parseTimestampToSeconds(timestamp: string): number {
  const trimmed = timestamp.trim().replace(/s$/i, '');
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return parseFloat(trimmed);
  }

  const parts = trimmed.split(':').map(p => parseFloat(p));
  if (parts.some(p => isNaN(p) || p < 0)) {
    throw new VisionError(
      `Invalid timestamp "${timestamp}". Use seconds ("75", "12.5") or clock format ("MM:SS", "H:MM:SS").`,
      'INVALID_ARGUMENT'
    );
  }

  return parts.reduce((total, part) => total * 60 + part, 0);
}

export function formatSecondsAsClock(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const [intPart, decPart] = s
    .toFixed(3)
    .replace(/\.?0+$/, '')
    .split('.');
  const secStr = intPart.padStart(2, '0') + (decPart ? `.${decPart}` : '');
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${secStr}`
    : `${String(m).padStart(2, '0')}:${secStr}`;
}

async function makeOutputDir(outputDir?: string): Promise<string> {
  if (outputDir) {
    await fs.mkdir(outputDir, { recursive: true });
    return outputDir;
  }
  return fs.mkdtemp(path.join(os.tmpdir(), 'ai-vision-frames-'));
}

export interface ExtractedFrame {
  timestamp: string; // clock format for prompt reuse (MM:SS or H:MM:SS)
  seconds: number;
  path: string;
}

/**
 * Extract a single frame per timestamp using fast seek (-ss before -i).
 */
export async function extractFramesAtTimestamps(
  videoPath: string,
  timestamps: string[],
  outputDir?: string
): Promise<ExtractedFrame[]> {
  const ffmpeg = await resolveFfmpegPath();
  const dir = await makeOutputDir(outputDir);
  const frames: ExtractedFrame[] = [];

  for (const timestamp of timestamps) {
    const seconds = parseTimestampToSeconds(timestamp);
    const filename = `frame-${seconds.toFixed(3).replace('.', '_')}s-${crypto
      .randomBytes(4)
      .toString('hex')}.png`;
    const outPath = path.join(dir, filename);

    try {
      await execFileAsync(
        ffmpeg,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-ss',
          String(seconds),
          '-i',
          videoPath,
          '-frames:v',
          '1',
          '-y',
          outPath,
        ],
        { timeout: EXTRACT_TIMEOUT_MS }
      );
    } catch (error) {
      throw new VisionError(
        `ffmpeg failed to extract frame at ${timestamp}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        'FFMPEG_ERROR'
      );
    }

    // ffmpeg exits 0 even when seeking past the end; verify output exists
    try {
      const stat = await fs.stat(outPath);
      if (stat.size === 0) throw new Error('empty file');
    } catch {
      throw new VisionError(
        `No frame at ${timestamp}; the timestamp is probably past the end of the video`,
        'INVALID_ARGUMENT'
      );
    }

    frames.push({
      timestamp: formatSecondsAsClock(seconds),
      seconds,
      path: outPath,
    });
  }

  return frames;
}

export interface VideoProbeInfo {
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
}

/** Probe basic video properties via ffprobe (best effort). */
export async function probeVideo(
  videoPath: string
): Promise<VideoProbeInfo | null> {
  const ffmpeg = await resolveFfmpegPath();
  const ffprobe = ffmpeg.replace(/ffmpeg([^/\\]*)$/, 'ffprobe$1');
  try {
    const { stdout } = await execFileAsync(
      ffprobe,
      [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=width,height,r_frame_rate',
        '-show_entries',
        'format=duration',
        '-of',
        'json',
        videoPath,
      ],
      { timeout: 30000 }
    );
    const parsed = JSON.parse(stdout);
    const stream = parsed.streams?.[0];
    if (!stream) return null;
    const [num, den] = String(stream.r_frame_rate || '30/1').split('/');
    const fps = parseFloat(den) > 0 ? parseFloat(num) / parseFloat(den) : 30;
    return {
      width: stream.width || 0,
      height: stream.height || 0,
      fps,
      durationSeconds: parseFloat(parsed.format?.duration || '0'),
    };
  } catch {
    return null;
  }
}

export interface NormalizeVideoOptions {
  maxDimension?: number; // default 1280
  maxFps?: number; // default 10
  timeoutMs?: number; // default 600000
}

export interface NormalizedVideo {
  path: string;
  cleanup: () => Promise<void>;
}

/**
 * Normalize a pathological video for the Gemini API: downscale, cap the
 * frame rate, and re-encode as faststart H.264/AAC. The API samples video
 * at ~1 FPS and downscales frames internally, so oversized screen
 * recordings (e.g. 240fps Retina captures) upload 10-40x more bytes than
 * the model ever looks at. Returns null when ffmpeg is unavailable.
 */
export async function normalizeVideoForUpload(
  videoPath: string,
  options: NormalizeVideoOptions = {}
): Promise<NormalizedVideo | null> {
  let ffmpeg: string;
  try {
    ffmpeg = await resolveFfmpegPath();
  } catch {
    return null; // ffmpeg not installed: caller keeps the original file
  }

  const maxDimension = options.maxDimension ?? 1280;
  const maxFps = options.maxFps ?? 10;

  const info = await probeVideo(videoPath);
  const filters: string[] = [];
  if (info && Math.max(info.width, info.height) > maxDimension) {
    filters.push(
      `scale=w=${maxDimension}:h=${maxDimension}:force_original_aspect_ratio=decrease:force_divisible_by=2`
    );
  }
  const fpsArgs: string[] = [];
  if (!info || info.fps > maxFps) {
    fpsArgs.push('-r', String(maxFps));
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-vision-norm-'));
  const outPath = path.join(dir, 'normalized.mp4');

  try {
    await execFileAsync(
      ffmpeg,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        videoPath,
        ...(filters.length ? ['-vf', filters.join(',')] : []),
        ...fpsArgs,
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-crf',
        '28',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '64k',
        '-ac',
        '1',
        '-movflags',
        '+faststart',
        '-y',
        outPath,
      ],
      { timeout: options.timeoutMs ?? 600000, maxBuffer: 16 * 1024 * 1024 }
    );
    const stat = await fs.stat(outPath);
    if (stat.size === 0) throw new Error('empty output');
    return {
      path: outPath,
      cleanup: async () => {
        await fs.rm(dir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await fs.rm(dir, { recursive: true, force: true });
    console.error(
      `[ffmpeg] Video normalization failed, using the original file: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return null;
  }
}

/**
 * Extract frames at scene changes using ffmpeg's select filter. Frame
 * timestamps are parsed from the showinfo filter output.
 */
export async function extractSceneChangeFrames(
  videoPath: string,
  options: {
    threshold?: number; // 0-1, lower = more frames (default 0.3)
    maxFrames?: number; // hard cap (default 20)
    outputDir?: string;
  } = {}
): Promise<ExtractedFrame[]> {
  const ffmpeg = await resolveFfmpegPath();
  const threshold = options.threshold ?? 0.3;
  const maxFrames = options.maxFrames ?? 20;
  const dir = await makeOutputDir(options.outputDir);
  const pattern = path.join(dir, `scene-%04d.png`);

  let stderr = '';
  try {
    const result = await execFileAsync(
      ffmpeg,
      [
        '-hide_banner',
        '-i',
        videoPath,
        '-vf',
        `select='gt(scene,${threshold})',showinfo`,
        '-fps_mode',
        'vfr',
        '-frames:v',
        String(maxFrames),
        '-y',
        pattern,
      ],
      { timeout: EXTRACT_TIMEOUT_MS * 3, maxBuffer: 32 * 1024 * 1024 }
    );
    stderr = result.stderr || '';
  } catch (error) {
    throw new VisionError(
      `ffmpeg scene detection failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      'FFMPEG_ERROR'
    );
  }

  // showinfo logs one "n:<idx> ... pts_time:<seconds>" line per kept frame
  const ptsTimes = [...stderr.matchAll(/n:\s*(\d+)\s.*?pts_time:([\d.]+)/g)]
    .map(m => ({ index: parseInt(m[1], 10), seconds: parseFloat(m[2]) }))
    .sort((a, b) => a.index - b.index);

  const frames: ExtractedFrame[] = [];
  const entries = (await fs.readdir(dir))
    .filter(f => f.startsWith('scene-') && f.endsWith('.png'))
    .sort();

  for (let i = 0; i < entries.length; i++) {
    const seconds = ptsTimes[i]?.seconds;
    frames.push({
      timestamp:
        seconds !== undefined ? formatSecondsAsClock(seconds) : `frame ${i + 1}`,
      seconds: seconds ?? -1,
      path: path.join(dir, entries[i]),
    });
  }

  return frames;
}
