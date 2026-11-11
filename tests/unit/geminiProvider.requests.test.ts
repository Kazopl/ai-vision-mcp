import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const generateContentMock = vi.fn();
const filesGetMock = vi.fn();
const decisionsCreateMock = vi.fn();
const clientOptions: any[] = [];

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(function GoogleGenAI(
    this: unknown,
    options: any
  ) {
    clientOptions.push(options);
    return {
      models: { generateContent: generateContentMock },
      files: { get: filesGetMock, upload: vi.fn(), delete: vi.fn() },
      decisions: { create: decisionsCreateMock },
    } as any;
  }),
  setDefaultBaseUrls: vi.fn(),
}));

import { GeminiProvider } from '../../src/providers/gemini/GeminiProvider.js';
import { ConfigService } from '../../src/services/ConfigService.js';
import {
  getGeminiVersion,
  parseDurationSeconds,
  supportsAgenticVideo,
} from '../../src/providers/base/VisionProvider.js';

const IMAGE = 'data:image/png;base64,iVBORw0KGgo=';
const VIDEO_FILE =
  'https://generativelanguage.googleapis.com/v1beta/files/video123';

/** Env vars these tests control; restored after each test. */
const ENV_KEYS = [
  'GEMINI_API_KEY',
  'GEMINI_API_VERSION',
  'GEMINI_STORE_REQUESTS',
  'MAX_TOKENS',
  'THINKING_LEVEL',
  'THINKING_LEVEL_FOR_IMAGE',
  'THINKING_LEVEL_FOR_VIDEO',
  'VIDEO_PROCESSING',
  'VIDEO_AGENTIC_MIN_DURATION',
  'MEDIA_RESOLUTION',
  'MEDIA_RESOLUTION_FOR_IMAGE',
  'MEDIA_RESOLUTION_FOR_VIDEO',
  'EDIT_IMAGE_MODEL',
  'IMAGE_MODEL',
  'VIDEO_MODEL',
  'IMAGE_PROVIDER',
  'VIDEO_PROVIDER',
  'SAFETY_THRESHOLD',
  'SERVICE_TIER',
  'AGENTIC_VISION',
];
const savedEnv: Record<string, string | undefined> = {};

/**
 * Build a provider the way production does: the request model comes from
 * IMAGE_MODEL / VIDEO_MODEL in the environment (read by ConfigService), so
 * the singleton is reset after setting them.
 */
function createProvider(
  models: { imageModel?: string; videoModel?: string } = {}
): GeminiProvider {
  const imageModel = models.imageModel ?? 'gemini-3.8-flash';
  const videoModel = models.videoModel ?? 'gemini-3.8-flash';
  process.env.IMAGE_MODEL = imageModel;
  process.env.VIDEO_MODEL = videoModel;
  (ConfigService as any).instance = undefined;
  return new GeminiProvider({
    apiKey: 'test-key',
    baseUrl: 'https://generativelanguage.googleapis.com',
    imageModel,
    videoModel,
  } as any);
}

function okResponse(overrides: Record<string, unknown> = {}) {
  return {
    text: 'ok',
    candidates: [
      { finishReason: 'STOP', content: { parts: [{ text: 'ok' }] } },
    ],
    usageMetadata: {
      promptTokenCount: 10,
      candidatesTokenCount: 2,
      totalTokenCount: 12,
    },
    modelVersion: 'test-model',
    responseId: 'response-1',
    ...overrides,
  };
}

const lastRequest = () => generateContentMock.mock.calls.at(-1)![0];

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  process.env.GEMINI_API_KEY = 'test-key';
  clientOptions.length = 0;
  generateContentMock.mockReset();
  generateContentMock.mockResolvedValue(okResponse());
  filesGetMock.mockReset();
  decisionsCreateMock.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  (ConfigService as any).instance = undefined;
  vi.restoreAllMocks();
});

