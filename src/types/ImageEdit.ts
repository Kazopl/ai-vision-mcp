/**
 * Image editing types (Nano Banana / gemini-3.1-flash-image family).
 */

export interface EditImageInput {
  /** Base64 image bytes (no data: prefix) */
  data: string;
  mimeType: string;
}

export interface EditImageOptions {
  /** e.g. '1:1', '16:9', '3:2'... Defaults to the input image's ratio. */
  aspectRatio?: string;
  /** '512' | '1K' | '2K' | '4K' (512 is gemini-3.1-flash-image only) */
  imageSize?: string;
}

export interface EditImageResult {
  images: Array<{ data: Buffer; mimeType: string }>;
  text: string;
  metadata: {
    model: string;
    provider: string;
    usage?: {
      promptTokenCount: number;
      candidatesTokenCount: number;
      totalTokenCount: number;
    };
    processingTime?: number;
    modelVersion?: string;
    responseId?: string;
  };
}

export interface EditImageArgs {
  imageSources: string[]; // 1-14 sources: URL, base64 data URI, or local file path
  prompt: string;
  outputFilePath?: string;
  aspectRatio?: string;
  imageSize?: string;
}

export interface EditedImageFile {
  path: string;
  width: number;
  height: number;
  size_bytes: number;
  format: string;
}

export interface EditImageResponse {
  images: EditedImageFile[];
  commentary: string;
  summary: string;
  metadata: EditImageResult['metadata'] & { timestamp: string };
}
