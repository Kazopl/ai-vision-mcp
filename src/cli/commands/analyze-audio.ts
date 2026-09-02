import type { Config } from '../../types/Config.js';
import { VisionProviderFactory } from '../../providers/factory/ProviderFactory.js';
import { analyze_audio } from '../../tools/analyze_audio.js';
import {
  parseOptions,
  formatOutput,
  handleError,
  parseArgs,
} from '../utils.js';

export async function runAnalyzeAudio(
  args: string[],
  config: Config
): Promise<void> {
  const { positional, options } = parseArgs(args);

  if (positional.length < 1) {
    console.error('Error: Audio source required');
    console.error(
      'Usage: ai-vision analyze-audio <source> --prompt <text> [--json]'
    );
    process.exit(1);
  }

  const audioSource = positional[0];
  const prompt = options.prompt;

  if (!prompt) {
    console.error('Error: --prompt is required');
    process.exit(1);
  }

  const audioProvider = VisionProviderFactory.createProviderWithValidation(
    config,
    'video'
  );

  try {
    const result = await analyze_audio(
      { audioSource, prompt, options: parseOptions(options) },
      config,
      audioProvider
    );

    console.log(formatOutput(result, 'json' in options));
  } catch (error) {
    handleError(error, 'json' in options);
  }
}
