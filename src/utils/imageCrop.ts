/**
 * Shared image cropping helper (ImageScript).
 */

import { Image } from 'imagescript';
import { VisionError } from '../types/Errors.js';

export interface CropRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Crop an image buffer to the given pixel region (top-left origin) and
 * return the PNG bytes. The region is clamped to the image bounds.
 */
export async function cropImageBuffer(
  buffer: Buffer,
  region: CropRegion
): Promise<Buffer> {
  const image = await Image.decode(buffer);

  const x = Math.max(0, Math.floor(region.x));
  const y = Math.max(0, Math.floor(region.y));
  const width = Math.min(Math.floor(region.width), image.width - x);
  const height = Math.min(Math.floor(region.height), image.height - y);

  if (width <= 0 || height <= 0) {
    throw new VisionError(
      `cropRegion {x: ${region.x}, y: ${region.y}, width: ${region.width}, height: ${region.height}} is outside the ${image.width}x${image.height} image`,
      'INVALID_ARGUMENT'
    );
  }

  const cropped = image.crop(x, y, width, height);
  return Buffer.from(await cropped.encode());
}
