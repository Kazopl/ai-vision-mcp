/**
 * MCP Tool: edit_image
 * Edits, annotates, or composes images using Gemini's native image
 * generation models (Nano Banana family). Accepts 1-14 input images:
 * one image for editing/annotation, several for composition or
 * before/after difference highlighting.
 */

import path from 'path';
import { Image } from 'imagescript';
import type { VisionProvider } from '../types/Providers.js';
import type { Config } from '../types/Config.js';
import { VisionError } from '../types/Errors.js';
import { loadEditImageInput } from '../utils/imageEditInput.js';
import { ImageAnnotator } from '../utils/imageAnnotator.js';
import type {
  EditImageArgs,
  EditImageResponse,
  EditedImageFile,
} from '../types/ImageEdit.js';

export type { EditImageArgs } from '../types/ImageEdit.js';

const MAX_INPUT_IMAGES = 14;

export async function edit_image(
  args: EditImageArgs,
  config: Config,
  imageProvider: VisionProvider
): Promise<EditImageResponse> {
  try {
    if (!args.imageSources || args.imageSources.length === 0) {
      throw new VisionError(
        'imageSources is required (1-14 images)',
        'MISSING_ARGUMENT'
      );
    }
    if (args.imageSources.length > MAX_INPUT_IMAGES) {
      throw new VisionError(
        `Too many input images: ${args.imageSources.length} (the model supports up to ${MAX_INPUT_IMAGES})`,
        'INVALID_ARGUMENT'
      );
    }
    if (!args.prompt) {
      throw new VisionError('prompt is required', 'MISSING_ARGUMENT');
    }
    if (!imageProvider.editImage) {
      throw new VisionError(
        `Provider ${config.IMAGE_PROVIDER} does not support image editing`,
        'UNSUPPORTED_OPERATION'
      );
    }

    const inputs = await Promise.all(
      args.imageSources.map(source => loadEditImageInput(source))
    );

    console.error(
      `[edit_image] Editing with ${inputs.length} input image(s)...`
    );

    const result = await imageProvider.editImage(inputs, args.prompt, {
      aspectRatio: args.aspectRatio,
      imageSize: args.imageSize,
    });

    if (result.images.length === 0) {
      throw new VisionError(
        `The model returned no images${result.text ? `: ${result.text.substring(0, 300)}` : ' (the request may have been refused)'}`,
        'NO_IMAGE_OUTPUT',
        config.IMAGE_PROVIDER
      );
    }

    // Save output image(s): explicit path for the first, suffixes for extras
    const annotator = new ImageAnnotator();
    const files: EditedImageFile[] = [];
    for (let i = 0; i < result.images.length; i++) {
      const out = result.images[i];
      const ext = out.mimeType.includes('jpeg') ? 'jpg' : 'png';
      let savedPath: string;

      if (args.outputFilePath) {
        savedPath =
          i === 0
            ? path.resolve(args.outputFilePath)
            : path.resolve(
                args.outputFilePath.replace(/(\.[a-z]+)?$/i, `-${i + 1}$1`)
              );
        await annotator.saveToExplicitPath(savedPath, out.data);
      } else {
        const saveResult = await annotator.saveToTempFileOrSkip(out.data, ext);
        if (saveResult.method !== 'temp_file') {
          throw new VisionError(
            'Could not save the edited image to disk (permission error)',
            'FILE_SAVE_ERROR'
          );
        }
        savedPath = saveResult.path;
      }

      const decoded = await Image.decode(out.data);
      files.push({
        path: savedPath,
        width: decoded.width,
        height: decoded.height,
        size_bytes: out.data.length,
        format: ext,
      });
    }

    const lines: string[] = [];
    lines.push(`IMAGE EDIT COMPLETE\n`);
    lines.push(
      `Inputs: ${inputs.length} image(s) | Outputs: ${files.length} image(s)`
    );
    for (const file of files) {
      lines.push(`- ${file.path} (${file.width}x${file.height})`);
    }
    if (result.text) {
      lines.push(`\nModel commentary: ${result.text}`);
    }

    return {
      images: files,
      commentary: result.text,
      summary: lines.join('\n'),
      metadata: {
        ...result.metadata,
        timestamp: new Date().toISOString(),
      },
    };
  } catch (error) {
    console.error('Error in edit_image tool:', error);

    if (error instanceof VisionError) {
      throw error;
    }

    throw new VisionError(
      `Failed to edit image: ${error instanceof Error ? error.message : String(error)}`,
      'EDIT_ERROR',
      config.IMAGE_PROVIDER,
      error instanceof Error ? error : undefined
    );
  }
}
