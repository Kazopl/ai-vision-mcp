import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { FileService } from '../../src/services/FileService.js';

// The source uses the native global fetch
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const configService = {
  getConfig: () => ({
    IMAGE_PROVIDER: 'google',
    VIDEO_PROVIDER: 'google',
    GEMINI_FILES_API_THRESHOLD: 10 * 1024 * 1024,
    VERTEX_AI_FILES_API_THRESHOLD: 0,
  }),
  getAllowedImageFormats: () => ['jpg', 'jpeg', 'png', 'bmp', 'gif', 'webp'],
  getAllowedVideoFormats: () => [
    'mp4',
    'mov',
    'avi',
    'x-flv',
    'webm',
    'mpeg',
    'mpg',
    'wmv',
    '3gp',
  ],
  getMaxImageSize: () => 20 * 1024 * 1024,
  getMaxVideoSize: () => 2 * 1024 * 1024 * 1024,
  getGeminiFilesApiThreshold: () => 10 * 1024 * 1024,
} as any;

const visionProvider = {
  uploadFile: vi.fn(),
  uploadFileFromPath: vi.fn(),
  waitForFileProcessing: vi.fn(),
  deleteFile: vi.fn(),
  analyzeVideo: vi.fn(),
  analyzeImage: vi.fn(),
  compareImages: vi.fn(),
  downloadFile: vi.fn(),
  setModel: vi.fn(),
  getImageModel: vi.fn(),
  getVideoModel: vi.fn(),
  getSupportedFormats: vi.fn(),
  getModelCapabilities: vi.fn(),
  getProviderInfo: vi.fn(),
  healthCheck: vi.fn(),
  supportsVideo: vi.fn(),
} as any;

function createResponse({
  ok = true,
  contentLength,
  contentType = 'video/mp4',
  bodyChunks = [Buffer.from('small-video-data')],
}: {
  ok?: boolean;
  contentLength?: string;
  contentType?: string;
  bodyChunks?: Buffer[];
}) {
  const destroy = vi.fn();
  const body = {
    ok,
    headers: {
      get: (name: string) => {
        if (name.toLowerCase() === 'content-length') {
          return contentLength ?? null;
        }
        if (name.toLowerCase() === 'content-type') {
          return contentType;
        }
        return null;
      },
    },
    body: Readable.from(bodyChunks),
    destroy,
  };

  return body;
}

