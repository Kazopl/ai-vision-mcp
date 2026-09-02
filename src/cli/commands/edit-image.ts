import type { Config } from '../../types/Config.js';
import { VisionProviderFactory } from '../../providers/factory/ProviderFactory.js';
import { edit_image } from '../../tools/edit_image.js';
import { handleError, parseArgs } from '../utils.js';

export async function runEditImage(
  args: string[],
  config: Config
): Promise<void> {
  const { positional, options } = parseArgs(args);

  if (positional.length < 1) {
    console.error('Error: At least one image source required');
    console.error(
      'Usage: ai-vision edit-image <source...> --prompt <text> [--output <path>] [--aspect-ratio <r>] [--image-size 512|1K|2K|4K]'
    );
    process.exit(1);
  }

  const prompt = options.prompt;
  if (!prompt) {
    console.error('Error: --prompt is required');
    process.exit(1);
  }

  const imageProvider = VisionProviderFactory.createProviderWithValidation(
    config,
    'image'
  );

  try {
    const result = await edit_image(
      {
        imageSources: positional,
        prompt,
        outputFilePath: options.output,
        aspectRatio: options['aspect-ratio'],
        imageSize: options['image-size'],
      },
      config,
      imageProvider
    );

    if ('json' in options) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(result.summary);
    }
  } catch (error) {
    handleError(error, 'json' in options);
  }
}