describe('model id helpers', () => {
  test('getGeminiVersion parses generations, including Gemini 4', () => {
    expect(getGeminiVersion('gemini-3.8-flash')).toBe(3.8);
    expect(getGeminiVersion('gemini-3-flash-preview')).toBe(3);
    expect(getGeminiVersion('gemini-4-argon')).toBe(4);
    expect(getGeminiVersion('gemini-4-carbon')).toBe(4);
    // Ids without a leading generation number
    expect(getGeminiVersion('gemini-nano-banana-2.1')).toBeNull();
    expect(getGeminiVersion('gemini-decision-1')).toBeNull();
    expect(getGeminiVersion('gemma-4')).toBeNull();
  });

  test('supportsAgenticVideo covers Gemini 4, 3.6+ and 3.5 Flash-Lite', () => {
    for (const model of [
      'gemini-4-argon',
      'gemini-4-carbon',
      'gemini-3.8-flash',
      'gemini-3.6-flash',
      'gemini-3.5-flash-lite',
    ]) {
      expect(supportsAgenticVideo(model)).toBe(true);
    }
    expect(supportsAgenticVideo('gemini-3.1-flash-lite')).toBe(false);
    expect(supportsAgenticVideo('gemini-2.5-flash')).toBe(false);
  });

  test('parseDurationSeconds reads Files API durations', () => {
    expect(parseDurationSeconds('98s')).toBe(98);
    expect(parseDurationSeconds('98.104s')).toBeCloseTo(98.104);
    expect(parseDurationSeconds('0s')).toBe(0);
    expect(parseDurationSeconds(undefined)).toBeUndefined();
    expect(parseDurationSeconds('')).toBeUndefined();
    expect(parseDurationSeconds('1m30s')).toBeUndefined();
  });
});

describe('client construction', () => {
  test('pins API version v1beta (SDK 3.x defaults to v1, which rejects agentic video)', () => {
    createProvider();
    expect(clientOptions.at(-1)).toMatchObject({
      apiKey: 'test-key',
      apiVersion: 'v1beta',
    });
  });

  test('GEMINI_API_VERSION overrides the pinned version', () => {
    process.env.GEMINI_API_VERSION = 'v1';
    createProvider();
    expect(clientOptions.at(-1).apiVersion).toBe('v1');
  });

  test('uses a 15 minute HTTP timeout by default', () => {
    createProvider();
    expect(clientOptions.at(-1).httpOptions.timeout).toBe(900000);
  });
});

describe('request logging (store)', () => {
  test('opts out of request storage by default', async () => {
    await createProvider().analyzeImage(IMAGE, 'describe');
    expect(lastRequest().config.store).toBe(false);
  });

  test('GEMINI_STORE_REQUESTS=true opts in', async () => {
    process.env.GEMINI_STORE_REQUESTS = 'true';
    await createProvider().analyzeImage(IMAGE, 'describe');
    expect(lastRequest().config.store).toBe(true);
  });

  test('GEMINI_STORE_REQUESTS=project sends nothing and defers to the project setting', async () => {
    process.env.GEMINI_STORE_REQUESTS = 'project';
    await createProvider().analyzeImage(IMAGE, 'describe');
    expect(lastRequest().config).not.toHaveProperty('store');
  });
});

describe('output token budget', () => {
  test('defaults to 16384 tokens', async () => {
    await createProvider().analyzeImage(IMAGE, 'describe');
    expect(lastRequest().config.maxOutputTokens).toBe(16384);
  });

  test('raises small budgets to 32768 on Gemini 4 (thinking shares the budget)', async () => {
    for (const imageModel of ['gemini-4-argon', 'gemini-4-carbon']) {
      await createProvider({ imageModel }).analyzeImage(IMAGE, 'describe', {
        maxTokens: 1000,
      });
      expect(lastRequest().config.maxOutputTokens).toBe(32768);
    }
  });

  test('keeps a larger explicit budget on Gemini 4', async () => {
    await createProvider({ imageModel: 'gemini-4-argon' }).analyzeImage(
      IMAGE,
      'describe',
      { maxTokens: 60000 }
    );
    expect(lastRequest().config.maxOutputTokens).toBe(60000);
  });

  test('leaves explicit budgets alone on Gemini 3.x', async () => {
    await createProvider().analyzeImage(IMAGE, 'describe', { maxTokens: 1000 });
    expect(lastRequest().config.maxOutputTokens).toBe(1000);
  });
});

