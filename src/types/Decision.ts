/**
 * Types for evaluate_media (Gemini Decisions API, gemini-decision-1).
 *
 * The Decisions API answers closed-ended questions about text, images,
 * video, audio and PDFs with calibrated probabilities and zero output
 * tokens. Every question is scored independently against the shared input
 * in a single forward pass.
 */

export type DecisionQuestionType = 'yes_no' | 'choice' | 'score';

export interface DecisionQuestion {
  /** Answer key: 1-64 chars of [A-Za-z0-9_-]. The model never sees it. */
  id: string;
  type: DecisionQuestionType;
  /** The full question. Write it out completely; ids are not shown to the model. */
  question: string;
  /** yes_no: what "yes" means, when the question alone is ambiguous */
  yesMeans?: string;
  /** yes_no: what "no" means */
  noMeans?: string;
  /**
   * choice: option id -> description of when it applies, or a plain list of
   * self-explanatory option ids. 2-255 options.
   */
  options?: Record<string, string> | string[];
  /** score: level descriptions ordered lowest to highest. 2-255 levels. */
  levels?: string[];
}

/** A media block already resolved to inline data or a Files API URI. */
export interface DecisionMediaInput {
  kind: 'image' | 'video' | 'audio' | 'document';
  mimeType: string;
  /** Base64 bytes (no data: prefix) */
  data?: string;
  /** Files API URI */
  uri?: string;
}

export interface EvaluateMediaOptions {
  /** Per-block token resolution for images and video (ultra_high: images only) */
  mediaResolution?: 'low' | 'medium' | 'high' | 'ultra_high';
}

interface DecisionAnswerBase {
  /** Estimated probability (0-1) that the top answer is right */
  confidence: number;
  /** True when confidence is below the caller-visible threshold (0.7) */
  lowConfidence: boolean;
}

export interface YesNoAnswer extends DecisionAnswerBase {
  type: 'yes_no';
  answer: boolean;
  /** Calibrated P(yes), always within 0.01-0.99 */
  probability: number;
}

export interface ChoiceAnswer extends DecisionAnswerBase {
  type: 'choice';
  /** The most likely option id */
  answer: string;
  /** Calibrated probability of every option (sums to 1) */
  probabilities: Record<string, number>;
}

export interface ScoreAnswer extends DecisionAnswerBase {
  type: 'score';
  /** Probability-weighted average of level indices (0-based); may fall between levels */
  score: number;
  /** Index of the single most likely level */
  level: number;
  /** Description of the most likely level */
  levelDescription: string;
  /** Calibrated probability of every level index (sums to 1) */
  probabilities: Record<string, number>;
}

export type DecisionAnswer = YesNoAnswer | ChoiceAnswer | ScoreAnswer;

export interface EvaluateMediaResult {
  answers: Record<string, DecisionAnswer>;
  /** One readable line per question */
  summary: string;
  metadata: {
    model: string;
    provider: string;
    usage: {
      inputTokens: number;
      /** Always 0: the Decisions API generates no text */
      outputTokens: number;
      inputTokensByModality?: Record<string, number>;
    };
    processingTime?: number;
    /** How many media blocks were evaluated */
    mediaCount: number;
  };
}

export interface EvaluateMediaArgs {
  /** 0-N media sources: image, video, audio or PDF (path, URL, data URI, files/ ref) */
  mediaSources?: string[];
  /** Optional text context shared by all questions (or the whole input when no media) */
  context?: string;
  questions: DecisionQuestion[];
  options?: EvaluateMediaOptions;
}

/** Confidence below this is flagged as lowConfidence in answers. */
export const DECISION_LOW_CONFIDENCE_THRESHOLD = 0.7;
