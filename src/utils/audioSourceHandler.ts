/**
 * Audio source loading for analyze_audio.
 * Supports data: URIs, http(s) URLs, and local file paths.
 */

import fs from 'fs/promises';
import path from 'path';
import { VisionError, NetworkError } from '../types/Errors.js';

/** Keep inline payloads safely under the 20MB total-request cap. */
export const AUDIO_INLINE_THRESHOLD = 18 * 1024 * 1024;

const AUDIO_MIME_BY_EXT: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  aac: 'audio/aac',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  aiff: 'audio/aiff',
  aif: 'audio/aiff',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  weba: 'audio/webm',
  webm: 'audio/webm',
};

export function getAudioMimeType(filenameOrUrl: string): string {
  const ext = path
    .extname(filenameOrUrl.split('?')[0])
    .replace('.', '')
    .toLowerCase();
  return AUDIO_MIME_BY_EXT[ext] || 'audio/mpeg';
}

export interface LoadedAudio {
  buffer: Buffer;
  mimeType: string;
  filename: string;
}

export async function loadAudioSource(
  audioSource: string
): Promise<LoadedAudio> {
  if (audioSource.startsWith('data:audio/')) {
    const commaIdx = audioSource.indexOf(',');
    if (commaIdx === -1) {
      throw new VisionError('Malformed audio data URI', 'INVALID_ARGUMENT');
    }
    const mimeType = audioSource.slice(5, audioSource.indexOf(';'));
    return {
      buffer: Buffer.from(audioSource.slice(commaIdx + 1), 'base64'),
      mimeType,
      filename: 'audio',
    };
  }

  if (/^https?:\/\//i.test(audioSource)) {
    const response = await fetch(audioSource);
    if (!response.ok) {
      throw new NetworkError(
        `Failed to fetch audio from URL (Status: ${response.status})`
      );
    }
    const contentType = response.headers.get('content-type')?.split(';')[0];
    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      mimeType:
        contentType && contentType.startsWith('audio/')
          ? contentType
          : getAudioMimeType(audioSource),
      filename: path.basename(audioSource.split('?')[0]) || 'audio.mp3',
    };
  }

  try {
    const buffer = await fs.readFile(audioSource);
    return {
      buffer,
      mimeType: getAudioMimeType(audioSource),
      filename: path.basename(audioSource),
    };
  } catch {
    throw new VisionError(
      `Audio file not found: ${audioSource}`,
      'FILE_NOT_FOUND'
    );
  }
}
