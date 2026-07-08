/**
 * Segmentation mask overlay rendering using ImageScript.
 *
 * Gemini 3.x returns each mask as a polygon of coordinate pairs normalized
 * to 0-1000 (full-image coordinates). Older Gemini 2.5 models return a
 * base64 PNG probability map (0-255) sized to the object's bounding box.
 * Both formats are supported here: polygons are scanline-filled, PNG maps
 * are resized to the box and thresholded, then alpha-blended onto the image.
 */

import { Image } from 'imagescript';

export interface MaskOverlayInput {
  label: string;
  /** [ymin, xmin, ymax, xmax] normalized to 0-1000 */
  box_2d: [number, number, number, number];
  /** Polygon of coordinate pairs (0-1000) or base64 PNG probability map */
  mask: Array<[number, number]> | string;
}

export interface RenderedSegment {
  label: string;
  box_2d: [number, number, number, number];
  pixel_box: { x: number; y: number; width: number; height: number };
  area_percent: number;
  color: string;
}

// Distinct overlay colors, cycled per segment
const OVERLAY_COLORS: Array<{ rgb: [number, number, number]; hex: string }> = [
  { rgb: [255, 0, 0], hex: '#ff0000' },
  { rgb: [0, 200, 0], hex: '#00c800' },
  { rgb: [0, 100, 255], hex: '#0064ff' },
  { rgb: [255, 200, 0], hex: '#ffc800' },
  { rgb: [255, 0, 255], hex: '#ff00ff' },
  { rgb: [0, 220, 220], hex: '#00dcdc' },
  { rgb: [255, 128, 0], hex: '#ff8000' },
  { rgb: [128, 0, 255], hex: '#8000ff' },
];

const MASK_THRESHOLD = 127; // Binarization midpoint per Google's docs
const OVERLAY_ALPHA = 0.45;

function stripBase64Prefix(mask: string): string {
  const commaIdx = mask.indexOf(',');
  if (mask.startsWith('data:') && commaIdx !== -1) {
    return mask.slice(commaIdx + 1);
  }
  return mask;
}

function blendPixel(
  image: Image,
  px: number,
  py: number,
  rgb: [number, number, number]
): void {
  if (px < 1 || py < 1 || px > image.width || py > image.height) return;

  const orig = image.getPixelAt(px, py);
  const or = (orig >>> 24) & 0xff;
  const og = (orig >>> 16) & 0xff;
  const ob = (orig >>> 8) & 0xff;
  const oa = orig & 0xff;

  const nr = Math.round(or * (1 - OVERLAY_ALPHA) + rgb[0] * OVERLAY_ALPHA);
  const ng = Math.round(og * (1 - OVERLAY_ALPHA) + rgb[1] * OVERLAY_ALPHA);
  const nb = Math.round(ob * (1 - OVERLAY_ALPHA) + rgb[2] * OVERLAY_ALPHA);

  image.setPixelAt(px, py, ((nr << 24) | (ng << 16) | (nb << 8) | oa) >>> 0);
}

/**
 * The API docs specify mask polygon points as [x, y], but models frequently
 * emit [y, x] (matching box_2d's y-first convention). Score both readings
 * against the bounding box and pick the one where more points fall inside.
 */
function normalizePolygonAxisOrder(
  points: Array<[number, number]>,
  box2d: [number, number, number, number]
): Array<[number, number]> {
  const [ymin, xmin, ymax, xmax] = box2d;
  const tolerance = 25;

  let fitsAsXY = 0;
  let fitsAsYX = 0;
  for (const [a, b] of points) {
    if (
      a >= xmin - tolerance &&
      a <= xmax + tolerance &&
      b >= ymin - tolerance &&
      b <= ymax + tolerance
    ) {
      fitsAsXY++;
    }
    if (
      b >= xmin - tolerance &&
      b <= xmax + tolerance &&
      a >= ymin - tolerance &&
      a <= ymax + tolerance
    ) {
      fitsAsYX++;
    }
  }

  // Ties keep the documented [x, y] order
  if (fitsAsYX > fitsAsXY) {
    return points.map(([a, b]) => [b, a] as [number, number]);
  }
  return points;
}

/** Polygon area in pixels via the shoelace formula */
function polygonArea(points: Array<[number, number]>): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}

/**
 * Scanline-fill a polygon (pixel coordinates, even-odd rule) with an
 * alpha-blended color.
 */