describe('thinking level', () => {
  test('sends an explicit level to Gemini 4 models', async () => {
    await createProvider({ imageModel: 'gemini-4-argon' }).analyzeImage(
      IMAGE,
      'describe',
      { thinkingLevel: 'high' }
    );
    expect(lastRequest().config.thinkingConfig).toEqual({
      thinkingLevel: 'HIGH',
    });
  });

  test.each(['gemini-4-argon', 'gemini-4-carbon', 'gemini-3.8-flash'])(
    'raises "minimal" to LOW on %s, which rejects MINIMAL',
    async imageModel => {
      await createProvider({ imageModel }).analyzeImage(IMAGE, 'describe', {
        thinkingLevel: 'minimal',
      });
      expect(lastRequest().config.thinkingConfig).toEqual({
        thinkingLevel: 'LOW',
      });
    }
  );

  test.each(['gemini-3.5-flash-lite', 'gemini-3.6-flash'])(
    'keeps "minimal" on %s, which supports it',
    async imageModel => {
      await createProvider({ imageModel }).analyzeImage(IMAGE, 'describe', {
        thinkingLevel: 'minimal',
      });
      expect(lastRequest().config.thinkingConfig).toEqual({
        thinkingLevel: 'MINIMAL',
      });
    }
  );

  test('sends no thinking config to Gemini 4 when none is requested (API default: medium)', async () => {
    await createProvider({ imageModel: 'gemini-4-carbon' }).analyzeImage(
      IMAGE,
      'describe'
    );
    expect(lastRequest().config).not.toHaveProperty('thinkingConfig');
  });

  test('never sends sampling parameters to Gemini 3.6+ or Gemini 4', async () => {
    for (const imageModel of ['gemini-3.8-flash', 'gemini-4-argon']) {
      await createProvider({ imageModel }).analyzeImage(IMAGE, 'describe', {
        temperature: 0.2,
        topP: 0.9,
        topK: 40,
      });
      const config = lastRequest().config;
      expect(config).not.toHaveProperty('temperature');
      expect(config).not.toHaveProperty('topP');
      expect(config).not.toHaveProperty('topK');
    }
  });
});

