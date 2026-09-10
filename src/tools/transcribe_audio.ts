/**
 * MCP Tool: transcribe_audio
 * Dedicated speech-to-text using gemini-3.5-transcribe: word-level
 * timestamps, speaker diarization, custom vocabulary biasing, and
 * SMART mode (filler removal + formatting). 85+ languages, auto-detected.
 */

import type {
  AnalysisResult,
  TranscriptionOptions,
  VisionProvider,
} from '../types/Providers.js';
import type { Config } from '../types/Config.js';
import { VisionError } from '../types/Errors.js';

export interface TranscribeAudioArgs {
  audioSource: string; // URL, base64 data URI (data:audio/...), local file path, or files/ reference
  options?: TranscriptionOptions;
}

export async function transcribe_audio(
  args: TranscribeAudioArgs,
  config: Config,
  audioProvider: VisionProvider
): Promise<AnalysisResult> {
  try {
    if (!args.audioSource) {
      throw new VisionError('audioSource is required', 'MISSING_ARGUMENT');
    }
    if (!audioProvider.transcribeAudio) {
      throw new VisionError(
        `Provider ${config.VIDEO_PROVIDER} does not support dedicated transcription (Gemini API only)`,
        'UNSUPPORTED_OPERATION'
      );
    }

    return await audioProvider.transcribeAudio(args.audioSource, args.options);
  } catch (error) {
    console.error('Error in transcribe_audio tool:', error);

    if (error instanceof VisionError) {
      throw error;
    }

    throw new VisionError(
      `Failed to transcribe audio: ${error instanceof Error ? error.message : String(error)}`,
      'TRANSCRIPTION_ERROR',
      config.VIDEO_PROVIDER,
      error instanceof Error ? error : undefined
    );
  }
}
