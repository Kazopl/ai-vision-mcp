/**
 * Gemini API provider implementation
 */

import fs from 'fs/promises';
import path from 'path';
import { GoogleGenAI, setDefaultBaseUrls } from '@google/genai';
import { BaseVisionProvider } from '../base/VisionProvider.js';
import { FUNCTION_NAMES } from '../../constants/FunctionNames.js';
import type {
  GeminiConfig,
  AnalysisOptions,
  AnalysisResult,
  UploadedFile,
  HealthStatus,
  ProviderCapabilities,
  ModelCapabilities,
  ProviderInfo,
  GeminiFileMetadata,
  TranscriptionOptions,
} from '../../types/Providers.js';
import {
  ProviderError,
  FileUploadError,
  FileNotFoundError,
  NetworkError,
} from '../../types/Errors.js';
import { RetryHandler } from '../../utils/retry.js';
import { formatDuration } from '../../utils/duration.js';
import {
  describeMediaSource,
  isFileReferenceSource,
  isYouTubeUrl,
} from '../../utils/mediaSources.js';
import { processVideoSource } from '../../utils/videoSourceHandler.js';
import { processImageSource } from '../../utils/imageSourceHandler.js';
import {
  loadAudioSource,
  getAudioMimeType,
} from '../../utils/audioSourceHandler.js';
import {
  loadDocumentSource,
  getDocumentMimeType,
} from '../../utils/documentSourceHandler.js';
import { ConfigService } from '../../services/ConfigService.js';
import type {
  EditImageInput,
  EditImageOptions,
  EditImageResult,
} from '../../types/ImageEdit.js';

export class GeminiProvider extends BaseVisionProvider {
  private client: GoogleGenAI;
  private config: GeminiConfig;
  private baseUrl: string;

  constructor(config: GeminiConfig) {
    super('gemini', config.imageModel, config.videoModel);
    this.config = config;

    // Validate endpoint format
    this.validateEndpoint(config.baseUrl);

    // Set global base URL before creating the client
    setDefaultBaseUrls({ geminiUrl: config.baseUrl });

    this.client = new GoogleGenAI({
      apiKey: config.apiKey,
      // Generous timeout: agentic vision/video runs multi-round server-side
      // loops that can take minutes
      httpOptions: { timeout: this.configService.getGeminiTimeoutMs() },
    });
    this.baseUrl = config.baseUrl;
  }

  private validateEndpoint(endpoint: string): void {
    // Validate that it's a valid URL format
    try {
      new URL(endpoint);
    } catch (error) {
      throw new ProviderError(
        `Invalid Gemini endpoint format: ${endpoint}. Must be a valid URL.`,
        'gemini',
        undefined,
        400
      );
    }
  }

  async analyzeImage(
    imageSource: string,
    prompt: string,
    options?: AnalysisOptions
  ): Promise<AnalysisResult> {
    try {
      const { result: analysisResult } = await RetryHandler.withRetry(
        async () => {
          return await this.analyzeImageOnce(imageSource, prompt, options);
        },
        {
          // Prefer a couple quick retries for transient rate limits/network.
          maxRetries: 2,
          baseDelay: 1500,
          maxDelay: 20000,
          retryableErrors: ['RATE_LIMIT_EXCEEDED', 'NETWORK_ERROR'],
          onRetry: (attempt, err) => {
            console.error(
              `[GeminiProvider] Retry analyzeImage attempt ${attempt}: ${err.message}`
            );
          },
        }
      );

      return analysisResult;
    } catch (error) {
      throw this.handleError(error, 'image analysis');
    }
  }

  private async analyzeImageOnce(
    imageSource: string,
    prompt: string,
    options?: AnalysisOptions
  ): Promise<AnalysisResult> {
    try {
      console.error(
        `[GeminiProvider] Received image source kind: ${describeMediaSource(imageSource)}`
      );

      let content: any;
      let fileSize: number | undefined;
      let processingDuration = 0;

      // Process image source using shared utility
      const {
        fileUri,
        mimeType,
        isInlineData,
        processingDuration: sourceProcessingDuration,
      } = await processImageSource(imageSource);

      processingDuration = sourceProcessingDuration;

      // For GeminiProvider, if we got inline data from a non-files/, non-gs:// source,
      // and it's not already a data URI, handle it
      if (isInlineData && fileUri.startsWith('data:')) {
        // Extract base64 data from data URI
        const base64Data = fileUri.split(',')[1];
        fileSize = Buffer.from(base64Data, 'base64').length;

        // Check if we should upload HTTP images to Files API
        if (imageSource.startsWith('http') && !isYouTubeUrl(imageSource)) {
          const buffer = Buffer.from(base64Data, 'base64');
          const filename = imageSource.split('/').pop() || 'image.jpg';

          const { result: uploadedFile, duration: uploadFileDuration } =
            await this.measureAsync(async () => {
              return await this.uploadFile(buffer, filename, mimeType);
            });

          processingDuration += uploadFileDuration;
          content = {
            fileData: {
              fileUri: uploadedFile.uri!,
              mimeType,
            },
          };
        } else {
          // Use inline data for local files or data URIs
          content = {
            inlineData: {
              mimeType,
              data: base64Data,
            },
          };
        }
      } else if (isFileReferenceSource(fileUri)) {
        // Handle Gemini Files API references
        const fileId = fileUri.split('/').pop()!;
        await this.waitForFileProcessing(fileId);

        content = {
          fileData: {
            fileUri,
            mimeType,
          },
        };
      } else {
        // Use fileData for GCS URIs and other file references
        content = {
          fileData: {
            fileUri,
            mimeType,
          },
        };
      }

      // ultra_high media resolution must live on the media Part itself
      const partMediaResolution = this.getPartMediaResolution(
        'image',
        options
      );
      if (partMediaResolution) {
        content.mediaResolution = partMediaResolution;
      }

      const model = this.resolveModelForFunction(
        'image',
        options?.functionName
      );

      const enabled =
        process.env.AI_VISION_LOG_MODELS === '1' ||
        process.env.LOG_LEVEL === 'debug';
      if (enabled) {
        void this.logger.info(
          {
            msg: 'Gemini request (image)',
            baseUrl: this.baseUrl,
            model,
            functionName: options?.functionName ?? null,
          },
          'models'
        );
      }

      const { result: response, duration: analysisDuration } =
        await this.measureAsync(async () => {
          return await this.client.models.generateContent({
            model,
            contents: [content, { text: prompt }],
            config: this.buildConfigWithOptions(
              'image',
              options?.functionName,
              options
            ),
          });
        });

      const text = response.text || '';
      const usage = response.usageMetadata;

      return this.createAnalysisResult(
        text,
        model,
        usage
          ? {
            promptTokenCount: usage.promptTokenCount || 0,
            candidatesTokenCount: usage.candidatesTokenCount || 0,
            totalTokenCount: usage.totalTokenCount || 0,
          }
          : undefined,
        processingDuration + analysisDuration,
        content.fileData?.mimeType || content.inlineData?.mimeType,
        fileSize,
        response.modelVersion,
        response.responseId
      );
    } catch (error) {
      throw this.handleError(error, 'image analysis');
    }
  }

