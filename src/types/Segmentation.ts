/**
 * Image segmentation types for AI Vision MCP
 */

import type { AnalysisOptions } from './Providers.js';
import type { ObjectDetectionMetadata } from './ObjectDetection.js';

export interface SegmentedObject {
  label: string; // Descriptive label for the segmented object
  normalized_box_2d: [number, number, number, number]; // [ymin, xmin, ymax, xmax] normalized to 0-1000
  pixel_box: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  area_percent: number; // Mask coverage as % of the full image
  color: string; // Overlay color assigned to this segment (hex)
}

export interface SegmentationArgs {
  imageSource: string; // URL, base64, or local file path
  prompt: string; // What to segment (natural language, can be relational e.g. "the disabled button")
  outputFilePath?: string; // Optional explicit output path for the overlay image
  options?: AnalysisOptions; // Optional API configuration parameters
}

export interface SegmentationWithFile {
  segments: SegmentedObject[];
  file: {
    path: string;
    size_bytes: number;
    format: string;
  };
  image_metadata: {
    width: number;
    height: number;
    original_size: number;
  };
  summary: string;
  metadata: ObjectDetectionMetadata;
}

export interface SegmentationWithTempFile {
  segments: SegmentedObject[];
  tempFile: {
    path: string;
    size_bytes: number;
    format: string;
  };
  image_metadata: {
    width: number;
    height: number;
    original_size: number;
  };
  summary: string;
  metadata: ObjectDetectionMetadata;
}

export interface SegmentationOnly {
  segments: SegmentedObject[];
  image_metadata: {
    width: number;
    height: number;
    original_size: number;
  };
  summary: string;
  metadata: ObjectDetectionMetadata;
}

export type SegmentationResponse =
  | SegmentationWithFile
  | SegmentationWithTempFile
  | SegmentationOnly;

/**
 * Raw segmentation entry as returned by the Gemini API:
 * box_2d in [ymin, xmin, ymax, xmax] normalized to 0-1000, and mask as a
 * polygon of coordinate pairs normalized to 0-1000 (Gemini 3.x) or a base64
 * PNG probability map sized to the bounding box (Gemini 2.5).
 */
export interface RawSegmentationEntry {
  label: string;
  box_2d: [number, number, number, number];
  mask: Array<[number, number]> | string;
}
