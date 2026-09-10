/**
 * MCP Tool: analyze_document
 * Analyzes documents (PDF native vision: layouts, tables, charts, diagrams,
 * handwriting; plus text formats) using Gemini's document understanding.
 */

import type { AnalysisOptions, AnalysisResult } from '../types/Providers.js';
import type { VisionProvider } from '../types/Providers.js';
import type { Config } from '../types/Config.js';
import { VisionError } from '../types/Errors.js';
import { FUNCTION_NAMES } from '../constants/FunctionNames.js';

export interface AnalyzeDocumentArgs {
  documentSource: string; // URL, base64 data URI (data:application/pdf...), local file path, or files/ reference
  prompt: string;
  options?: AnalysisOptions;
}

export async function analyze_document(
  args: AnalyzeDocumentArgs,
  config: Config,
  documentProvider: VisionProvider
): Promise<AnalysisResult> {
  try {
    if (!args.documentSource) {
      throw new VisionError('documentSource is required', 'MISSING_ARGUMENT');
    }
    if (!args.prompt) {
      throw new VisionError('prompt is required', 'MISSING_ARGUMENT');
    }
    if (!documentProvider.analyzeDocument) {
      throw new VisionError(
        `Provider ${config.IMAGE_PROVIDER} does not support document analysis`,
        'UNSUPPORTED_OPERATION'
      );
    }

    const options: AnalysisOptions = {
      temperature: config.TEMPERATURE_FOR_IMAGE ?? config.TEMPERATURE,
      topP: config.TOP_P_FOR_IMAGE ?? config.TOP_P,
      topK: config.TOP_K_FOR_IMAGE ?? config.TOP_K,
      maxTokens: config.MAX_TOKENS_FOR_IMAGE ?? config.MAX_TOKENS,
      taskType: 'image',
      functionName: FUNCTION_NAMES.ANALYZE_DOCUMENT,
      ...args.options, // User options override defaults
    };

    return await documentProvider.analyzeDocument(
      args.documentSource,
      args.prompt,
      options
    );
  } catch (error) {
    console.error('Error in analyze_document tool:', error);

    if (error instanceof VisionError) {
      throw error;
    }

    throw new VisionError(
      `Failed to analyze document: ${error instanceof Error ? error.message : String(error)}`,
      'ANALYSIS_ERROR',
      config.IMAGE_PROVIDER,
      error instanceof Error ? error : undefined
    );
  }
}