  async compareImages(
    imageSources: string[],
    prompt: string,
    options?: AnalysisOptions
  ): Promise<AnalysisResult> {
    try {
      console.error(`[GeminiProvider] Comparing ${imageSources.length} images`);

      // Process all images to create content parts
      const contentParts: any[] = [];
      let totalFileSize = 0;
      let totalProcessingDuration = 0;

      for (let i = 0; i < imageSources.length; i++) {
        const imageSource = imageSources[i];
        console.error(
          `[GeminiProvider] Processing image ${i + 1}: ${imageSource.substring(0, 100)}${imageSource.length > 100 ? '...' : ''}`
        );

        // Process image source using shared utility
        const {
          fileUri,
          mimeType,
          isInlineData,
          processingDuration: sourceProcessingDuration,
        } = await processImageSource(imageSource);

        let content: any;
        let fileSize: number | undefined;
        let processingDuration = sourceProcessingDuration;

        if (isInlineData && fileUri.startsWith('data:')) {
          // Extract base64 data from data URI
          const base64Data = fileUri.split(',')[1];
          fileSize = Buffer.from(base64Data, 'base64').length;

          // Check if we should upload HTTP images to Files API
          if (imageSource.startsWith('http') && !isYouTubeUrl(imageSource)) {
            const buffer = Buffer.from(base64Data, 'base64');
            const filename = imageSource.split('/').pop() || `image${i + 1}.jpg`;

            const { result: uploadedFile, duration: uploadFileDuration } =
              await this.measureAsync(async () => {
                return await this.uploadFile(buffer, filename, mimeType);
              });

            processingDuration += uploadFileDuration;
            content = {
              fileData: {
                fileUri: uploadedFile.uri!,
                mimeType,
              },
            };
          } else {
            // Use inline data for local files or data URIs
            content = {
              inlineData: {
                mimeType,
                data: base64Data,
              },
            };
          }
        } else if (isFileReferenceSource(fileUri)) {
          // Handle Gemini Files API references
          const fileId = fileUri.split('/').pop()!;
          await this.waitForFileProcessing(fileId);

          content = {
            fileData: {
              fileUri,
              mimeType,
            },
          };
        } else {
          // Use fileData for GCS URIs and other file references
          content = {
            fileData: {
              fileUri,
              mimeType,
            },
          };
        }

        contentParts.push(content);
        if (fileSize) {
          totalFileSize += fileSize;
        }
        totalProcessingDuration += processingDuration;
      }

      // ultra_high media resolution must live on each media Part itself
      const partMediaResolution = this.getPartMediaResolution(
        'image',
        options
      );
      if (partMediaResolution) {
        for (const part of contentParts) {
          part.mediaResolution = partMediaResolution;
        }
      }

      // Add the prompt as the last content part
      contentParts.push({ text: prompt });

      console.error(
        `[GeminiProvider] All ${imageSources.length} images processed, sending to Gemini API`
      );

      const model = this.resolveModelForFunction(
        'image',
        options?.functionName
      );

      const enabled =
        process.env.AI_VISION_LOG_MODELS === '1' ||
        process.env.LOG_LEVEL === 'debug';
      if (enabled) {
        void this.logger.info(
          {
            msg: 'Gemini request (compare_images)',
            baseUrl: this.baseUrl,
            model,
            functionName: options?.functionName ?? null,
            imageCount: imageSources.length,
          },
          'models'
        );
      }

      const { result: response, duration: analysisDuration } =
        await this.measureAsync(async () => {
          return await this.client.models.generateContent({
            model,
            contents: contentParts,
            config: this.buildConfigWithOptions(
              'image',
              options?.functionName,
              options
            ),
          });
        });

      const text = response.text || '';
      const usage = response.usageMetadata;

      return this.createAnalysisResult(
        text,
        model,
        usage
          ? {
            promptTokenCount: usage.promptTokenCount || 0,
            candidatesTokenCount: usage.candidatesTokenCount || 0,
            totalTokenCount: usage.totalTokenCount || 0,
          }
          : undefined,
        totalProcessingDuration + analysisDuration,
        'image/multiple',
        totalFileSize,
        response.modelVersion,
        response.responseId
      );
    } catch (error) {
      throw this.handleError(error, 'image comparison');
    }
  }

