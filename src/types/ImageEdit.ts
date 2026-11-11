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
  /**
   * '1K' (default) | '2K' | '4K'. '512' exists only on the deprecated
   * gemini-3.1-flash-image and is raised to '1K' on other models.
   */
  imageSize?: string;
  /**
   * Video-to-image: a video (YouTube URL, local file path, or files/ ref)
   * used as visual context to generate thumbnails, posters, or infographics.
   * Needs a video-capable image model (gemini-nano-banana-2.1, the default);
   * gemini-3-pro-image cannot take video, so the default is used instead.
   */
  videoSource?: string;
}

export interface EditImageResult {
  images: Array<{ data: Buffer; mimeType: string }>;
  text: string;
  metadata: {
    model: string;
    provider: string;
    usage?: import('./Analysis.js').UsageMetadata;
    processingTime?: number;
    modelVersion?: string;
    responseId?: string;
    /** Why generation stopped; explains refusals (e.g. PROHIBITED_CONTENT) */
    finishReason?: string;
  };
}

export interface EditImageArgs {
  imageSources?: string[]; // 0-14 sources: URL, base64 data URI, or local file path
  prompt: string;
  outputFilePath?: string;
  aspectRatio?: string;
  imageSize?: string;
  /** Video-to-image: YouTube URL, local video path, or files/ reference */
  videoSource?: string;
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