describe('empty and truncated output', () => {
  test('throws an actionable error when the budget is spent on thinking', async () => {
    generateContentMock.mockResolvedValue(
      okResponse({
        text: '',
        candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [] } }],
        usageMetadata: {
          promptTokenCount: 1178,
          candidatesTokenCount: 3,
          totalTokenCount: 1678,
          thoughtsTokenCount: 497,
        },
      })
    );

    await expect(
      createProvider({ imageModel: 'gemini-4-argon' }).analyzeImage(
        IMAGE,
        'hard question'
      )
    ).rejects.toThrow(
      /used the whole output budget.*497 tokens went to thinking.*Raise maxTokens/s
    );
  });

  test('reports a blocked prompt instead of returning an empty answer', async () => {
    generateContentMock.mockResolvedValue(
      okResponse({
        text: '',
        candidates: [],
        promptFeedback: { blockReason: 'PROHIBITED_CONTENT' },
      })
    );

    await expect(
      createProvider().analyzeImage(IMAGE, 'describe')
    ).rejects.toThrow(/blocked before generation.*PROHIBITED_CONTENT/s);
  });

  test('flags a cut-off answer with a note and the finish reason', async () => {
    generateContentMock.mockResolvedValue(
      okResponse({
        text: 'The root cause is',
        candidates: [{ finishReason: 'MAX_TOKENS' }],
        usageMetadata: {
          promptTokenCount: 1134,
          candidatesTokenCount: 7,
          totalTokenCount: 1430,
          thoughtsTokenCount: 289,
        },
      })
    );

    const result = await createProvider().analyzeImage(IMAGE, 'describe');

    expect(result.text).toBe('The root cause is');
    expect(result.metadata.finishReason).toBe('MAX_TOKENS');
    expect(result.metadata.note).toMatch(/cut off at the output limit/);
    expect(result.metadata.note).toMatch(/289 tokens went to thinking/);
  });

  test('reports thinking and tool-use tokens in usage', async () => {
    generateContentMock.mockResolvedValue(
      okResponse({
        usageMetadata: {
          promptTokenCount: 1672,
          candidatesTokenCount: 1174,
          totalTokenCount: 88622,
          thoughtsTokenCount: 2816,
          toolUsePromptTokenCount: 82960,
        },
      })
    );

    const result = await createProvider().analyzeImage(IMAGE, 'describe');

    expect(result.metadata.usage).toEqual({
      promptTokenCount: 1672,
      candidatesTokenCount: 1174,
      totalTokenCount: 88622,
      thoughtsTokenCount: 2816,
      toolUsePromptTokenCount: 82960,
    });
    expect(result.metadata).not.toHaveProperty('note');
  });
});

describe('video processing mode', () => {
  function fileWithDuration(videoDuration?: string) {
    filesGetMock.mockResolvedValue({
      name: 'files/video123',
      mimeType: 'video/mp4',
      uri: VIDEO_FILE,
      state: 'ACTIVE',
      ...(videoDuration ? { videoMetadata: { videoDuration } } : {}),
    });
  }
  const videoPart = () => lastRequest().contents[0];

  test('auto (default) uses static for a clip under 5 minutes', async () => {
    fileWithDuration('98s');
    const result = await createProvider().analyzeVideo(VIDEO_FILE, 'summarize');

    expect(videoPart()).not.toHaveProperty('mediaProcessing');
    expect(result.metadata.videoProcessing).toBe('static');
  });

  test('auto uses agentic from 5 minutes up', async () => {
    fileWithDuration('300s');
    const result = await createProvider().analyzeVideo(VIDEO_FILE, 'summarize');

    expect(videoPart().mediaProcessing).toBe('AGENTIC');
    expect(result.metadata.videoProcessing).toBe('agentic');
  });

  test('auto uses agentic when the duration is unknown (YouTube)', async () => {
    const result = await createProvider().analyzeVideo(
      'https://www.youtube.com/watch?v=9hE5-98ZeCg',
      'summarize'
    );

    expect(videoPart().mediaProcessing).toBe('AGENTIC');
    expect(result.metadata.videoProcessing).toBe('agentic');
    expect(filesGetMock).not.toHaveBeenCalled();
  });

  test('auto uses a caller-supplied duration for YouTube (YOUTUBE_API_KEY lookup)', async () => {
    const youtube = 'https://www.youtube.com/watch?v=9hE5-98ZeCg';

    await createProvider().analyzeVideo(youtube, 'summarize', {
      durationSeconds: 90,
    });
    expect(videoPart()).not.toHaveProperty('mediaProcessing');

    await createProvider().analyzeVideo(youtube, 'summarize', {
      durationSeconds: 1800,
    });
    expect(videoPart().mediaProcessing).toBe('AGENTIC');
  });

  test('VIDEO_AGENTIC_MIN_DURATION moves the auto threshold', async () => {
    process.env.VIDEO_AGENTIC_MIN_DURATION = '60';
    fileWithDuration('98s');
    await createProvider().analyzeVideo(VIDEO_FILE, 'summarize');
    expect(videoPart().mediaProcessing).toBe('AGENTIC');
  });

  test('auto falls back to static on models without agentic support', async () => {
    fileWithDuration('1800s');
    const result = await createProvider({
      videoModel: 'gemini-3.1-flash-lite',
    }).analyzeVideo(VIDEO_FILE, 'summarize');

    expect(videoPart()).not.toHaveProperty('mediaProcessing');
    expect(result.metadata.videoProcessing).toBe('static');
  });

  test('auto uses static when clipping is requested, whatever the duration', async () => {
    fileWithDuration('1800s');
    await createProvider().analyzeVideo(VIDEO_FILE, 'summarize', {
      videoMetadata: { startOffset: '10s', endOffset: '40s' },
    });
    expect(videoPart()).not.toHaveProperty('mediaProcessing');
  });

  test('VIDEO_PROCESSING=agentic forces agentic on short clips', async () => {
    process.env.VIDEO_PROCESSING = 'agentic';
    fileWithDuration('98s');
    await createProvider().analyzeVideo(VIDEO_FILE, 'summarize');
    expect(videoPart().mediaProcessing).toBe('AGENTIC');
  });

  test('VIDEO_PROCESSING=static forces static on long videos', async () => {
    process.env.VIDEO_PROCESSING = 'static';
    fileWithDuration('1800s');
    await createProvider().analyzeVideo(VIDEO_FILE, 'summarize');
    expect(videoPart()).not.toHaveProperty('mediaProcessing');
  });

  test('a per-call processing option beats the env default', async () => {
    process.env.VIDEO_PROCESSING = 'static';
    fileWithDuration('98s');
    await createProvider().analyzeVideo(VIDEO_FILE, 'summarize', {
      processing: 'agentic',
    });
    expect(videoPart().mediaProcessing).toBe('AGENTIC');
  });

  test('Gemini 4 supports agentic processing', async () => {
    fileWithDuration('1800s');
    await createProvider({ videoModel: 'gemini-4-argon' }).analyzeVideo(
      VIDEO_FILE,
      'summarize'
    );
    expect(videoPart().mediaProcessing).toBe('AGENTIC');
  });
});

