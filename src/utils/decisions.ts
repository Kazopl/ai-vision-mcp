/**
 * Pure helpers for evaluate_media: validate questions, translate them to the
 * Gemini Decisions API wire format, and map calibrated answers back into a
 * caller-friendly shape.
 */

import { VisionError } from '../types/Errors.js';
import {
  DECISION_LOW_CONFIDENCE_THRESHOLD,
  type DecisionAnswer,
  type DecisionQuestion,
} from '../types/Decision.js';

const QUESTION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const MAX_DECISION_QUESTIONS = 1000;
const MAX_OPTIONS_OR_LEVELS = 255;

/** Wire format of one question in a decisions.create request. */
export type ApiDecisionQuestion =
  | {
      type: 'noul';
      instructions: string;
      criteria?: { true_description?: string; false_description?: string };
    }
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'score'; instructions: string; criteria: string[] };

function invalid(message: string): VisionError {
  return new VisionError(message, 'INVALID_ARGUMENT');
}

/** Normalize choice options to the id -> description map the API expects. */
function normalizeOptions(question: DecisionQuestion): Record<string, string> {
  const { options, id } = question;
  if (!options) {
    throw invalid(`Question "${id}": type "choice" requires options (2-255)`);
  }
  const map: Record<string, string> = Array.isArray(options)
    ? Object.fromEntries(options.map(option => [String(option), '']))
    : Object.fromEntries(
        Object.entries(options).map(([key, value]) => [key, value ?? ''])
      );
  const keys = Object.keys(map);
  if (Array.isArray(options) && keys.length !== options.length) {
    throw invalid(`Question "${id}": option ids must be unique`);
  }
  if (keys.length < 2 || keys.length > MAX_OPTIONS_OR_LEVELS) {
    throw invalid(
      `Question "${id}": a choice needs 2-${MAX_OPTIONS_OR_LEVELS} options (got ${keys.length})`
    );
  }
  for (const key of keys) {
    if (!key || key !== key.trim() || key.length > 128) {
      throw invalid(
        `Question "${id}": option id "${key}" must be 1-128 characters with no leading or trailing spaces`
      );
    }
  }
  return map;
}

/**
 * Validate questions and convert them to the Decisions API map. Throws a
 * VisionError naming the offending question for anything the API would
 * reject, so callers get a precise message without a round trip.
 */
export function buildDecisionQuestions(
  questions: DecisionQuestion[]
): Record<string, ApiDecisionQuestion> {
  if (!Array.isArray(questions) || questions.length === 0) {
    throw invalid('questions is required (1 or more)');
  }
  if (questions.length > MAX_DECISION_QUESTIONS) {
    throw invalid(
      `Too many questions: ${questions.length} (maximum ${MAX_DECISION_QUESTIONS} per call)`
    );
  }

  const result: Record<string, ApiDecisionQuestion> = {};
  for (const question of questions) {
    const { id, type } = question;
    if (typeof id !== 'string' || !QUESTION_ID_PATTERN.test(id)) {
      throw invalid(
        `Invalid question id "${String(id)}": use 1-64 characters from A-Z, a-z, 0-9, "_" and "-"`
      );
    }
    if (id in result) {
      throw invalid(`Duplicate question id "${id}"`);
    }
    const text =
      typeof question.question === 'string' ? question.question.trim() : '';
    if (!text) {
      throw invalid(
        `Question "${id}": question text is required (the model never sees the id, so write the full question)`
      );
    }

    if (type === 'yes_no') {
      const criteria: {
        true_description?: string;
        false_description?: string;
      } = {};
      if (question.yesMeans?.trim()) {
        criteria.true_description = question.yesMeans.trim();
      }
      if (question.noMeans?.trim()) {
        criteria.false_description = question.noMeans.trim();
      }
      result[id] = {
        type: 'noul',
        instructions: text,
        ...(Object.keys(criteria).length > 0 ? { criteria } : {}),
      };
    } else if (type === 'choice') {
      result[id] = {
        type: 'choice',
        instructions: text,
        criteria: normalizeOptions(question),
      };
    } else if (type === 'score') {
      const levels = (question.levels ?? []).map(level => String(level).trim());
      if (levels.length < 2 || levels.length > MAX_OPTIONS_OR_LEVELS) {
        throw invalid(
          `Question "${id}": type "score" requires 2-${MAX_OPTIONS_OR_LEVELS} levels ordered lowest to highest (got ${levels.length})`
        );
      }
      if (levels.some(level => !level)) {
        throw invalid(
          `Question "${id}": score levels must be non-empty strings`
        );
      }
      result[id] = { type: 'score', instructions: text, criteria: levels };
    } else {
      throw invalid(
        `Question "${id}": unknown type "${String(type)}" (use "yes_no", "choice" or "score")`
      );
    }
  }
  return result;
}

