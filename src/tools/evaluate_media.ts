/**
 * MCP Tool: evaluate_media
 * Answers closed-ended questions (yes/no, pick-one, rubric score) about
 * images, videos, audio, PDFs or plain text using the Gemini Decisions API
 * (gemini-decision-1). Returns calibrated probabilities instead of prose, in
 * well under a second for images, with zero output tokens.
 *
 * Built for checks a caller wants to branch on: "does this screenshot show
 * an error?", "which page is this?", "how complete is this UI state?".
 */

import type { VisionProvider } from '../types/Providers.js';
import type { Config } from '../types/Config.js';
import type { FileService } from '../services/FileService.js';
import { VisionError } from '../types/Errors.js';
import type {
  DecisionMediaInput,
  EvaluateMediaArgs,
  EvaluateMediaResult,
} from '../types/Decision.js';
import { buildDecisionQuestions } from '../utils/decisions.js';
import {
  classifyMediaSource,
  mediaKindFromMimeType,
} from '../utils/mediaKind.js';
import {
  isFileReferenceSource,
  isGcsUri,
  isHttpUrl,
} from '../utils/mediaSources.js';
import { isYouTubeUrl } from '../utils/youtube.js';

export type { EvaluateMediaArgs } from '../types/Decision.js';

const MAX_MEDIA_SOURCES = 16;

/** Short, non-sensitive label for error messages (never echo base64). */
function describeSource(source: string): string {
  return source.startsWith('data:')
    ? `${source.slice(0, source.indexOf(',') > 0 ? Math.min(source.indexOf(','), 40) : 40)}...`
    : source;
}

async function resolveFileReference(
  provider: VisionProvider,
  fileRef: string,
  source: string
): Promise<DecisionMediaInput> {
  if (!provider.getFileReferenceInfo) {
    throw new VisionError(
      'This provider cannot resolve file references for evaluate_media',
      'UNSUPPORTED_OPERATION'
    );
  }
  const info = await provider.getFileReferenceInfo(fileRef);
  const kind = mediaKindFromMimeType(info.mimeType);
  if (!kind) {
    throw new VisionError(
      `Unsupported media type "${info.mimeType}" for ${describeSource(source)}. evaluate_media accepts images, video, audio and PDF.`,
      'UNSUPPORTED_FILE_TYPE'
    );
  }
  return { kind, uri: info.uri, mimeType: info.mimeType };
}

async function resolveMediaSource(
  source: string,
  provider: VisionProvider,
  imageFileService: FileService,
  videoFileService: FileService
): Promise<DecisionMediaInput> {
  if (isHttpUrl(source) && isYouTubeUrl(source)) {
    throw new VisionError(
      'YouTube URLs are not supported by evaluate_media (the Decisions API cannot fetch them). Use analyze_video for YouTube, or pass a downloaded video file.',
      'UNSUPPORTED_SOURCE'
    );
  }
  if (isGcsUri(source)) {
    throw new VisionError(
      'gs:// URIs are not supported by evaluate_media. Pass a local file, an HTTPS URL, or a files/ reference.',
      'UNSUPPORTED_SOURCE'
    );
  }
  if (isFileReferenceSource(source)) {
    return resolveFileReference(provider, source, source);
  }

  const kind = classifyMediaSource(source);
  if (!kind) {
    throw new VisionError(
      `Cannot tell what kind of media ${describeSource(source)} is. Use a file with an image, video, audio or .pdf extension (Office documents are not supported here; use analyze_document).`,
      'UNSUPPORTED_FILE_TYPE'
    );
  }

  if (kind === 'image') {
    const processed = await imageFileService.handleImageSource(source);
    if (processed.startsWith('data:')) {
      const comma = processed.indexOf(',');
      const mimeType = processed.slice(5, processed.indexOf(';'));
      return { kind, mimeType, data: processed.slice(comma + 1) };
    }
    return resolveFileReference(provider, processed, source);
  }

  if (kind === 'video') {
    const processed = await videoFileService.handleVideoSource(source);
    if (!isFileReferenceSource(processed)) {
      throw new VisionError(
        `Could not load the video at ${describeSource(source)} (the download failed or the content is not a video).`,
        'FILE_UPLOAD_ERROR'
      );
    }
    return resolveFileReference(provider, processed, source);
  }

  if (!provider.prepareFileReference) {
    throw new VisionError(
      `This provider cannot upload ${kind} sources for evaluate_media`,
      'UNSUPPORTED_OPERATION'
    );
  }
  const reference = await provider.prepareFileReference(source, kind);
  return { kind, uri: reference.uri, mimeType: reference.mimeType };
}

export async function evaluate_media(
  args: EvaluateMediaArgs,
  config: Config,
  provider: VisionProvider,
  imageFileService: FileService,
  videoFileService: FileService
): Promise<EvaluateMediaResult> {
  try {
    const mediaSources = args.mediaSources ?? [];
    const context = args.context?.trim();

    if (mediaSources.length === 0 && !context) {
      throw new VisionError(
        'Provide mediaSources (image, video, audio or PDF), a context text, or both',
        'MISSING_ARGUMENT'
      );
    }
    if (mediaSources.length > MAX_MEDIA_SOURCES) {
      throw new VisionError(
        `Too many media sources: ${mediaSources.length} (maximum ${MAX_MEDIA_SOURCES})`,
        'INVALID_ARGUMENT'
      );
    }
    // Validate questions before uploading anything
    buildDecisionQuestions(args.questions);

    if (!provider.evaluateMedia) {
      throw new VisionError(
        `Provider ${config.IMAGE_PROVIDER} does not support evaluate_media (the Decisions API is Gemini Developer API only)`,
        'UNSUPPORTED_OPERATION'
      );
    }

    const media = await Promise.all(
      mediaSources.map(source =>
        resolveMediaSource(source, provider, imageFileService, videoFileService)
      )
    );

    return await provider.evaluateMedia(
      media,
      args.questions,
      context,
      args.options
    );
  } catch (error) {
    console.error('Error in evaluate_media tool:', error);

    if (error instanceof VisionError) {
      throw error;
    }

    throw new VisionError(
      `Failed to evaluate media: ${error instanceof Error ? error.message : String(error)}`,
      'EVALUATION_ERROR',
      config.IMAGE_PROVIDER,
      error instanceof Error ? error : undefined
    );
  }
}