  async analyzeVideo(
    videoSource: string,
    prompt: string,
    options?: AnalysisOptions
  ): Promise<AnalysisResult> {
    try {
      let content: any;
      let uploadDuration = 0;

      // Process the video source using shared utility
      const { fileUri, mimeType, uploadDuration: processDuration, isInlineData } =
        await processVideoSource(videoSource);

      // For GeminiProvider, if we got inline data from a non-YouTube HTTP URL,
      // upload it to Gemini Files API instead of using inline data
      if (isInlineData && videoSource.startsWith('http') && !isYouTubeUrl(videoSource)) {
        // Extract base64 data from data URI
        const base64Data = fileUri.split(',')[1];
        const buffer = Buffer.from(base64Data, 'base64');
        const filename = videoSource.split('/').pop() || 'video.mp4';

        const { result: uploadedFile, duration: uploadFileDuration } =
          await this.measureAsync(async () => {
            return await this.uploadFile(buffer, filename, mimeType);
          });

        uploadDuration = processDuration + uploadFileDuration;
        content = {
          fileData: {
            fileUri: uploadedFile.uri!,
            mimeType,
          },
        };
      } else if (isInlineData) {
        // For local files or inline data, use inline format
        const base64Data = fileUri.split(',')[1];
        content = {
          inlineData: {
            mimeType,
            data: base64Data,
          },
        };
        uploadDuration = processDuration;
      } else {
        // For GCS URIs, YouTube URLs, and file references, use fileData.
        // For Files API references the placeholder mimeType from
        // processVideoSource may not match the uploaded file (e.g. .mov =>
        // video/quicktime), and a mismatch makes the API reject the request
        // with INVALID_ARGUMENT, so resolve the real one from file metadata.
        let resolvedMimeType = mimeType;
        if (isFileReferenceSource(fileUri) && !isYouTubeUrl(fileUri)) {
          try {
            const fileId = `files/${fileUri.split('/').pop()}`;
            const metadata = await this.getFileMetadata(fileId);
            if (metadata.mimeType) {
              resolvedMimeType = metadata.mimeType;
            }
          } catch {
            // Keep the fallback mimeType if metadata lookup fails
          }
        }
        content = {
          fileData: {
            fileUri,
            mimeType: resolvedMimeType,
          },
        };
        uploadDuration = processDuration;
      }

      const model = this.resolveModelForFunction(
        'video',
        options?.functionName
      );

      const enabled =
        process.env.AI_VISION_LOG_MODELS === '1' ||
        process.env.LOG_LEVEL === 'debug';
      if (enabled) {
        void this.logger.info(
          {
            msg: 'Gemini request (video)',
            baseUrl: this.baseUrl,
            model,
            functionName: options?.functionName ?? null,
          },
          'models'
        );
      }

      // Build video metadata for the request if provided.
      // Per the Gemini API, videoMetadata must live on the media Part itself
      // (next to inlineData/fileData), not at the request top level.
      const videoMetadata = this.buildVideoMetadata(options?.videoMetadata);
      if (videoMetadata) {
        content.videoMetadata = videoMetadata;
      }

      // ultra_high media resolution must live on the media Part itself
      const partMediaResolution = this.getPartMediaResolution(
        'video',
        options
      );
      if (partMediaResolution) {
        content.mediaResolution = partMediaResolution;
      }

      // Agentic video understanding (default on supported models): the model
      // navigates the video on demand instead of ingesting every frame.
      const videoProcessing = this.getVideoPartProcessing(
        this.resolveModelForFunction('video', options?.functionName),
        options
      );
      if (videoProcessing) {
        content.mediaProcessing = videoProcessing;
      }

      const { result: response, duration: analysisDuration } =
        await this.measureAsync(async () => {
          return await this.client.models.generateContent({
            model,
            contents: [content, { text: prompt }],
            config: this.buildConfigWithOptions(
              'video',
              options?.functionName,
              options
            ),
          });
        });

      const text = response.text || '';
      const usage = response.usageMetadata;

      return this.createAnalysisResult(
        text,
        model,
        usage
          ? {
            promptTokenCount: usage.promptTokenCount || 0,
            candidatesTokenCount: usage.candidatesTokenCount || 0,
            totalTokenCount: usage.totalTokenCount || 0,
          }
          : undefined,
        uploadDuration + analysisDuration,
        content.fileData?.mimeType || content.inlineData?.mimeType,
        undefined, // fileSize not available for video
        response.modelVersion,
        response.responseId
      );
    } catch (error) {
      throw this.handleError(error, 'video analysis');
    }
  }

  async uploadFile(
    buffer: Buffer,
    filename: string,
    mimeType: string
  ): Promise<UploadedFile> {
    try {
      const { result: fileMetadata } = await this.measureAsync(async () => {
        return await this.uploadToGeminiFiles(buffer, filename, mimeType);
      });

      return {
        id: fileMetadata.name,
        filename,
        mimeType,
        size: buffer.length,
        uri: fileMetadata.uri,
        displayName: fileMetadata.displayName,
        state: fileMetadata.state as 'PROCESSING' | 'ACTIVE' | 'FAILED',
        createTime: fileMetadata.createTime,
        updateTime: fileMetadata.updateTime,
        expirationTime: fileMetadata.expirationTime,
        sha256Hash: fileMetadata.sha256Hash,
      };
    } catch (error) {
      throw this.handleError(error, 'file upload');
    }
  }