function isLowConfidence(confidence: number): boolean {
  return confidence < DECISION_LOW_CONFIDENCE_THRESHOLD;
}

/**
 * Map raw Decisions API answers to DecisionAnswer objects. Questions the API
 * did not answer are omitted (the caller compares against what it asked).
 */
export function mapDecisionAnswers(
  apiAnswers: Record<string, any> | undefined,
  questions: DecisionQuestion[]
): Record<string, DecisionAnswer> {
  const answers: Record<string, DecisionAnswer> = {};
  if (!apiAnswers) return answers;

  for (const question of questions) {
    const raw = apiAnswers[question.id];
    if (!raw) continue;
    const confidence = typeof raw.confidence === 'number' ? raw.confidence : 0;

    if (raw.type === 'noul' && typeof raw.noul === 'number') {
      answers[question.id] = {
        type: 'yes_no',
        answer: raw.noul >= 0.5,
        probability: raw.noul,
        confidence,
        lowConfidence: isLowConfidence(confidence),
      };
    } else if (raw.type === 'choice' && typeof raw.choice === 'string') {
      answers[question.id] = {
        type: 'choice',
        answer: raw.choice,
        probabilities: raw.probabilities ?? {},
        confidence,
        lowConfidence: isLowConfidence(confidence),
      };
    } else if (raw.type === 'score' && typeof raw.score === 'number') {
      const probabilities: Record<string, number> = raw.probabilities ?? {};
      // Most likely single level (the expected score can fall between levels)
      let level = Math.round(raw.score);
      let best = -1;
      for (const [index, probability] of Object.entries(probabilities)) {
        if (typeof probability === 'number' && probability > best) {
          best = probability;
          level = Number(index);
        }
      }
      const legend: Record<string, string> = raw.legend ?? {};
      answers[question.id] = {
        type: 'score',
        score: raw.score,
        level,
        levelDescription:
          legend[String(level)] ?? question.levels?.[level] ?? '',
        probabilities,
        confidence,
        lowConfidence: isLowConfidence(confidence),
      };
    }
  }
  return answers;
}

const pct = (value: number): string => `${Math.round(value * 100)}%`;

/** One readable line per answered question, in the order they were asked. */
export function formatDecisionSummary(
  answers: Record<string, DecisionAnswer>,
  questions: DecisionQuestion[]
): string {
  const lines: string[] = [];
  for (const question of questions) {
    const answer = answers[question.id];
    if (!answer) {
      lines.push(`${question.id}: (no answer returned)`);
      continue;
    }
    const flag = answer.lowConfidence ? ' [low confidence]' : '';
    if (answer.type === 'yes_no') {
      lines.push(
        `${question.id}: ${answer.answer ? 'YES' : 'NO'} (P(yes)=${pct(answer.probability)}, confidence ${pct(answer.confidence)})${flag}`
      );
    } else if (answer.type === 'choice') {
      lines.push(
        `${question.id}: ${answer.answer} (confidence ${pct(answer.confidence)})${flag}`
      );
    } else {
      const maxLevel = (question.levels?.length ?? 1) - 1;
      lines.push(
        `${question.id}: level ${answer.level}/${maxLevel} "${answer.levelDescription}" (expected score ${answer.score.toFixed(2)}, confidence ${pct(answer.confidence)})${flag}`
      );
    }
  }
  return lines.join('\n');
}

/**
 * The SDK reports Decisions API failures as
 *   `400 API error occurred: Status 400 ... Body: {"error":{"message":"...","code":"..."}}`
 * Pull out the server's own message so callers see the actionable part.
 */
export function extractDecisionsErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const bodyIndex = raw.indexOf('Body:');
  if (bodyIndex !== -1) {
    try {
      const parsed = JSON.parse(raw.slice(bodyIndex + 5).trim());
      const message = parsed?.error?.message;
      if (typeof message === 'string' && message.trim()) {
        const code = parsed?.error?.code;
        return code ? `${message.trim()} (${code})` : message.trim();
      }
    } catch {
      // fall through to the raw message
    }
  }
  return raw;
}
