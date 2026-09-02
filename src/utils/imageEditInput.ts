/**
 * Input loading for image editing (Nano Banana models).
 * The image models cap inline inputs at 7MB per file, so oversized inputs
 * are automatically downscaled/re-encoded to fit.
 */

import fs from 'fs/promises';
import { Image } from 'imagescript';
import { VisionError, NetworkError } from '../types/Errors.js';
import type { EditImageInput } from '../types/ImageEdit.js';

const MAX_INLINE_BYTES = 6.5 * 1024 * 1024; // stay under the 7MB cap
const DOWNSCALE_MAX_DIM = 2048;

function detectImageMime(buffer: Buffer): string {
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return 'image/png';
}

async function fitUnderInlineCap(buffer: Buffer): Promise<{
  buffer: Buffer;
  mimeType: string;
}> {
  if (buffer.length <= MAX_INLINE_BYTES) {
    return { buffer, mimeType: detectImageMime(buffer) };
  }

  // Downscale + JPEG re-encode to fit the inline cap
  const image = await Image.decode(buffer);
  if (image.width > DOWNSCALE_MAX_DIM || image.height > DOWNSCALE_MAX_DIM) {
    const scale = Math.min(
      DOWNSCALE_MAX_DIM / image.width,
      DOWNSCALE_MAX_DIM / image.height
    );
    image.resize(
      Math.max(1, Math.round(image.width * scale)),
      Math.max(1, Math.round(image.height * scale))
    );
  }
  const encoded = Buffer.from(await image.encodeJPEG(85));
  if (encoded.length > MAX_INLINE_BYTES) {
    throw new VisionError(
      `Image is too large for the image editing model even after downscaling (${Math.round(encoded.length / 1024 / 1024)}MB > 6.5MB)`,
      'FILE_TOO_LARGE'
    );
  }
  console.error(
    `[imageEditInput] Downscaled oversized input image to fit the 7MB inline cap`
  );
  return { buffer: encoded, mimeType: 'image/jpeg' };
}

export async function loadEditImageInput(
  source: string
): Promise<EditImageInput> {
  let buffer: Buffer;

  if (source.startsWith('data:image/')) {
    const commaIdx = source.indexOf(',');
    if (commaIdx === -1) {
      throw new VisionError('Malformed image data URI', 'INVALID_ARGUMENT');
    }
    buffer = Buffer.from(source.slice(commaIdx + 1), 'base64');
  } else if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source);
    if (!response.ok) {
      throw new NetworkError(
        `Failed to fetch image from URL (Status: ${response.status})`
      );
    }
    buffer = Buffer.from(await response.arrayBuffer());
  } else if (source.startsWith('files/') || source.startsWith('gs://')) {
    throw new VisionError(
      'Image editing requires raw image bytes; files/ and gs:// references are not supported. Pass a URL, base64 data, or local file path.',
      'INVALID_ARGUMENT'
    );
  } else {
    try {
      buffer = await fs.readFile(source);
    } catch {
      throw new VisionError(
        `Image file not found: ${source}`,
        'FILE_NOT_FOUND'
      );
    }
  }

  const fitted = await fitUnderInlineCap(buffer);
  return {
    data: fitted.buffer.toString('base64'),
    mimeType: fitted.mimeType,
  };
}