describe('image editing', () => {
  const editResponse = okResponse({
    text: undefined,
    candidates: [
      {
        finishReason: 'STOP',
        content: {
          parts: [{ inlineData: { mimeType: 'image/png', data: 'AAAA' } }],
        },
      },
    ],
  });
  const input = [{ data: 'AAAA', mimeType: 'image/png' }];

  test('defaults to gemini-nano-banana-2.1', async () => {
    generateContentMock.mockResolvedValue(editResponse);
    const result = await createProvider().editImage(input, 'circle the bug');

    expect(lastRequest().model).toBe('gemini-nano-banana-2.1');
    expect(lastRequest().config.store).toBe(false);
    expect(result.images).toHaveLength(1);
  });

  test('raises imageSize 512 to 1K on models without a 512 size', async () => {
    generateContentMock.mockResolvedValue(editResponse);
    await createProvider().editImage(input, 'circle the bug', {
      imageSize: '512',
    });
    expect(lastRequest().config.imageConfig).toEqual({ imageSize: '1K' });
  });

  test('keeps imageSize 512 on gemini-3.1-flash-image', async () => {
    process.env.EDIT_IMAGE_MODEL = 'gemini-3.1-flash-image';
    generateContentMock.mockResolvedValue(editResponse);
    await createProvider().editImage(input, 'circle the bug', {
      imageSize: '512',
    });
    expect(lastRequest().model).toBe('gemini-3.1-flash-image');
    expect(lastRequest().config.imageConfig).toEqual({ imageSize: '512' });
  });

  test('switches to a video-capable model when gemini-3-pro-image gets a video', async () => {
    process.env.EDIT_IMAGE_MODEL = 'gemini-3-pro-image';
    generateContentMock.mockResolvedValue(editResponse);
    await createProvider().editImage([], 'make a thumbnail', {
      videoSource: 'https://www.youtube.com/watch?v=9hE5-98ZeCg',
    });

    expect(lastRequest().model).toBe('gemini-nano-banana-2.1');
    expect(lastRequest().contents[0].parts[0]).toEqual({
      fileData: {
        fileUri: 'https://www.youtube.com/watch?v=9hE5-98ZeCg',
        mimeType: 'video/mp4',
      },
    });
  });

  test('keeps gemini-3-pro-image for image-only edits', async () => {
    process.env.EDIT_IMAGE_MODEL = 'gemini-3-pro-image';
    generateContentMock.mockResolvedValue(editResponse);
    await createProvider().editImage(input, 'circle the bug');
    expect(lastRequest().model).toBe('gemini-3-pro-image');
  });

  test('surfaces the finish reason when the model refuses', async () => {
    generateContentMock.mockResolvedValue(
      okResponse({
        text: undefined,
        candidates: [{ finishReason: 'PROHIBITED_CONTENT' }],
      })
    );
    const result = await createProvider().editImage(input, 'do something');

    expect(result.images).toHaveLength(0);
    expect(result.metadata.finishReason).toBe('PROHIBITED_CONTENT');
  });
});

