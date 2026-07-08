import type { Config } from '../../types/Config.js';
import { ConfigService } from '../../services/ConfigService.js';
import { VisionProviderFactory } from '../../providers/factory/ProviderFactory.js';
import { FileService } from '../../services/FileService.js';
import { analyze_image } from '../../tools/analyze_image.js';
import {
  parseOptions,
  formatOutput,
  handleError,
  parseArgs,
} from '../utils.js';

export async function runAnalyzeImage(
  args: string[],
  config: Config
): Promise<void> {
  // Parse arguments
  const { positional, options } = parseArgs(args);

  if (positional.length < 1) {
    console.error('Error: Image source required');
    console.error(
      'Usage: ai-vision analyze-image <source> --prompt <text> [--mode <mode>]'
    );
    console.error('Modes: general (default), palette, hierarchy, components');
    process.exit(1);
  }

  const imageSource = positional[0];
  const prompt = options.prompt;
  const mode = options.mode as
    | 'general'
    | 'palette'
    | 'hierarchy'
    | 'components'
    | undefined;

  if (!prompt) {
    console.error('Error: --prompt is required');
    process.exit(1);
  }

  // Validate mode if provided
  if (
    mode &&
    !['general', 'palette', 'hierarchy', 'components'].includes(mode)
  ) {
    console.error(
      `Error: Invalid mode "${mode}". Allowed modes: general, palette, hierarchy, components`
    );
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

  // Parse optional crop region: --crop "x,y,width,height" (pixels)
  let cropRegion:
    | { x: number; y: number; width: number; height: number }
    | undefined;
  if (options.crop) {
    const parts = options.crop.split(',').map(p => parseInt(p.trim(), 10));
    if (parts.length !== 4 || parts.some(p => isNaN(p))) {
      console.error(
        'Error: --crop must be "x,y,width,height" in pixels (e.g. --crop "100,200,640,360")'
      );
      process.exit(1);
    }
    cropRegion = {
      x: parts[0],
      y: parts[1],
      width: parts[2],
      height: parts[3],
    };
  }

  // Run tool
  try {
    const result = await analyze_image(
      { imageSource, prompt, mode, cropRegion, options: parseOptions(options) },
      config,
      imageProvider,
      imageFileService
    );

    console.log(formatOutput(result, 'json' in options));
  } catch (error) {
    handleError(error, 'json' in options);
  }
}