  /**
   * Canonical upload: stream a local file to the Files API from its path.
   * The SDK's Node uploader reads the file in 8MB chunks over the resumable
   * upload protocol, so nothing is buffered fully in memory - works
   * identically for a 1MB clip or a 2GB recording (the Files API cap).
   */
  async uploadFileFromPath(
    filePath: string,
    mimeType: string,
    displayName?: string
  ): Promise<UploadedFile> {
    try {
      const stat = await fs.stat(filePath);
      const name = displayName ?? path.basename(filePath);

      const { result: file } = await this.measureAsync(async () => {
        return await this.client.files.upload({
          file: filePath,
          config: { mimeType, displayName: name },
        });
      });

      return {
        id: file.name || '',
        filename: name,
        mimeType: file.mimeType || mimeType,
        size: stat.size,
        uri: file.uri || '',
        displayName: file.displayName || name,
        state: (file.state as 'PROCESSING' | 'ACTIVE' | 'FAILED') || undefined,
        createTime: file.createTime,
        updateTime: file.updateTime,
        expirationTime: file.expirationTime,
        sha256Hash: file.sha256Hash,
      };
    } catch (error) {
      throw this.handleError(error, 'file upload');
    }
  }

  async downloadFile(fileId: string): Promise<Buffer> {
    try {
      // First get file metadata to get the download URL
      await this.getFileMetadata(fileId);

      // For Gemini Files API, we typically need to use the URI directly
      // This is a simplified implementation - in practice, you might need to use a different approach
      const response = await fetch(
        `${this.baseUrl}/v1beta/${fileId}?alt=media`,
        {
          headers: {
            'x-goog-api-key': this.config.apiKey,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to download file: ${response.statusText}`);
      }

      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      throw this.handleError(error, 'file download');
    }
  }

  /**
   * Resolve an audio source (files/ ref, local path, data URI, or URL) to a
   * fileData content part via the canonical Files API upload path.
   */
  private async resolveAudioContent(audioSource: string): Promise<{
    content: any;
    fileSize?: number;
    processingDuration: number;
  }> {
    let processingDuration = 0;

    if (isFileReferenceSource(audioSource)) {
      // Files API reference: resolve the real mimeType from metadata
      let mimeType = 'audio/mpeg';
      try {
        const fileId = `files/${audioSource.split('/').pop()}`;
        const metadata = await this.getFileMetadata(fileId);
        if (metadata.mimeType) mimeType = metadata.mimeType;
      } catch {
        // keep fallback
      }
      return {
        content: { fileData: { fileUri: audioSource, mimeType } },
        processingDuration,
      };
    }

    // Canonical single upload path: everything goes through the Files
    // API regardless of size. Local files stream from disk (resumable,
    // chunked); data URIs and remote URLs upload their fetched bytes.
    let uploadedFile: UploadedFile;
    let fileSize: number | undefined;
    const isLocalFile =
      !audioSource.startsWith('data:') && !/^https?:\/\//i.test(audioSource);

    if (isLocalFile) {
      const stat = await fs.stat(audioSource).catch(() => {
        throw new FileNotFoundError(audioSource);
      });
      fileSize = stat.size;
      const { result, duration } = await this.measureAsync(async () => {
        return await this.uploadFileFromPath(
          audioSource,
          getAudioMimeType(audioSource),
          path.basename(audioSource)
        );
      });
      uploadedFile = result;
      processingDuration += duration;
    } else {
      const { result: loaded, duration: loadDuration } =
        await this.measureAsync(async () => loadAudioSource(audioSource));
      processingDuration += loadDuration;
      fileSize = loaded.buffer.length;

      const { result, duration: uploadDuration } = await this.measureAsync(
        async () => {
          return await this.uploadFile(
            loaded.buffer,
            loaded.filename,
            loaded.mimeType
          );
        }
      );
      uploadedFile = result;
      processingDuration += uploadDuration;
    }

    const fileId = uploadedFile.uri!.split('/').pop()!;
    await this.waitForFileProcessing(fileId);
    return {
      content: {
        fileData: {
          fileUri: uploadedFile.uri!,
          mimeType: uploadedFile.mimeType,
        },
      },
      fileSize,
      processingDuration,
    };
  }

  /**
   * Extract response text, including audioTranscription parts returned by
   * dedicated transcription models (gemini-3.5-transcribe). Segments are
   * prefixed with speaker labels when diarization produced them.
   */
  private extractTextWithTranscription(response: any): string {
    const parts = response.candidates?.[0]?.content?.parts || [];
    const segments: string[] = [];
    for (const part of parts) {
      if (part.text) {
        segments.push(part.text);
      } else if (part.audioTranscription?.text) {
        const t = part.audioTranscription;
        const startOffset = t.words?.[0]?.startOffset;
        const prefix = [
          startOffset ? `[${startOffset}]` : null,
          t.speakerLabel ? `[${t.speakerLabel}]` : null,
        ]
          .filter(Boolean)
          .join(' ');
        segments.push(prefix ? `${prefix} ${t.text}` : t.text);
      }
    }
    return segments.join('\n') || response.text || '';
  }

  async analyzeAudio(
    audioSource: string,
    prompt: string,
    options?: AnalysisOptions
  ): Promise<AnalysisResult> {
    try {
      const { content, fileSize, processingDuration } =
        await this.resolveAudioContent(audioSource);

      const model = this.resolveModelForFunction(
        'video',
        options?.functionName
      );

      const { result: response, duration: analysisDuration } =
        await this.measureAsync(async () => {
          return await this.client.models.generateContent({
            model,
            contents: [content, { text: prompt }],
            config: this.buildConfigWithOptions(
              'video',
              options?.functionName,
              options
            ),
          });
        });

      const text = this.extractTextWithTranscription(response);
      const usage = response.usageMetadata;

      return this.createAnalysisResult(
        text,
        model,
        usage
          ? {
            promptTokenCount: usage.promptTokenCount || 0,
            candidatesTokenCount: usage.candidatesTokenCount || 0,
            totalTokenCount: usage.totalTokenCount || 0,
          }
          : undefined,
        processingDuration + analysisDuration,
        content.fileData?.mimeType || content.inlineData?.mimeType,
        fileSize,
        response.modelVersion,
        response.responseId
      );
    } catch (error) {
      throw this.handleError(error, 'audio analysis');
    }
  }

  async transcribeAudio(
    audioSource: string,
    options?: TranscriptionOptions
  ): Promise<AnalysisResult> {
    try {
      const { content, fileSize, processingDuration } =
        await this.resolveAudioContent(audioSource);

      const model =
        options?.model ?? this.configService.getTranscribeAudioModel();

      // SMART mode is incompatible with timestamps/diarization per the API
      let mode = options?.mode;
      if (mode === 'smart' && (options?.diarization || options?.wordTimestamps)) {
        console.error(
          '[GeminiProvider] transcription mode "smart" is incompatible with diarization/wordTimestamps; using "verbatim"'
        );
        mode = 'verbatim';
      }

      // The API also rejects customVocabulary combined with word timestamps
      let customVocabulary = options?.customVocabulary;
      if (customVocabulary?.length && options?.wordTimestamps) {
        console.error(
          '[GeminiProvider] customVocabulary is incompatible with wordTimestamps; dropping customVocabulary for this request'
        );
        customVocabulary = undefined;
      }

      const transcriptionConfig: Record<string, unknown> = {};
      if (mode) {
        transcriptionConfig.mode = mode === 'smart' ? 'SMART' : 'VERBATIM';
      }
      if (options?.diarization) transcriptionConfig.diarization = true;
      if (options?.wordTimestamps) transcriptionConfig.wordTimestamp = true;
      if (options?.languageCodes?.length) {
        transcriptionConfig.languageCodes = options.languageCodes;
      }
      if (customVocabulary?.length) {
        transcriptionConfig.customVocabulary = customVocabulary;
      }

      const config: any = {};
      if (Object.keys(transcriptionConfig).length > 0) {
        config.audioTranscriptionConfig = transcriptionConfig;
      }
      const safetySettings = this.configService.getSafetySettings();
      if (safetySettings) config.safetySettings = safetySettings;

      const { result: response, duration: analysisDuration } =
        await this.measureAsync(async () => {
          return await this.client.models.generateContent({
            model,
            contents: [content],
            config: Object.keys(config).length > 0 ? config : undefined,
          });
        });

      const text = this.extractTextWithTranscription(response);
      const usage = response.usageMetadata;

      return this.createAnalysisResult(
        text,
        model,
        usage
          ? {
            promptTokenCount: usage.promptTokenCount || 0,
            candidatesTokenCount: usage.candidatesTokenCount || 0,
            totalTokenCount: usage.totalTokenCount || 0,
          }
          : undefined,
        processingDuration + analysisDuration,
        content.fileData?.mimeType,
        fileSize,
        response.modelVersion,
        response.responseId
      );
    } catch (error) {
      throw this.handleError(error, 'audio transcription');
    }
  }

  async analyzeDocument(
    documentSource: string,
    prompt: string,
    options?: AnalysisOptions
  ): Promise<AnalysisResult> {
    try {
      let content: any;
      let fileSize: number | undefined;
      let processingDuration = 0;

      if (isFileReferenceSource(documentSource)) {
        // Files API reference: resolve the real mimeType from metadata
        let mimeType = 'application/pdf';
        try {
          const fileId = `files/${documentSource.split('/').pop()}`;
          const metadata = await this.getFileMetadata(fileId);
          if (metadata.mimeType) mimeType = metadata.mimeType;
        } catch {
          // keep fallback
        }
        content = { fileData: { fileUri: documentSource, mimeType } };
      } else {
        // Canonical single upload path: Files API for every size.
        let uploadedFile: UploadedFile;
        const isLocalFile =
          !documentSource.startsWith('data:') &&
          !/^https?:\/\//i.test(documentSource);

        if (isLocalFile) {
          const stat = await fs.stat(documentSource).catch(() => {
            throw new FileNotFoundError(documentSource);
          });
          fileSize = stat.size;
          const { result, duration } = await this.measureAsync(async () => {
            return await this.uploadFileFromPath(
              documentSource,
              getDocumentMimeType(documentSource),
              path.basename(documentSource)
            );
          });
          uploadedFile = result;
          processingDuration += duration;
        } else {
          const { result: loaded, duration: loadDuration } =
            await this.measureAsync(async () =>
              loadDocumentSource(documentSource)
            );
          processingDuration += loadDuration;
          fileSize = loaded.buffer.length;

          const { result, duration: uploadDuration } = await this.measureAsync(
            async () => {
              return await this.uploadFile(
                loaded.buffer,
                loaded.filename,
                loaded.mimeType
              );
            }
          );
          uploadedFile = result;
          processingDuration += uploadDuration;
        }

        const fileId = uploadedFile.uri!.split('/').pop()!;
        await this.waitForFileProcessing(fileId);
        content = {
          fileData: {
            fileUri: uploadedFile.uri!,
            mimeType: uploadedFile.mimeType,
          },
        };
      }

      // PDF pages are tokenized like images: part-level mediaResolution
      // applies (ultra_high included, for dense tables / small print).
      const partMediaResolution = this.getPartMediaResolution(
        'image',
        options
      );
      if (partMediaResolution) {
        content.mediaResolution = partMediaResolution;
      }

      const model = this.resolveModelForFunction(
        'image',
        options?.functionName
      );

      const { result: response, duration: analysisDuration } =
        await this.measureAsync(async () => {
          return await this.client.models.generateContent({
            model,
            contents: [content, { text: prompt }],
            config: this.buildConfigWithOptions(
              'image',
              options?.functionName,
              options
            ),
          });
        });

      const text = response.text || '';
      const usage = response.usageMetadata;

      return this.createAnalysisResult(
        text,
        model,
        usage
          ? {
            promptTokenCount: usage.promptTokenCount || 0,
            candidatesTokenCount: usage.candidatesTokenCount || 0,
            totalTokenCount: usage.totalTokenCount || 0,
          }
          : undefined,
        processingDuration + analysisDuration,
        content.fileData?.mimeType || content.inlineData?.mimeType,
        fileSize,
        response.modelVersion,
        response.responseId
      );
    } catch (error) {
      throw this.handleError(error, 'document analysis');
    }
  }

  /** Resolve a video source to a fileData part for video-to-image editing. */
  private async resolveVideoPartForEdit(videoSource: string): Promise<any> {
    if (isYouTubeUrl(videoSource)) {
      return { fileData: { fileUri: videoSource, mimeType: 'video/mp4' } };
    }
    if (isFileReferenceSource(videoSource)) {
      let mimeType = 'video/mp4';
      try {
        const fileId = `files/${videoSource.split('/').pop()}`;
        const metadata = await this.getFileMetadata(fileId);
        if (metadata.mimeType) mimeType = metadata.mimeType;
      } catch {
        // keep fallback
      }
      return { fileData: { fileUri: videoSource, mimeType } };
    }

    // Local file path: canonical streaming Files API upload
    await fs.stat(videoSource).catch(() => {
      throw new FileNotFoundError(videoSource);
    });
    const ext = path.extname(videoSource).replace('.', '').toLowerCase();
    const mimeByExt: Record<string, string> = {
      mp4: 'video/mp4',
      mov: 'video/quicktime',
      avi: 'video/x-msvideo',
      webm: 'video/webm',
      mkv: 'video/x-matroska',
      mpeg: 'video/mpeg',
      mpg: 'video/mpg',
    };
    const uploaded = await this.uploadFileFromPath(
      videoSource,
      mimeByExt[ext] || 'video/mp4',
      path.basename(videoSource)
    );
    const fileId = uploaded.uri!.split('/').pop()!;
    await this.waitForFileProcessing(fileId);
    return {
      fileData: { fileUri: uploaded.uri!, mimeType: uploaded.mimeType },
    };
  }

  async editImage(
    inputs: EditImageInput[],
    prompt: string,
    options?: EditImageOptions
  ): Promise<EditImageResult> {
    try {
      let model = this.configService.getEditImageModel();

      // Video-to-image is exclusive to gemini-3.1-flash-image
      if (
        options?.videoSource &&
        model !== ConfigService.VIDEO_TO_IMAGE_MODEL
      ) {
        console.error(
          `[GeminiProvider] video-to-image requires ${ConfigService.VIDEO_TO_IMAGE_MODEL}; overriding EDIT_IMAGE_MODEL (${model}) for this request`
        );
        model = ConfigService.VIDEO_TO_IMAGE_MODEL;
      }

      // Image models use a dedicated config: responseModalities + imageConfig.
      // Sampling/thinking/mediaResolution settings from the analysis path do
      // not apply here.
      const config: any = { responseModalities: ['TEXT', 'IMAGE'] };
      const safetySettings = this.configService.getSafetySettings();
      if (safetySettings) {
        config.safetySettings = safetySettings;
      }
      if (options?.aspectRatio || options?.imageSize) {
        config.imageConfig = {
          ...(options?.aspectRatio && { aspectRatio: options.aspectRatio }),
          ...(options?.imageSize && { imageSize: options.imageSize }),
        };
      }

      const parts: any[] = [];
      if (options?.videoSource) {
        parts.push(await this.resolveVideoPartForEdit(options.videoSource));
      }
      parts.push(
        ...inputs.map(input => ({
          inlineData: { mimeType: input.mimeType, data: input.data },
        }))
      );
      parts.push({ text: prompt });

      const { result: response, duration } = await this.measureAsync(
        async () => {
          return await this.client.models.generateContent({
            model,
            contents: [{ role: 'user', parts }],
            config,
          });
        }
      );

      const outParts = response.candidates?.[0]?.content?.parts ?? [];
      const images: EditImageResult['images'] = [];
      const textChunks: string[] = [];
      for (const part of outParts as any[]) {
        if (part.inlineData?.data) {
          images.push({
            data: Buffer.from(part.inlineData.data, 'base64'),
            mimeType: part.inlineData.mimeType || 'image/png',
          });
        } else if (part.text) {
          textChunks.push(part.text);
        }
      }

      const usage = response.usageMetadata;
      return {
        images,
        text: textChunks.join('\n').trim(),
        metadata: {
          model,
          provider: this.providerName,
          usage: usage
            ? {
              promptTokenCount: usage.promptTokenCount || 0,
              candidatesTokenCount: usage.candidatesTokenCount || 0,
              totalTokenCount: usage.totalTokenCount || 0,
            }
            : undefined,
          processingTime: duration,
          modelVersion: response.modelVersion,
          responseId: response.responseId,
        },
      };
    } catch (error) {
      throw this.handleError(error, 'image editing');
    }
  }

  async deleteFile(fileId: string): Promise<void> {
    try {
      await this.client.files.delete({ name: fileId });
    } catch (error) {
      // Ignore 404 errors (file already deleted)
      if (!(error instanceof Error && error.message.includes('404'))) {
        throw this.handleError(error, 'file deletion');
      }
    }
  }

  getSupportedFormats(): ProviderCapabilities {
    return {
      ...this.getProviderCapabilities(),
      supportedImageFormats: [
        'png',
        'jpg',
        'jpeg',
        'webp',
        'gif',
        'bmp',
        'tiff',
        'heic',
        'heif',
      ],
      supportedVideoFormats: [
        'mp4',
        'mov',
        'avi',
        'mkv',
        'webm',
        'flv',
        'wmv',
        '3gp',
        'm4v',
      ],
      maxImageSize: 20 * 1024 * 1024, // 20MB
      maxVideoSize: 100 * 1024 * 1024, // 100MB for direct upload
      maxVideoDuration: 3600, // 1 hour
      supportsFileUpload: true,
    };
  }

  getModelCapabilities(): ModelCapabilities {
    return {
      ...this.getBaseModelCapabilities(),
      imageAnalysis: true,
      videoAnalysis: true,
      maxTokensForImage: 500, // Default from config
      maxTokensForVideo: 2000, // Default from config
      supportedFormats: this.getSupportedFormats().supportedImageFormats.concat(
        this.getSupportedFormats().supportedVideoFormats
      ),
    };
  }

  getProviderInfo(): ProviderInfo {
    return {
      name: 'Google Gemini',
      version: '2.0',
      description:
        'Google Gemini multimodal AI model for image and video analysis',
      capabilities: this.getSupportedFormats(),
      modelCapabilities: this.getModelCapabilities(),
    };
  }

  async healthCheck(): Promise<HealthStatus> {
    try {
      const { duration } = await this.measureAsync(async () => {
        // Simple test with minimal content
        await this.client.models.generateContent({
          model: this.resolveModelForFunction(
            'image',
            FUNCTION_NAMES.ANALYZE_IMAGE
          ),
          contents: [{ text: 'Hello' }],
        });
      });

      return this.createHealthStatus('healthy', duration);
    } catch (error) {
      return this.createHealthStatus(
        'unhealthy',
        undefined,
        this.getErrorMessage(error)
      );
    }
  }

  // Private helper methods

  private buildVideoMetadata(videoMetadata?: {
    startOffset?: string | number;
    endOffset?: string | number;
    fps?: number;
  }): { startOffset?: string; endOffset?: string; fps?: number } | undefined {
    if (!videoMetadata) {
      return undefined;
    }

    const result: { startOffset?: string; endOffset?: string; fps?: number } = {};

    if (videoMetadata.startOffset !== undefined) {
      const formatted = formatDuration(videoMetadata.startOffset);
      if (formatted) {
        result.startOffset = formatted;
      }
    }

    if (videoMetadata.endOffset !== undefined) {
      const formatted = formatDuration(videoMetadata.endOffset);
      if (formatted) {
        result.endOffset = formatted;
      }
    }

    if (videoMetadata.fps !== undefined) {
      result.fps = videoMetadata.fps;
    }

    // Return undefined if no valid metadata was provided
    if (Object.keys(result).length === 0) {
      return undefined;
    }

    return result;
  }

  private buildVideoUri(videoSource: string): string {
    // If it's already a full URL, return as-is
    if (videoSource.startsWith('http')) {
      return videoSource;
    }
    // Otherwise, assume it's a file ID and construct the URI
    return `${this.baseUrl}/v1beta/${videoSource}`;
  }

  private async uploadToGeminiFiles(
    buffer: Buffer,
    filename: string,
    mimeType: string
  ): Promise<GeminiFileMetadata> {
    try {
      // Use the new @google/genai SDK's file upload API
      const blob = new Blob([buffer], { type: mimeType });
      const file = await this.client.files.upload({
        file: blob as any, // Cast to any since SDK expects Blob but type may not match exactly
        config: {
          mimeType,
          displayName: filename,
        },
      });

      // Map the new SDK's File type to our GeminiFileMetadata type
      return {
        name: file.name || '',
        displayName: file.displayName || filename,
        mimeType: file.mimeType || mimeType,
        sizeBytes: file.sizeBytes || String(buffer.length),
        createTime: file.createTime || new Date().toISOString(),
        updateTime: file.updateTime || new Date().toISOString(),
        expirationTime: file.expirationTime || '',
        sha256Hash: file.sha256Hash || '',
        uri: file.uri || '',
        state:
          (file.state as 'PROCESSING' | 'ACTIVE' | 'FAILED') || 'PROCESSING',
      };
    } catch (error) {
      throw new FileUploadError(
        `Failed to upload file to Gemini: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async getFileMetadata(fileId: string): Promise<GeminiFileMetadata> {
    try {
      const file = await this.client.files.get({ name: fileId });

      return {
        name: file.name || fileId,
        displayName: file.displayName || '',
        mimeType: file.mimeType || '',
        sizeBytes: file.sizeBytes || '0',
        createTime: file.createTime || '',
        updateTime: file.updateTime || '',
        expirationTime: file.expirationTime || '',
        sha256Hash: file.sha256Hash || '',
        uri: file.uri || '',
        state:
          (file.state as 'PROCESSING' | 'ACTIVE' | 'FAILED') || 'PROCESSING',
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('404')) {
        throw new FileNotFoundError(fileId, 'gemini');
      }
      throw new Error(
        `Failed to get file metadata: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async waitForFileProcessing(fileId: string): Promise<void> {
    // Large videos can stay in PROCESSING for several minutes (a 5-minute
    // 4K screen recording routinely needs 2-4 minutes), so wait up to 10
    // minutes with gentle backoff. The old 60s cap made every big upload
    // fail with a spurious timeout.
    const maxWaitMs = 10 * 60 * 1000;
    const startedAt = Date.now();
    let delay = 2000;
    let lastError: unknown;

    while (Date.now() - startedAt < maxWaitMs) {
      try {
        const fileMetadata = await this.getFileMetadata(fileId);

        if (fileMetadata.state === 'ACTIVE') {
          return; // File is ready for use
        }

        if (fileMetadata.state === 'FAILED') {
          throw new FileUploadError(
            `The Files API could not process this file (state FAILED). The file may be corrupt or use an unsupported codec/container variant. For videos, re-encoding usually fixes it: ffmpeg -i input -c:v libx264 -pix_fmt yuv420p -movflags +faststart output.mp4`,
            'gemini'
          );
        }

        const elapsed = Math.round((Date.now() - startedAt) / 1000);
        if (elapsed > 0 && elapsed % 30 < delay / 1000) {
          console.error(
            `[GeminiProvider] File ${fileId} still processing after ${elapsed}s...`
          );
        }
      } catch (error) {
        if (error instanceof FileUploadError) {
          throw error;
        }
        // Network errors: remember and retry until the deadline
        lastError = error;
      }

      await new Promise(resolve => setTimeout(resolve, delay));
      delay = Math.min(delay * 1.5, 5000);
    }

    throw new FileUploadError(
      `File processing timed out after ${Math.round(maxWaitMs / 1000)} seconds${lastError ? ` (last error: ${lastError instanceof Error ? lastError.message : String(lastError)})` : ''}`,
      'gemini'
    );
  }

  // Public getters for file upload strategy
  getApiBaseUrl(): string {
    return this.baseUrl;
  }

  getApiKey(): string {
    return this.config.apiKey;
  }

  private getVideoMimeTypeFromUrl(url: string): string {
    const extension = url.split('.').pop()?.toLowerCase();
    const mimeTypes: Record<string, string> = {
      mp4: 'video/mp4',
      mov: 'video/quicktime',
      avi: 'video/x-msvideo',
      mkv: 'video/x-matroska',
      webm: 'video/webm',
      flv: 'video/x-flv',
      wmv: 'video/x-ms-wmv',
      '3gp': 'video/3gpp',
      m4v: 'video/mp4',
    };
    return mimeTypes[extension || ''] || 'video/mp4';
  }

  private getVideoMimeType(source: string, buffer: Buffer): string {
    // Try to detect from file extension
    const extension = source.split('.').pop()?.toLowerCase();
    const mimeTypes: Record<string, string> = {
      mp4: 'video/mp4',
      mov: 'video/quicktime',
      avi: 'video/x-msvideo',
      mkv: 'video/x-matroska',
      webm: 'video/webm',
      flv: 'video/x-flv',
      wmv: 'video/x-ms-wmv',
      '3gp': 'video/3gpp',
      m4v: 'video/mp4',
    };

    if (extension && mimeTypes[extension]) {
      return mimeTypes[extension];
    }

    // Simple detection based on file signature
    const signatures: Record<string, string> = {
      'video/mp4': '\x00\x00\x00\x18ftypmp42',
      'video/webm': '\x1a\x45\xdf\xa3',
      'video/avi': 'RIFF',
      'video/mov': '\x00\x00\x00\x14ftyp',
    };

    for (const [mimeType, signature] of Object.entries(signatures)) {
      if (buffer.slice(0, signature.length).toString() === signature) {
        return mimeType;
      }
    }

    return 'video/mp4'; // Default fallback
  }

  private handleError(error: unknown, operation: string): Error {
    if (error instanceof Error) {
      if (
        error.message.includes('network') ||
        error.message.includes('fetch')
      ) {
        return new NetworkError(error.message, error);
      }
      if (
        error.message.includes('rate limit') ||
        error.message.includes('quota')
      ) {
        // Return a generic rate limit error - specific retry info would come from headers
        return new ProviderError(
          `Rate limit exceeded during ${operation}`,
          'gemini',
          error,
          429
        );
      }
      if (
        error.message.includes('authentication') ||
        error.message.includes('unauthorized')
      ) {
        return new ProviderError(
          `Authentication failed during ${operation}: ${error.message}`,
          'gemini',
          error,
          401
        );
      }
      return new ProviderError(
        `Failed during ${operation}: ${error.message}`,
        'gemini',
        error
      );
    }

    return new ProviderError(
      `Unknown error during ${operation}`,
      'gemini',
      error as Error
    );
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }
}
