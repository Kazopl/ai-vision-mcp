import type { Config } from '../../types/Config.js';
import { ConfigService } from '../../services/ConfigService.js';
import { VisionProviderFactory } from '../../providers/factory/ProviderFactory.js';
import { FileService } from '../../services/FileService.js';
import { segment_objects_in_image } from '../../tools/segment_objects_in_image.js';
import {
  parseOptions,
  formatOutput,
  handleError,
  parseArgs,
} from '../utils.js';

export async function runSegmentObjects(
  args: string[],
  config: Config
): Promise<void> {
  // Parse arguments
  const { positional, options } = parseArgs(args);

  if (positional.length < 1) {
    console.error('Error: Image source required');
    console.error(
      'Usage: ai-vision segment-objects <source> --prompt <text> [--output <path>]'
    );
    process.exit(1);
  }

  const imageSource = positional[0];
  const prompt = options.prompt;
  const outputFilePath = options.output;

  if (!prompt) {
    console.error('Error: --prompt is required');
    process.exit(1);
  }

  // Initialize services
  const configService = ConfigService.getInstance();
  const imageProvider = VisionProviderFactory.createProviderWithValidation(
    config,
    'image'
  );
  const imageFileService = new FileService(
    configService,
    'image',
    imageProvider as any
  );

  // Run tool
  try {
    const result = await segment_objects_in_image(
      {
        imageSource,
        prompt,
        outputFilePath,
        options: parseOptions(options),
      },
      config,
      imageProvider,
      imageFileService
    );

    console.log(formatOutput(result, 'json' in options));
  } catch (error) {
    handleError(error, 'json' in options);
  }
}
