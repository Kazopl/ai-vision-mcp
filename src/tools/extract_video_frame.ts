/**
 * MCP Tool: extract_video_frame
 *
 * Extracts still frames from a video with ffmpeg, either at explicit
 * timestamps or at scene changes. The point: the Gemini API caps video at
 * 280 tokens/frame ("high"), while a still image can be analyzed at
 * "ultra_high" (2240 tokens). For reading exact small text (URLs, code,
 * UI labels) extract the frame, then run analyze_image on it - optionally
 * with cropRegion - for far better OCR than any video-level setting.
 *
 * This tool is fully local (ffmpeg + ImageScript); it makes no API calls.
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { Image } from 'imagescript';
import { VisionError } from '../types/Errors.js';
import { cropImageBuffer, type CropRegion } from '../utils/imageCrop.js';
import {
  extractFramesAtTimestamps,
  extractSceneChangeFrames,
  type ExtractedFrame,
} from '../utils/ffmpeg.js';
import { isYouTubeUrl } from '../utils/youtube.js';

export interface ExtractVideoFrameArgs {
  videoSource: string; // Local file path or direct http(s) video file URL
  timestamps?: string[]; // e.g. ["00:12", "75", "1:02:03.500"]
  sceneDetect?: boolean; // Extract frames at scene changes instead
  sceneThreshold?: number; // 0-1, lower = more frames (default 0.3)
  maxFrames?: number; // Cap for scene detection (default 20)
  cropRegion?: CropRegion; // Optional pixel crop applied to every frame
  outputDir?: string; // Optional output directory (default: temp dir)
}

export interface ExtractedFrameInfo {
  timestamp: string;
  seconds: number;
  path: string;
  width: number;
  height: number;
  size_bytes: number;
}

export interface ExtractVideoFrameResponse {
  frames: ExtractedFrameInfo[];
  summary: string;
  metadata: {
    source: string;
    method: 'timestamps' | 'scene_detection';
    cropRegion?: CropRegion;
    timestamp: string;
  };
}

/**
 * Resolve the video to a local file path, downloading http(s) sources to a
 * temp file. YouTube URLs cannot be downloaded directly.
 */
async function resolveLocalVideoPath(
  videoSource: string
): Promise<{ path: string; cleanup?: () => Promise<void> }> {
  if (isYouTubeUrl(videoSource)) {
    throw new VisionError(
      'extract_video_frame cannot download YouTube videos. Use analyze_video for YouTube URLs (with videoMetadata clipping + mediaResolution "high"), or provide a local file / direct video URL.',
      'INVALID_ARGUMENT'
    );
  }

  if (/^https?:\/\//i.test(videoSource)) {
    const response = await fetch(videoSource);
    if (!response.ok) {
      throw new VisionError(
        `Failed to download video: ${response.status} ${response.statusText}`,
        'FETCH_ERROR'
      );
    }
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-vision-video-'));
    const filename =
      path.basename(videoSource.split('?')[0]) || 'video.mp4';
    const tempPath = path.join(
      dir,
      `${crypto.randomBytes(4).toString('hex')}-${filename}`
    );
    await fs.writeFile(tempPath, Buffer.from(await response.arrayBuffer()));
    return {
      path: tempPath,
      cleanup: async () => {
        await fs.rm(dir, { recursive: true, force: true });
      },
    };
  }

  try {
    await fs.access(videoSource);
  } catch {
    throw new VisionError(
      `Video file not found: ${videoSource}`,
      'FILE_NOT_FOUND'
    );
  }
  return { path: videoSource };
}

export async function extract_video_frame(
  args: ExtractVideoFrameArgs
): Promise<ExtractVideoFrameResponse> {
  if (!args.videoSource) {
    throw new VisionError('videoSource is required', 'MISSING_ARGUMENT');
  }
  const useScenes = args.sceneDetect === true;
  if (!useScenes && (!args.timestamps || args.timestamps.length === 0)) {
    throw new VisionError(
      'Provide timestamps (e.g. ["00:12", "01:30"]) or set sceneDetect: true',
      'MISSING_ARGUMENT'
    );
  }

  const { path: localPath, cleanup } = await resolveLocalVideoPath(
    args.videoSource
  );

  try {
    const rawFrames: ExtractedFrame[] = useScenes
      ? await extractSceneChangeFrames(localPath, {
          threshold: args.sceneThreshold,
          maxFrames: args.maxFrames,
          outputDir: args.outputDir,
        })
      : await extractFramesAtTimestamps(
          localPath,
          args.timestamps!,
          args.outputDir
        );

    if (rawFrames.length === 0) {
      throw new VisionError(
        useScenes
          ? 'No scene changes detected; try lowering sceneThreshold (e.g. 0.1)'
          : 'No frames extracted',
        'NO_FRAMES'
      );
    }

    const frames: ExtractedFrameInfo[] = [];
    for (const frame of rawFrames) {
      let buffer = await fs.readFile(frame.path);
      if (args.cropRegion) {
        buffer = await cropImageBuffer(buffer, args.cropRegion);
        await fs.writeFile(frame.path, buffer);
      }
      const decoded = await Image.decode(buffer);
      frames.push({
        timestamp: frame.timestamp,
        seconds: frame.seconds,
        path: frame.path,
        width: decoded.width,
        height: decoded.height,
        size_bytes: buffer.length,
      });
    }

    const lines: string[] = [];
    lines.push(`FRAME EXTRACTION COMPLETE\n`);
    lines.push(
      `Extracted ${frames.length} frame(s) via ${useScenes ? 'scene detection' : 'timestamps'}${args.cropRegion ? ', cropped' : ''}:\n`
    );
    for (const frame of frames) {
      lines.push(
        `- ${frame.timestamp} -> ${frame.path} (${frame.width}x${frame.height})`
      );
    }
    lines.push(
      `\nNext step for precise reading: call analyze_image on a frame path with options.mediaResolution "ultra_high" (2240 image tokens vs 280/frame for video) and optionally cropRegion to zoom into the text.`
    );

    return {
      frames,
      summary: lines.join('\n'),
      metadata: {
        source: args.videoSource,
        method: useScenes ? 'scene_detection' : 'timestamps',
        cropRegion: args.cropRegion,
        timestamp: new Date().toISOString(),
      },
    };
  } finally {
    await cleanup?.();
  }
}
