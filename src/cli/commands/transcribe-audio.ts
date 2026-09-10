import type { Config } from '../../types/Config.js';
import type { TranscriptionOptions } from '../../types/Providers.js';
import { VisionProviderFactory } from '../../providers/factory/ProviderFactory.js';
import { transcribe_audio } from '../../tools/transcribe_audio.js';
import { formatOutput, handleError, parseArgs } from '../utils.js';

export async function runTranscribeAudio(
  args: string[],
  config: Config
): Promise<void> {
  const { positional, options } = parseArgs(args);

  if (positional.length < 1) {
    console.error('Error: Audio source required');
    console.error(
      'Usage: ai-vision transcribe-audio <source> [--diarization] [--word-timestamps] [--mode verbatim|smart] [--languages en-US,ro-RO] [--vocabulary term1,term2] [--json]'
    );
    process.exit(1);
  }

  const audioSource = positional[0];

  const transcriptionOptions: TranscriptionOptions = {};
  if ('diarization' in options) transcriptionOptions.diarization = true;
  if ('word-timestamps' in options) transcriptionOptions.wordTimestamps = true;
  if (options.mode === 'verbatim' || options.mode === 'smart') {
    transcriptionOptions.mode = options.mode;
  }
  if (options.languages) {
    transcriptionOptions.languageCodes = options.languages
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
  }
  if (options.vocabulary) {
    transcriptionOptions.customVocabulary = options.vocabulary
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
  }
  if (options.model) transcriptionOptions.model = options.model;

  const audioProvider = VisionProviderFactory.createProviderWithValidation(
    config,
    'video'
  );

  try {
    const result = await transcribe_audio(
      { audioSource, options: transcriptionOptions },
      config,
      audioProvider
    );

    console.log(formatOutput(result, 'json' in options));
  } catch (error) {
    handleError(error, 'json' in options);
  }
}
