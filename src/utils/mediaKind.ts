/**
 * Classify a media source (path, URL, or data URI) as image, video, audio
 * or document from its MIME type or file extension. Used by evaluate_media,
 * which accepts mixed media in one call.
 */

import path from 'path';

export type MediaKind = 'image' | 'video' | 'audio' | 'document';

const EXTENSION_KINDS: Record<string, MediaKind> = {
  // images
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  webp: 'image',
  gif: 'image',
  bmp: 'image',
  tif: 'image',
  tiff: 'image',
  heic: 'image',
  heif: 'image',
  // video
  mp4: 'video',
  mov: 'video',
  avi: 'video',
  webm: 'video',
  mkv: 'video',
  mpeg: 'video',
  mpg: 'video',
  wmv: 'video',
  flv: 'video',
  '3gp': 'video',
  m4v: 'video',
  // audio
  mp3: 'audio',
  wav: 'audio',
  aac: 'audio',
  flac: 'audio',
  ogg: 'audio',
  aiff: 'audio',
  aif: 'audio',
  m4a: 'audio',
  opus: 'audio',
  // documents (the Decisions API accepts PDF only)
  pdf: 'document',
};

/** Kind for a MIME type, or undefined when it is not a supported medium. */
export function mediaKindFromMimeType(
  mimeType: string | undefined
): MediaKind | undefined {
  if (!mimeType) return undefined;
  const mime = mimeType.toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'application/pdf') return 'document';
  return undefined;
}

/**
 * Kind for a source string. Data URIs are classified by their MIME type,
 * everything else by file extension (query strings ignored). Returns
 * undefined when it cannot be determined (for example files/ references,
 * whose type lives in Files API metadata).
 */
export function classifyMediaSource(source: string): MediaKind | undefined {
  if (source.startsWith('data:')) {
    const end = source.search(/[;,]/);
    return mediaKindFromMimeType(end > 5 ? source.slice(5, end) : undefined);
  }
  const ext = path
    .extname(source.split('?')[0].split('#')[0])
    .replace('.', '')
    .toLowerCase();
  return EXTENSION_KINDS[ext];
}