describe('document analysis', () => {
  const PDF_FILE =
    'https://generativelanguage.googleapis.com/v1beta/files/doc123';

  test('degrades ultra_high to request-level HIGH (the API rejects ultra_high on documents)', async () => {
    process.env.MEDIA_RESOLUTION_FOR_IMAGE = 'ultra_high';
    filesGetMock.mockResolvedValue({
      name: 'files/doc123',
      mimeType: 'application/pdf',
      uri: PDF_FILE,
      state: 'ACTIVE',
    });

    await createProvider().analyzeDocument(PDF_FILE, 'summarize');

    const request = lastRequest();
    expect(request.contents[0]).toEqual({
      fileData: { fileUri: PDF_FILE, mimeType: 'application/pdf' },
    });
    expect(request.config.mediaResolution).toBe('MEDIA_RESOLUTION_HIGH');
  });

  test('still applies ultra_high to images at the part level', async () => {
    process.env.MEDIA_RESOLUTION_FOR_IMAGE = 'ultra_high';
    await createProvider().analyzeImage(IMAGE, 'read the footer');

    const request = lastRequest();
    expect(request.contents[0].mediaResolution).toEqual({
      level: 'MEDIA_RESOLUTION_ULTRA_HIGH',
    });
    expect(request.config).not.toHaveProperty('mediaResolution');
  });

  test('adds a processing note for spreadsheets', async () => {
    const sheet =
      'https://generativelanguage.googleapis.com/v1beta/files/sheet123';
    filesGetMock.mockResolvedValue({
      name: 'files/sheet123',
      mimeType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      uri: sheet,
      state: 'ACTIVE',
    });

    const result = await createProvider().analyzeDocument(sheet, 'summarize');
    expect(result.metadata.note).toMatch(/flattened CSV/);
  });
});