describe('FileService.handleVideoSource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('accepts gemini-supported image and video mime aliases', () => {
    const service = new FileService(configService, 'video', visionProvider);

    expect((service as any).isSupportedFileType('image/bmp')).toBe(true);
    expect((service as any).isSupportedFileType('video/mpeg')).toBe(true);
    expect((service as any).isSupportedFileType('video/mpg')).toBe(true);
    expect((service as any).isSupportedFileType('video/mov')).toBe(true);
    expect((service as any).isSupportedFileType('video/avi')).toBe(true);
    expect((service as any).isSupportedFileType('video/wmv')).toBe(true);
    expect((service as any).isSupportedFileType('video/x-flv')).toBe(true);
  });

  const uploadedFileFixture = {
    id: 'files/abc123',
    filename: 'video.mp4',
    mimeType: 'video/mp4',
    size: 16,
    uri: 'https://generativelanguage.googleapis.com/v1beta/files/abc123',
    state: 'ACTIVE',
  };

  test('uploads small remote videos via the Files API (single canonical path)', async () => {
    fetchMock.mockResolvedValue(
      createResponse({
        contentLength: '16',
        contentType: 'video/mp4',
        bodyChunks: [Buffer.from('small-video-data')],
      })
    );
    visionProvider.uploadFileFromPath.mockResolvedValue(uploadedFileFixture);

    const service = new FileService(configService, 'video', visionProvider);
    const result = await service.handleVideoSource(
      'https://example.com/video.mp4'
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/video.mp4',
      expect.objectContaining({ method: 'GET' })
    );
    expect(result).toBe(uploadedFileFixture.uri);
    expect(visionProvider.uploadFileFromPath).toHaveBeenCalledWith(
      expect.stringContaining('video.mp4'),
      'video/mp4',
      'video.mp4'
    );
    expect(visionProvider.waitForFileProcessing).toHaveBeenCalled();
  });

  test('uploads large remote videos through the same path (no size branching)', async () => {
    fetchMock.mockResolvedValue(
      createResponse({
        contentLength: String(500 * 1024 * 1024),
        contentType: 'video/mp4',
        bodyChunks: [Buffer.alloc(1024, 1)],
      })
    );
    visionProvider.uploadFileFromPath.mockResolvedValue(uploadedFileFixture);

    const service = new FileService(configService, 'video', visionProvider);
    const result = await service.handleVideoSource(
      'https://example.com/huge-video.mp4'
    );

    // One fetch, one streaming upload - identical to the small-file flow
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toBe(uploadedFileFixture.uri);
  });

  test('normalizes remote video filename before upload', async () => {
    fetchMock.mockResolvedValue(
      createResponse({
        contentType: 'video/quicktime',
        bodyChunks: [Buffer.from('large-video')],
      })
    );
    visionProvider.uploadFileFromPath.mockResolvedValue({
      ...uploadedFileFixture,
      mimeType: 'video/quicktime',
    });

    const service = new FileService(configService, 'video', visionProvider);
    const result = await service.handleVideoSource(
      'https://example.com/path/to/video.mov?download=1'
    );

    expect(result).toBe(uploadedFileFixture.uri);
    expect(visionProvider.uploadFileFromPath).toHaveBeenCalledWith(
      expect.stringContaining('video.mov'),
      'video/quicktime',
      'video.mov'
    );
  });

  test('returns the remote url unchanged when the download fails', async () => {
    fetchMock.mockResolvedValue(createResponse({ ok: false }));

    const service = new FileService(configService, 'video', visionProvider);
    const result = await service.handleVideoSource(
      'https://example.com/large-video.mp4'
    );

    expect(result).toBe('https://example.com/large-video.mp4');
    expect(visionProvider.uploadFileFromPath).not.toHaveBeenCalled();
  });

  test('uploads remote videos when content-length is missing', async () => {
    fetchMock.mockResolvedValue(
      createResponse({
        bodyChunks: [Buffer.from('tiny-video')],
      })
    );
    visionProvider.uploadFileFromPath.mockResolvedValue(uploadedFileFixture);

    const service = new FileService(configService, 'video', visionProvider);
    const result = await service.handleVideoSource(
      'https://example.com/no-content-length.mp4'
    );

    expect(result).toBe(uploadedFileFixture.uri);
  });

  test('keeps youtube urls unchanged', async () => {
    const service = new FileService(configService, 'video', visionProvider);

    const result = await service.handleVideoSource(
      'https://www.youtube.com/watch?v=9hE5-98ZeCg'
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toBe('https://www.youtube.com/watch?v=9hE5-98ZeCg');
  });

  test('uploads local videos via streaming Files API path', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-vision-mpeg-'));
    const filePath = path.join(dir, 'sample.mpeg');
    await fs.writeFile(filePath, Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]));

    visionProvider.uploadFileFromPath.mockResolvedValue({
      id: 'files/local1',
      filename: 'sample.mpeg',
      mimeType: 'video/mpeg',
      size: 12,
      uri: 'https://generativelanguage.googleapis.com/v1beta/files/local1',
      state: 'ACTIVE',
    });

    const service = new FileService(configService, 'video', visionProvider);
    const result = await service.handleVideoSource(filePath);

    expect(result).toBe(
      'https://generativelanguage.googleapis.com/v1beta/files/local1'
    );
    // Streamed from path - the file is never read fully into memory
    expect(visionProvider.uploadFileFromPath).toHaveBeenCalledWith(
      expect.stringContaining('sample.mpeg'),
      'video/mpeg',
      'sample.mpeg'
    );
    expect(visionProvider.uploadFile).not.toHaveBeenCalled();
  });

  test('returns Gemini-compatible file extensions for supported mime types', () => {
    expect(FileService.getFileExtension('image/bmp')).toBe('bmp');
    expect(FileService.getFileExtension('video/mov')).toBe('mov');
    expect(FileService.getFileExtension('video/avi')).toBe('avi');
    expect(FileService.getFileExtension('video/mpeg')).toBe('mpeg');
    expect(FileService.getFileExtension('video/mpg')).toBe('mpg');
    expect(FileService.getFileExtension('video/wmv')).toBe('wmv');
    expect(FileService.getFileExtension('video/x-flv')).toBe('flv');
  });
});
