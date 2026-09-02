/**
 * MCP Tool: analyze_audio
 * Analyzes audio files (transcription, summarization, speaker identification,
 * sound description) using Gemini's native audio understanding.
 */

import type { AnalysisOptions, AnalysisResult } from '../types/Providers.js';
import type { VisionProvider } from '../types/Providers.js';
import type { Config } from '../types/Config.js';
import { VisionError } from '../types/Errors.js';
import { FUNCTION_NAMES } from '../constants/FunctionNames.js';

export interface AnalyzeAudioArgs {
  audioSource: string; // URL, base64 data URI (data:audio/...), local file path, or files/ reference
  prompt: string;
  options?: AnalysisOptions;
}

export async function analyze_audio(
  args: AnalyzeAudioArgs,
  config: Config,
  audioProvider: VisionProvider
): Promise<AnalysisResult> {
  try {
    if (!args.audioSource) {
      throw new VisionError('audioSource is required', 'MISSING_ARGUMENT');
    }
    if (!args.prompt) {
      throw new VisionError('prompt is required', 'MISSING_ARGUMENT');
    }
    if (!audioProvider.analyzeAudio) {
      throw new VisionError(
        `Provider ${config.VIDEO_PROVIDER} does not support audio analysis`,
        'UNSUPPORTED_OPERATION'
      );
    }

    const options: AnalysisOptions = {
      temperature:
        config.TEMPERATURE_FOR_ANALYZE_AUDIO ??
        config.TEMPERATURE_FOR_VIDEO ??
        config.TEMPERATURE,
      topP:
        config.TOP_P_FOR_ANALYZE_AUDIO ??
        config.TOP_P_FOR_VIDEO ??
        config.TOP_P,
      topK:
        config.TOP_K_FOR_ANALYZE_AUDIO ??
        config.TOP_K_FOR_VIDEO ??
        config.TOP_K,
      maxTokens:
        config.MAX_TOKENS_FOR_ANALYZE_AUDIO ??
        config.MAX_TOKENS_FOR_VIDEO ??
        config.MAX_TOKENS,
      taskType: 'video',
      functionName: FUNCTION_NAMES.ANALYZE_AUDIO,
      ...args.options, // User options override defaults
    };

    return await audioProvider.analyzeAudio(
      args.audioSource,
      args.prompt,
      options
    );
  } catch (error) {
    console.error('Error in analyze_audio tool:', error);

    if (error instanceof VisionError) {
      throw error;
    }

    throw new VisionError(
      `Failed to analyze audio: ${error instanceof Error ? error.message : String(error)}`,
      'ANALYSIS_ERROR',
      config.VIDEO_PROVIDER,
      error instanceof Error ? error : undefined
    );
  }
}
