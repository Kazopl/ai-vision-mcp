import fs from 'node:fs';
import type { Config } from '../../types/Config.js';
import type { DecisionQuestion } from '../../types/Decision.js';
import { ConfigService } from '../../services/ConfigService.js';
import { FileService } from '../../services/FileService.js';
import { VisionProviderFactory } from '../../providers/factory/ProviderFactory.js';
import { evaluate_media } from '../../tools/evaluate_media.js';
import { handleError, parseArgs } from '../utils.js';

const USAGE = `Usage: ai-vision evaluate-media [sources...] (--ask <yes/no question> | --questions <json|@file>) [--context <text>] [--media-resolution low|medium|high|ultra_high] [--json]

  --ask "<question>"        One yes/no question (shortcut)
  --questions '<json>'      JSON array of questions, or @path/to/questions.json:
                            [{"id":"has_error","type":"yes_no","question":"Is an error visible?"},
                             {"id":"page","type":"choice","question":"Which page is this?","options":{"login":"Sign-in form","dashboard":"Metrics page","other":"Anything else"}},
                             {"id":"severity","type":"score","question":"How severe is the state shown?","levels":["Healthy","Degraded","Failing"]}]`;

function loadQuestions(options: Record<string, string>): DecisionQuestion[] {
  if (options.questions) {
    const raw = options.questions.startsWith('@')
      ? fs.readFileSync(options.questions.slice(1), 'utf8')
      : options.questions;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error('--questions must be a JSON array');
    }
    return parsed as DecisionQuestion[];
  }
  if (options.ask) {
    return [{ id: 'answer', type: 'yes_no', question: options.ask }];
  }
  return [];
}

export async function runEvaluateMedia(
  args: string[],
  config: Config
): Promise<void> {
  const { positional, options } = parseArgs(args);

  let questions: DecisionQuestion[];
  try {
    questions = loadQuestions(options);
  } catch (error) {
    console.error(
      `Error: could not read questions: ${error instanceof Error ? error.message : String(error)}`
    );
    console.error(USAGE);
    process.exit(1);
  }

  if (questions.length === 0 || (positional.length < 1 && !options.context)) {
    console.error(
      questions.length === 0
        ? 'Error: --ask or --questions is required'
        : 'Error: at least one media source or --context is required'
    );
    console.error(USAGE);
    process.exit(1);
  }

  const rawResolution =
    options['media-resolution'] === 'ultra-high'
      ? 'ultra_high'
      : options['media-resolution'];
  const mediaResolution =
    rawResolution === 'low' ||
    rawResolution === 'medium' ||
    rawResolution === 'high' ||
    rawResolution === 'ultra_high'
      ? rawResolution
      : undefined;

  const configService = ConfigService.getInstance();
  const imageProvider = VisionProviderFactory.createProviderWithValidation(
    config,
    'image'
  );
  const videoProvider = VisionProviderFactory.createProviderWithValidation(
    config,
    'video'
  );
  const imageFileService = new FileService(
    configService,
    'image',
    imageProvider as any
  );
  const videoFileService = new FileService(
    configService,
    'video',
    videoProvider as any
  );

  try {
    const result = await evaluate_media(
      {
        mediaSources: positional,
        context: options.context,
        questions,
        options: mediaResolution ? { mediaResolution } : undefined,
      },
      config,
      imageProvider,
      imageFileService,
      videoFileService
    );

    if ('json' in options) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(result.summary);
      console.log(
        `\n(${result.metadata.usage.inputTokens} input tokens, 0 output tokens, ${result.metadata.processingTime ?? '?'}ms)`
      );
    }
  } catch (error) {
    handleError(error, 'json' in options);
  }
}
