import type { Config } from '../../types/Config.js';
import { VisionProviderFactory } from '../../providers/factory/ProviderFactory.js';
import { analyze_document } from '../../tools/analyze_document.js';
import {
  parseOptions,
  formatOutput,
  handleError,
  parseArgs,
} from '../utils.js';

export async function runAnalyzeDocument(
  args: string[],
  config: Config
): Promise<void> {
  const { positional, options } = parseArgs(args);

  if (positional.length < 1) {
    console.error('Error: Document source required');
    console.error(
      'Usage: ai-vision analyze-document <source> --prompt <text> [--json]'
    );
    process.exit(1);
  }

  const documentSource = positional[0];
  const prompt = options.prompt;

  if (!prompt) {
    console.error('Error: --prompt is required');
    process.exit(1);
  }

  const documentProvider = VisionProviderFactory.createProviderWithValidation(
    config,
    'image'
  );

  try {
    const result = await analyze_document(
      { documentSource, prompt, options: parseOptions(options) },
      config,
      documentProvider
    );

    console.log(formatOutput(result, 'json' in options));
  } catch (error) {
    handleError(error, 'json' in options);
  }
}
