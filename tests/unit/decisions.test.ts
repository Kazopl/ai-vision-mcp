import { describe, expect, test } from 'vitest';
import {
  buildDecisionQuestions,
  extractDecisionsErrorMessage,
  formatDecisionSummary,
  mapDecisionAnswers,
} from '../../src/utils/decisions.js';
import type { DecisionQuestion } from '../../src/types/Decision.js';

describe('buildDecisionQuestions', () => {
  test('maps yes_no to the API "noul" type, with criteria only when given', () => {
    const api = buildDecisionQuestions([
      { id: 'plain', type: 'yes_no', question: ' Is an error visible? ' },
      {
        id: 'with_criteria',
        type: 'yes_no',
        question: 'Is the customer reporting a defect?',
        yesMeans: 'The product itself is broken.',
        noMeans: 'Preference or shipping complaint.',
      },
    ]);

    expect(api.plain).toEqual({
      type: 'noul',
      instructions: 'Is an error visible?',
    });
    expect(api.with_criteria).toEqual({
      type: 'noul',
      instructions: 'Is the customer reporting a defect?',
      criteria: {
        true_description: 'The product itself is broken.',
        false_description: 'Preference or shipping complaint.',
      },
    });
  });

  test('maps choice options from an object or a plain list', () => {
    const api = buildDecisionQuestions([
      {
        id: 'page',
        type: 'choice',
        question: 'Which page is this?',
        options: { login: 'Sign-in form', other: 'Anything else' },
      },
      {
        id: 'area',
        type: 'choice',
        question: 'Which area?',
        options: ['auth', 'export'],
      },
    ]);

    expect(api.page).toEqual({
      type: 'choice',
      instructions: 'Which page is this?',
      criteria: { login: 'Sign-in form', other: 'Anything else' },
    });
    // Self-explanatory ids use an empty description, as the API documents
    expect(api.area).toEqual({
      type: 'choice',
      instructions: 'Which area?',
      criteria: { auth: '', export: '' },
    });
  });

  test('maps score levels in order', () => {
    const api = buildDecisionQuestions([
      {
        id: 'severity',
        type: 'score',
        question: 'How severe?',
        levels: ['Cosmetic', 'Workaround available', 'Fully blocked'],
      },
    ]);

    expect(api.severity).toEqual({
      type: 'score',
      instructions: 'How severe?',
      criteria: ['Cosmetic', 'Workaround available', 'Fully blocked'],
    });
  });

  test.each([
    ['no questions', [], /questions is required/],
    [
      'invalid id characters',
      [{ id: 'bad id!', type: 'yes_no', question: 'ok?' }],
      /Invalid question id "bad id!"/,
    ],
    [
      'id longer than 64 characters',
      [{ id: 'x'.repeat(65), type: 'yes_no', question: 'ok?' }],
      /Invalid question id/,
    ],
    [
      'duplicate ids',
      [
        { id: 'a', type: 'yes_no', question: 'one?' },
        { id: 'a', type: 'yes_no', question: 'two?' },
      ],
      /Duplicate question id "a"/,
    ],
    [
      'empty question text',
      [{ id: 'a', type: 'yes_no', question: '   ' }],
      /question text is required/,
    ],
    [
      'choice without options',
      [{ id: 'a', type: 'choice', question: 'which?' }],
      /requires options/,
    ],
    [
      'choice with a single option',
      [{ id: 'a', type: 'choice', question: 'which?', options: ['only'] }],
      /needs 2-255 options \(got 1\)/,
    ],
    [
      'choice with duplicate list options',
      [{ id: 'a', type: 'choice', question: 'which?', options: ['x', 'x'] }],
      /option ids must be unique/,
    ],
    [
      'option id with surrounding spaces',
      [
        {
          id: 'a',
          type: 'choice',
          question: 'which?',
          options: { ' padded': 'x', ok: 'y' },
        },
      ],
      /no leading or trailing spaces/,
    ],
    [
      'score with one level',
      [{ id: 'a', type: 'score', question: 'how?', levels: ['only'] }],
      /requires 2-255 levels/,
    ],
    [
      'score with an empty level',
      [{ id: 'a', type: 'score', question: 'how?', levels: ['low', ' '] }],
      /levels must be non-empty/,
    ],
    [
      'unknown type',
      [{ id: 'a', type: 'rank', question: 'how?' }],
      /unknown type "rank"/,
    ],
  ])('rejects %s', (_label, questions, pattern) => {
    expect(() =>
      buildDecisionQuestions(questions as unknown as DecisionQuestion[])
    ).toThrow(pattern);
  });

  test('rejects more than 1000 questions', () => {
    const many = Array.from({ length: 1001 }, (_, i) => ({
      id: `q${i}`,
      type: 'yes_no' as const,
      question: 'ok?',
    }));
    expect(() => buildDecisionQuestions(many)).toThrow(/Too many questions/);
  });
});