describe('transcription', () => {
  const AUDIO_FILE =
    'https://generativelanguage.googleapis.com/v1beta/files/audio123';

  beforeEach(() => {
    filesGetMock.mockResolvedValue({
      name: 'files/audio123',
      mimeType: 'audio/mp4',
      uri: AUDIO_FILE,
      state: 'ACTIVE',
    });
  });

  test('returns an empty transcript for audio without speech instead of failing', async () => {
    generateContentMock.mockResolvedValue(
      okResponse({
        text: undefined,
        candidates: [{ finishReason: 'STOP', content: { parts: [] } }],
      })
    );

    const result = await createProvider().transcribeAudio(AUDIO_FILE);
    expect(result.text).toBe('');
  });

  test('keeps speaker labels and timing when parts carry both text and audioTranscription', async () => {
    // The current response shape (Nov 2026): every transcription part has a
    // plain `text` copy next to `audioTranscription`. Reading `text` first
    // silently dropped the label and timing.
    generateContentMock.mockResolvedValue(
      okResponse({
        text: 'Hello team. Thanks.',
        candidates: [
          {
            finishReason: 'STOP',
            content: {
              parts: [
                {
                  text: 'Hello team.',
                  audioTranscription: {
                    text: 'Hello team.',
                    speakerLabel: 'spk:0',
                    words: [
                      { word: 'Hello', startOffset: '0.100s', endOffset: '0.400s' },
                      { word: 'team.', startOffset: '0.400s', endOffset: '1s' },
                    ],
                  },
                },
                {
                  text: 'Thanks.',
                  audioTranscription: {
                    text: 'Thanks.',
                    speakerLabel: 'spk:1',
                    startOffset: '63.500s',
                  },
                },
              ],
            },
          },
        ],
      })
    );

    const result = await createProvider().transcribeAudio(AUDIO_FILE, {
      diarization: true,
      wordTimestamps: true,
    });

    expect(result.text).toBe(
      '[0:00] [spk:0] Hello team.\n[1:03] [spk:1] Thanks.'
    );
    expect(lastRequest().config).toMatchObject({
      audioTranscriptionConfig: { diarization: true, wordTimestamp: true },
      store: false,
    });
  });

  test('still reads the earlier shape with audioTranscription only', async () => {
    generateContentMock.mockResolvedValue(
      okResponse({
        text: undefined,
        candidates: [
          {
            finishReason: 'STOP',
            content: {
              parts: [
                { audioTranscription: { text: 'Hello team.', speakerLabel: 'spk:0' } },
              ],
            },
          },
        ],
      })
    );

    const result = await createProvider().transcribeAudio(AUDIO_FILE, {
      diarization: true,
    });
    expect(result.text).toBe('[spk:0] Hello team.');
  });

  test('returns plain text when no diarization or timing was requested', async () => {
    generateContentMock.mockResolvedValue(
      okResponse({
        text: 'Hello team.',
        candidates: [
          {
            finishReason: 'STOP',
            content: {
              parts: [
                { text: 'Hello team.', audioTranscription: { text: 'Hello team.' } },
              ],
            },
          },
        ],
      })
    );

    const result = await createProvider().transcribeAudio(AUDIO_FILE);
    expect(result.text).toBe('Hello team.');
  });
});

