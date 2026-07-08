/**
 * MCP Tool: segment_objects_in_image
 * Segments objects in images using Gemini's conversational segmentation and
 * renders per-object contour masks as a colored overlay image.
 */

import path from 'path';
import type { AnalysisOptions } from '../types/Providers.js';
import type { VisionProvider } from '../types/Providers.js';
import { FileService } from '../services/FileService.js';
import type { Config } from '../types/Config.js';
import { VisionError } from '../types/Errors.js';
import { FUNCTION_NAMES } from '../constants/FunctionNames.js';
import type { ObjectDetectionMetadata } from '../types/ObjectDetection.js';
import type {
  SegmentationArgs,
  SegmentationResponse,
  SegmentationWithFile,
  SegmentationWithTempFile,
  SegmentationOnly,
  RawSegmentationEntry,
  SegmentedObject,
} from '../types/Segmentation.js';
import {
  renderSegmentationOverlay,
  type RenderedSegment,
} from '../utils/segmentationOverlay.js';
import { ImageAnnotator } from '../utils/imageAnnotator.js';
import { Image } from 'imagescript';

// Canonical segmentation output instruction per Google's image understanding
// docs. Gemini 3.x emits masks as polygons of coordinate pairs (0-1000);
// requesting the legacy base64-PNG mask format makes current models loop
// until the token cap.
const SEGMENTATION_INSTRUCTION = `
Give the segmentation masks for the objects the user asks about.
Output a JSON list of segmentation masks where each entry contains:
- "box_2d": the 2D bounding box as [ymin, xmin, ymax, xmax] normalized to 0-1000
- "mask": the segmentation mask of the item as a polygon of coordinate pairs, normalized to 0-1000
- "label": a short descriptive text label for the object

Rules:
- Only segment what the user asks for; the request may be relational or conditional (e.g. "the button that is disabled").
- Use descriptive, distinguishing labels for multiple instances.
- Return only the JSON list, no other text.
`;

const createSegmentationSchema = () => ({
  type: 'array',
  items: {
    type: 'object',
    properties: {
      box_2d: {
        type: 'array',
        minItems: 4,
        maxItems: 4,
        items: { type: 'integer' },
        description:
          'Bounding box [ymin, xmin, ymax, xmax], normalized to 0-1000',
      },
      mask: {
        type: 'array',
        items: {
          type: 'array',
          minItems: 2,
          maxItems: 2,
          items: { type: 'integer' },
        },
        description:
          'Segmentation mask as a polygon of coordinate pairs, normalized to 0-1000',
      },
      label: {
        type: 'string',
        description: 'Short descriptive label for the object',
      },
    },
    required: ['box_2d', 'mask', 'label'],
  },
});

function parseSegmentationJson(rawText: string): RawSegmentationEntry[] {
  const text = (rawText || '').trim();
  const candidates: string[] = [];

  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch?.[1]) candidates.push(fencedMatch[1].trim());
  if (text) candidates.push(text);

  const arrayStart = text.indexOf('[');
  const arrayEnd = text.lastIndexOf(']');
  if (arrayStart !== -1 && arrayEnd > arrayStart) {
    candidates.push(text.slice(arrayStart, arrayEnd + 1).trim());
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // try next candidate
    }
  }

  throw new VisionError(
    `Failed to parse segmentation results as JSON. Raw response (first 500 chars): ${text.substring(0, 500)}`,
    'PARSE_ERROR'
  );
}