describe('mapDecisionAnswers', () => {
  const questions: DecisionQuestion[] = [
    { id: 'shows_error', type: 'yes_no', question: 'Error visible?' },
    { id: 'no_login', type: 'yes_no', question: 'Login form?' },
    {
      id: 'page',
      type: 'choice',
      question: 'Which page?',
      options: ['dashboard', 'form', 'other'],
    },
    {
      id: 'severity',
      type: 'score',
      question: 'How severe?',
      levels: ['healthy', 'degraded', 'failing', 'outage'],
    },
    { id: 'unanswered', type: 'yes_no', question: 'Never returned?' },
  ];

  // Shapes copied from real gemini-decision-1 responses
  const apiAnswers = {
    shows_error: { type: 'noul', noul: 0.914, confidence: 0.914 },
    no_login: { type: 'noul', noul: 0.05, confidence: 0.95 },
    page: {
      type: 'choice',
      choice: 'dashboard',
      confidence: 0.939,
      probabilities: { dashboard: 0.939, form: 0.001, other: 0.06 },
    },
    severity: {
      type: 'score',
      score: 1.718,
      confidence: 0.578,
      probabilities: { '0': 0.024, '1': 0.316, '2': 0.578, '3': 0.082 },
      legend: {
        '0': 'healthy',
        '1': 'degraded',
        '2': 'failing',
        '3': 'outage',
      },
    },
  };

  test('maps yes/no answers, taking "yes" at P >= 0.5', () => {
    const answers = mapDecisionAnswers(apiAnswers, questions);

    expect(answers.shows_error).toEqual({
      type: 'yes_no',
      answer: true,
      probability: 0.914,
      confidence: 0.914,
      lowConfidence: false,
    });
    // A confident "no": low P(yes) but high confidence
    expect(answers.no_login).toMatchObject({
      answer: false,
      probability: 0.05,
      confidence: 0.95,
      lowConfidence: false,
    });
  });

  test('maps choice answers with all option probabilities', () => {
    const answers = mapDecisionAnswers(apiAnswers, questions);
    expect(answers.page).toEqual({
      type: 'choice',
      answer: 'dashboard',
      probabilities: { dashboard: 0.939, form: 0.001, other: 0.06 },
      confidence: 0.939,
      lowConfidence: false,
    });
  });

  test('maps score answers to the most likely level and flags low confidence', () => {
    const answers = mapDecisionAnswers(apiAnswers, questions);
    expect(answers.severity).toMatchObject({
      type: 'score',
      score: 1.718,
      // argmax of the probabilities, not round(expected score)
      level: 2,
      levelDescription: 'failing',
      confidence: 0.578,
      lowConfidence: true,
    });
  });

  test('uses the most probable level even when the expected score rounds elsewhere', () => {
    const answers = mapDecisionAnswers(
      {
        severity: {
          type: 'score',
          // Bimodal: expected value ~1.5 rounds to 2, but level 0 is most likely
          score: 1.5,
          confidence: 0.5,
          probabilities: { '0': 0.5, '1': 0, '2': 0, '3': 0.5 },
          legend: { '0': 'healthy', '3': 'outage' },
        },
      },
      questions
    );
    expect(answers.severity).toMatchObject({
      level: 0,
      levelDescription: 'healthy',
    });
  });

  test('omits questions the API did not answer', () => {
    const answers = mapDecisionAnswers(apiAnswers, questions);
    expect(answers).not.toHaveProperty('unanswered');
    expect(mapDecisionAnswers(undefined, questions)).toEqual({});
  });
});

describe('formatDecisionSummary', () => {
  test('writes one line per question in the order asked', () => {
    const questions: DecisionQuestion[] = [
      { id: 'err', type: 'yes_no', question: 'Error?' },
      { id: 'page', type: 'choice', question: 'Page?', options: ['a', 'b'] },
      {
        id: 'sev',
        type: 'score',
        question: 'Severity?',
        levels: ['fine', 'bad', 'terrible'],
      },
      { id: 'missing', type: 'yes_no', question: 'Missing?' },
    ];
    const summary = formatDecisionSummary(
      {
        err: {
          type: 'yes_no',
          answer: true,
          probability: 0.92,
          confidence: 0.92,
          lowConfidence: false,
        },
        page: {
          type: 'choice',
          answer: 'a',
          probabilities: { a: 0.96, b: 0.04 },
          confidence: 0.96,
          lowConfidence: false,
        },
        sev: {
          type: 'score',
          score: 1.38,
          level: 1,
          levelDescription: 'bad',
          probabilities: { '0': 0.05, '1': 0.52, '2': 0.43 },
          confidence: 0.52,
          lowConfidence: true,
        },
      },
      questions
    );

    expect(summary.split('\n')).toEqual([
      'err: YES (P(yes)=92%, confidence 92%)',
      'page: a (confidence 96%)',
      'sev: level 1/2 "bad" (expected score 1.38, confidence 52%) [low confidence]',
      'missing: (no answer returned)',
    ]);
  });
});

describe('extractDecisionsErrorMessage', () => {
  test('pulls the server message and code out of the SDK error text', () => {
    const error = new Error(
      '400 API error occurred: Status 400 Content-Type "application/json; charset=UTF-8" Body: {"error":{"message":"* CreateDecisionRequest.questions[bad key!]: question IDs must be 1-64 characters matching [A-Za-z0-9_-]+\\n","code":"invalid_request"}}'
    );
    expect(extractDecisionsErrorMessage(error)).toBe(
      '* CreateDecisionRequest.questions[bad key!]: question IDs must be 1-64 characters matching [A-Za-z0-9_-]+ (invalid_request)'
    );
  });

  test('falls back to the raw message when there is no JSON body', () => {
    expect(
      extractDecisionsErrorMessage(
        new Error(
          '404 API error occurred: Status 404 Content-Type text/html. Body: ""'
        )
      )
    ).toContain('404 API error occurred');
    expect(extractDecisionsErrorMessage('plain string')).toBe('plain string');
  });
});