function fillPolygon(
  image: Image,
  points: Array<[number, number]>,
  rgb: [number, number, number]
): void {
  if (points.length < 3) return;

  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of points) {
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  minY = Math.max(1, Math.floor(minY));
  maxY = Math.min(image.height, Math.ceil(maxY));

  for (let y = minY; y <= maxY; y++) {
    const scanY = y + 0.5;
    const intersections: number[] = [];

    for (let i = 0; i < points.length; i++) {
      const [x1, y1] = points[i];
      const [x2, y2] = points[(i + 1) % points.length];
      if (y1 === y2) continue;
      if ((scanY >= y1 && scanY < y2) || (scanY >= y2 && scanY < y1)) {
        intersections.push(x1 + ((scanY - y1) / (y2 - y1)) * (x2 - x1));
      }
    }

    intersections.sort((a, b) => a - b);
    for (let i = 0; i + 1 < intersections.length; i += 2) {
      const startX = Math.max(1, Math.round(intersections[i]));
      const endX = Math.min(image.width, Math.round(intersections[i + 1]));
      for (let x = startX; x <= endX; x++) {
        blendPixel(image, x, y, rgb);
      }
    }
  }
}

/**
 * Blend segmentation masks onto the original image and compute per-segment
 * stats. Returns the annotated image (PNG) plus the rendered segment info.
 * Segments with unusable masks fall back to box-only rendering.
 */
export async function renderSegmentationOverlay(
  originalImageBuffer: Buffer,
  segments: MaskOverlayInput[]
): Promise<{ buffer: Buffer; rendered: RenderedSegment[] }> {
  const image = await Image.decode(originalImageBuffer);
  const rendered: RenderedSegment[] = [];
  const imageArea = image.width * image.height;

  for (let idx = 0; idx < segments.length; idx++) {
    const segment = segments[idx];
    const colorSpec = OVERLAY_COLORS[idx % OVERLAY_COLORS.length];
    const [normY1, normX1, normY2, normX2] = segment.box_2d;

    // Descale 0-1000 coordinates to pixels, clamped to image bounds
    const x1 = Math.max(0, Math.round((normX1 / 1000) * image.width));
    const y1 = Math.max(0, Math.round((normY1 / 1000) * image.height));
    const x2 = Math.min(image.width, Math.round((normX2 / 1000) * image.width));
    const y2 = Math.min(
      image.height,
      Math.round((normY2 / 1000) * image.height)
    );
    const boxWidth = x2 - x1;
    const boxHeight = y2 - y1;

    if (boxWidth <= 0 || boxHeight <= 0) {
      console.error(
        `[segmentationOverlay] Skipping segment with empty box: ${segment.label}`
      );
      continue;
    }

    let maskAreaPixels = 0;

    try {
      if (Array.isArray(segment.mask)) {
        // Gemini 3.x: polygon of coordinate pairs normalized to 0-1000
        // (full-image coordinates)
        const orderedPoints = normalizePolygonAxisOrder(
          segment.mask,
          segment.box_2d
        );
        const pixelPoints = orderedPoints.map(
          ([px, py]) =>
            [
              (px / 1000) * image.width,
              (py / 1000) * image.height,
            ] as [number, number]
        );
        fillPolygon(image, pixelPoints, colorSpec.rgb);
        maskAreaPixels = polygonArea(pixelPoints);
      } else if (typeof segment.mask === 'string' && segment.mask.length > 0) {
        // Gemini 2.5: base64 PNG probability map sized to the bounding box
        const maskBuffer = Buffer.from(
          stripBase64Prefix(segment.mask),
          'base64'
        );
        const maskImage = await Image.decode(maskBuffer);
        if (maskImage.width !== boxWidth || maskImage.height !== boxHeight) {
          maskImage.resize(boxWidth, boxHeight);
        }

        for (let my = 1; my <= boxHeight; my++) {
          for (let mx = 1; mx <= boxWidth; mx++) {
            const maskValue = (maskImage.getPixelAt(mx, my) >>> 24) & 0xff;
            if (maskValue <= MASK_THRESHOLD) continue;
            maskAreaPixels++;
            blendPixel(image, x1 + mx, y1 + my, colorSpec.rgb);
          }
        }
      }
    } catch (error) {
      console.error(
        `[segmentationOverlay] Failed to render mask for "${segment.label}", drawing box only: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    rendered.push({
      label: segment.label,
      box_2d: segment.box_2d,
      pixel_box: { x: x1, y: y1, width: boxWidth, height: boxHeight },
      area_percent:
        imageArea > 0
          ? Math.round((maskAreaPixels / imageArea) * 1000) / 10
          : 0,
      color: colorSpec.hex,
    });
  }

  return { buffer: Buffer.from(await image.encode()), rendered };
}