function generateSegmentationSummary(
  segments: SegmentedObject[],
  imageWidth: number,
  imageHeight: number
): string {
  const lines: string[] = [];
  lines.push(`SEGMENTATION COMPLETE\n`);
  lines.push(`Source Image: ${imageWidth}×${imageHeight} pixels`);
  lines.push(`Segments Found: ${segments.length}\n`);
  lines.push(
    `Coordinates: pixel_box uses top-left origin pixels; normalized_box_2d is [ymin, xmin, ymax, xmax] on a 0-1000 scale.\n`
  );
  lines.push(`## SEGMENTS:\n`);

  segments.forEach((segment, index) => {
    lines.push(`### ${index + 1}. ${segment.label} (${segment.color})`);
    lines.push(
      `- **Pixels**: ${segment.pixel_box.width}×${segment.pixel_box.height} at (${segment.pixel_box.x}, ${segment.pixel_box.y})`
    );
    lines.push(`- **Mask coverage**: ${segment.area_percent}% of image\n`);
  });

  return lines.join('\n');
}

export type { SegmentationArgs } from '../types/Segmentation.js';

export async function segment_objects_in_image(
  args: SegmentationArgs,
  config: Config,
  imageProvider: VisionProvider,
  imageFileService: FileService
): Promise<SegmentationResponse> {
  try {
    if (!args.imageSource) {
      throw new VisionError('imageSource is required', 'MISSING_ARGUMENT');
    }
    if (!args.prompt) {
      throw new VisionError('prompt is required', 'MISSING_ARGUMENT');
    }

    const processedImageSource = await imageFileService.handleImageSource(
      args.imageSource
    );

    // Load the original image bytes for overlay rendering
    let originalImageBuffer: Buffer;
    if (args.imageSource.startsWith('data:image/')) {
      originalImageBuffer = Buffer.from(
        args.imageSource.split(',')[1],
        'base64'
      );
    } else if (args.imageSource.startsWith('http')) {
      const response = await fetch(args.imageSource);
      if (!response.ok) {
        throw new VisionError(
          `Failed to fetch image from URL: ${response.statusText}`,
          'FETCH_ERROR'
        );
      }
      originalImageBuffer = Buffer.from(await response.arrayBuffer());
    } else {
      originalImageBuffer = await imageFileService.readFile(args.imageSource);
    }

    const decoded = await Image.decode(originalImageBuffer);
    const imageWidth = decoded.width || 0;
    const imageHeight = decoded.height || 0;
    if (imageWidth === 0 || imageHeight === 0) {
      throw new VisionError(
        'Unable to determine image dimensions',
        'INVALID_IMAGE'
      );
    }

    const options: AnalysisOptions = {
      temperature:
        config.TEMPERATURE_FOR_SEGMENT_OBJECTS_IN_IMAGE ??
        config.TEMPERATURE_FOR_IMAGE ??
        config.TEMPERATURE,
      topP:
        config.TOP_P_FOR_SEGMENT_OBJECTS_IN_IMAGE ??
        config.TOP_P_FOR_IMAGE ??
        config.TOP_P,
      topK:
        config.TOP_K_FOR_SEGMENT_OBJECTS_IN_IMAGE ??
        config.TOP_K_FOR_IMAGE ??
        config.TOP_K,
      // Masks are base64 PNGs inside the JSON output, so allow large responses
      maxTokens: config.MAX_TOKENS_FOR_SEGMENT_OBJECTS_IN_IMAGE ?? 16384,
      taskType: 'image',
      functionName: FUNCTION_NAMES.SEGMENT_OBJECTS_IN_IMAGE,
      responseSchema: createSegmentationSchema(),
      systemInstruction: SEGMENTATION_INSTRUCTION,
      // Spatial outputs degrade with heavy reasoning; keep thinking minimal
      // by default (callers can still override via options).
      thinkingLevel: 'minimal',
      ...args.options,
    };

    console.error('[segment_objects_in_image] Requesting segmentation...');
    const result = await imageProvider.analyzeImage(
      processedImageSource,
      args.prompt,
      options
    );

    const rawEntries = parseSegmentationJson(result.text);
    console.error(
      `[segment_objects_in_image] Received ${rawEntries.length} segment(s)`
    );

    // Validate entries; mask is a polygon (Gemini 3.x) or base64 PNG (2.5)
    const validEntries = rawEntries.filter(entry => {
      const hasValidMask =
        (Array.isArray(entry?.mask) && entry.mask.length >= 3) ||
        (typeof entry?.mask === 'string' && entry.mask.length > 0);
      if (
        !entry ||
        !Array.isArray(entry.box_2d) ||
        entry.box_2d.length !== 4 ||
        !hasValidMask
      ) {
        console.error(
          `[segment_objects_in_image] Skipping invalid entry: ${JSON.stringify(entry)?.substring(0, 120)}`
        );
        return false;
      }
      const [y1, x1, y2, x2] = entry.box_2d;
      return y1 >= 0 && x1 >= 0 && y2 <= 1000 && x2 <= 1000 && y1 < y2 && x1 < x2;
    });

    // Render mask overlay
    const { buffer: overlayBuffer, rendered } =
      await renderSegmentationOverlay(originalImageBuffer, validEntries);

    // Draw bounding box outlines + labels on top of the mask overlay
    const annotator = new ImageAnnotator();
    const annotatedImageBuffer = await annotator.drawAnnotations(
      overlayBuffer,
      rendered.map((segment: RenderedSegment, idx: number) => ({
        object: `${idx + 1}`,
        label: segment.label,
        normalized_box_2d: segment.box_2d,
        confidence: 1,
      })),
      imageWidth,
      imageHeight
    );

    const segments: SegmentedObject[] = rendered.map(segment => ({
      label: segment.label,
      normalized_box_2d: segment.box_2d,
      pixel_box: segment.pixel_box,
      area_percent: segment.area_percent,
      color: segment.color,
    }));

    const summary = generateSegmentationSummary(
      segments,
      imageWidth,
      imageHeight
    );

    const metadata: ObjectDetectionMetadata = {
      model: result.metadata?.model || 'unknown',
      provider: result.metadata?.provider || config.IMAGE_PROVIDER,
      usage: result.metadata?.usage,
      processingTime: result.metadata?.processingTime || 0,
      fileType: 'image/png',
      fileSize: originalImageBuffer.length,
      modelVersion: result.metadata?.modelVersion,
      responseId: result.metadata?.responseId,
      fileSaveStatus: 'saved',
      coordinateScale: 1000,
      coordinateFormat: '[ymin, xmin, ymax, xmax]',
      coordinateOrigin: 'top-left',
      detectionMethod: 'vision',
      timestamp: new Date().toISOString(),
    };

    const imageMetadata = {
      width: imageWidth,
      height: imageHeight,
      original_size: originalImageBuffer.length,
    };

    if (args.outputFilePath) {
      await annotator.saveToExplicitPath(
        args.outputFilePath,
        annotatedImageBuffer
      );
      const response: SegmentationWithFile = {
        segments,
        file: {
          path: path.resolve(args.outputFilePath),
          size_bytes: annotatedImageBuffer.length,
          format: 'png',
        },
        image_metadata: imageMetadata,
        summary,
        metadata,
      };
      return response;
    }

    const saveResult = await annotator.saveToTempFileOrSkip(
      annotatedImageBuffer,
      'png'
    );
    if (saveResult.method === 'temp_file') {
      const response: SegmentationWithTempFile = {
        segments,
        tempFile: {
          path: saveResult.path,
          size_bytes: annotatedImageBuffer.length,
          format: 'png',
        },
        image_metadata: imageMetadata,
        summary,
        metadata,
      };
      return response;
    }

    const response: SegmentationOnly = {
      segments,
      image_metadata: imageMetadata,
      summary,
      metadata: {
        ...metadata,
        fileSaveStatus: 'skipped_due_to_permissions',
      },
    };
    return response;
  } catch (error) {
    console.error('Error in segment_objects_in_image tool:', error);

    if (error instanceof VisionError) {
      throw error;
    }

    throw new VisionError(
      `Failed to segment objects in image: ${error instanceof Error ? error.message : String(error)}`,
      'SEGMENTATION_ERROR',
      config.IMAGE_PROVIDER,
      error instanceof Error ? error : undefined
    );
  }
}