describe('evaluateMedia (Decisions API)', () => {
  const decisionsResponse = {
    answers: {
      shows_error: { type: 'noul', noul: 0.92, confidence: 0.92 },
      page: {
        type: 'choice',
        choice: 'dashboard',
        confidence: 0.96,
        probabilities: { dashboard: 0.96, other: 0.04 },
      },
    },
    usage: {
      total_tokens: 1366,
      total_input_tokens: 1366,
      total_output_tokens: 0,
      input_tokens_by_modality: [
        { modality: 'text', tokens: 266 },
        { modality: 'image', tokens: 1100 },
      ],
    },
  };
  const questions = [
    {
      id: 'shows_error',
      type: 'yes_no' as const,
      question: 'Is an error visible?',
    },
    {
      id: 'page',
      type: 'choice' as const,
      question: 'Which page is this?',
      options: { dashboard: 'Metrics page', other: 'Anything else' },
    },
  ];

  test('sends context, media blocks and questions in the Decisions wire format', async () => {
    decisionsCreateMock.mockResolvedValue(decisionsResponse);

    const result = await createProvider().evaluateMedia(
      [
        { kind: 'image', mimeType: 'image/png', data: 'AAAA' },
        { kind: 'video', mimeType: 'video/quicktime', uri: VIDEO_FILE },
        { kind: 'document', mimeType: 'application/pdf', uri: 'files/doc' },
      ],
      questions,
      ' Screenshot from staging. ',
      { mediaResolution: 'ultra_high' }
    );

    expect(decisionsCreateMock).toHaveBeenCalledWith({
      model: 'gemini-decision-1',
      input: [
        { type: 'text', text: 'Screenshot from staging.' },
        // ultra_high applies to images...
        {
          type: 'image',
          mime_type: 'image/png',
          data: 'AAAA',
          resolution: 'ultra_high',
        },
        // ...is capped at high for video, keeping the file's exact MIME type...
        {
          type: 'video',
          mime_type: 'video/quicktime',
          uri: VIDEO_FILE,
          resolution: 'high',
        },
        // ...and is not sent for documents
        { type: 'document', mime_type: 'application/pdf', uri: 'files/doc' },
      ],
      questions: {
        shows_error: { type: 'noul', instructions: 'Is an error visible?' },
        page: {
          type: 'choice',
          instructions: 'Which page is this?',
          criteria: { dashboard: 'Metrics page', other: 'Anything else' },
        },
      },
    });

    expect(result.answers.shows_error).toMatchObject({
      type: 'yes_no',
      answer: true,
      probability: 0.92,
    });
    expect(result.answers.page).toMatchObject({
      type: 'choice',
      answer: 'dashboard',
    });
    expect(result.summary).toBe(
      'shows_error: YES (P(yes)=92%, confidence 92%)\npage: dashboard (confidence 96%)'
    );
    expect(result.metadata).toMatchObject({
      model: 'gemini-decision-1',
      provider: 'gemini',
      mediaCount: 3,
      usage: {
        inputTokens: 1366,
        outputTokens: 0,
        inputTokensByModality: { text: 266, image: 1100 },
      },
    });
  });

  test('accepts text-only input', async () => {
    decisionsCreateMock.mockResolvedValue({
      answers: { shows_error: { type: 'noul', noul: 0.1, confidence: 0.9 } },
      usage: { total_input_tokens: 40, total_output_tokens: 0 },
    });

    const result = await createProvider().evaluateMedia(
      [],
      [questions[0]],
      'Build passed with no warnings.'
    );

    expect(decisionsCreateMock.mock.calls[0][0].input).toEqual([
      { type: 'text', text: 'Build passed with no warnings.' },
    ]);
    expect(result.answers.shows_error).toMatchObject({ answer: false });
    expect(result.metadata.mediaCount).toBe(0);
  });

  test('rejects a call with neither media nor context', async () => {
    await expect(
      createProvider().evaluateMedia([], [questions[0]])
    ).rejects.toThrow(/at least one media source or a context text/);
    expect(decisionsCreateMock).not.toHaveBeenCalled();
  });

  test('validates questions before calling the API', async () => {
    await expect(
      createProvider().evaluateMedia(
        [{ kind: 'image', mimeType: 'image/png', data: 'AAAA' }],
        [{ id: 'bad id', type: 'yes_no', question: 'ok?' }]
      )
    ).rejects.toThrow(/Invalid question id/);
    expect(decisionsCreateMock).not.toHaveBeenCalled();
  });

  test('surfaces the server message from API errors', async () => {
    decisionsCreateMock.mockRejectedValue(
      new Error(
        '400 API error occurred: Status 400 Content-Type "application/json; charset=UTF-8" Body: {"error":{"message":"File abc MIME type is video/mov which does not match parent MIME type video/quicktime","code":"invalid_request"}}'
      )
    );

    await expect(
      createProvider().evaluateMedia(
        [{ kind: 'video', mimeType: 'video/mov', uri: VIDEO_FILE }],
        [questions[0]]
      )
    ).rejects.toThrow(
      'Decisions API request failed: File abc MIME type is video/mov which does not match parent MIME type video/quicktime (invalid_request)'
    );
  });

  test('explains a 404 as an API version problem', async () => {
    decisionsCreateMock.mockRejectedValue(
      new Error(
        '404 API error occurred: Status 404 Content-Type text/html. Body: ""'
      )
    );

    await expect(
      createProvider().evaluateMedia([], [questions[0]], 'some text')
    ).rejects.toThrow(/only on API version v1beta/);
  });
});
