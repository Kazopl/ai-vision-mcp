/**
 * Provider interface and types
 */

import type {
  AnalysisOptions,
  AnalysisResult,
  UploadedFile,
  FileReference,
  HealthStatus,
  ProviderCapabilities,
  ModelCapabilities,
  ProviderInfo,
} from './Analysis.js';

export type {
  AnalysisOptions,
  AnalysisResult,
  UploadedFile,
  FileReference,
  HealthStatus,
  ProviderCapabilities,
  ModelCapabilities,
  ProviderInfo,
} from './Analysis.js';

/** Options for the dedicated transcribe_audio tool (gemini-3.5-transcribe). */
export interface TranscriptionOptions {
  /** Label speakers (Speaker 1, Speaker 2, ...). Incompatible with mode 'smart'. */
  diarization?: boolean;
  /** Word-level timestamps. Incompatible with mode 'smart'. */
  wordTimestamps?: boolean;
  /** 'verbatim' (default) or 'smart' (removes filler words, adds formatting). */
  mode?: 'verbatim' | 'smart';
  /** BCP-47 language hints (auto-detect when omitted), e.g. ['en-US', 'ro-RO']. */
  languageCodes?: string[];
  /** Up to 1000 terms to bias recognition (names, jargon, acronyms). */
  customVocabulary?: string[];
  /** Override the transcription model. */
  model?: string;
}

export interface VisionProvider {
  // Core capabilities
  analyzeImage(
    imageSource: string,
    prompt: string,
    options?: AnalysisOptions
  ): Promise<AnalysisResult>;
  analyzeVideo(
    videoSource: string,
    prompt: string,
    options?: AnalysisOptions
  ): Promise<AnalysisResult>;
  /** Optional: audio understanding (transcription, summarization, speaker ID) */
  analyzeAudio?(
    audioSource: string,
    prompt: string,
    options?: AnalysisOptions
  ): Promise<AnalysisResult>;
  /** Optional: document understanding (PDF layouts, tables, charts + text docs) */
  analyzeDocument?(
    documentSource: string,
    prompt: string,
    options?: AnalysisOptions
  ): Promise<AnalysisResult>;
  /** Optional: dedicated speech-to-text (word timestamps, diarization) */
  transcribeAudio?(
    audioSource: string,
    options?: TranscriptionOptions
  ): Promise<AnalysisResult>;
  /** Optional: Decisions API - calibrated yes/no, choice and score answers */
  evaluateMedia?(
    media: import('./Decision.js').DecisionMediaInput[],
    questions: import('./Decision.js').DecisionQuestion[],
    context?: string,
    options?: import('./Decision.js').EvaluateMediaOptions
  ): Promise<import('./Decision.js').EvaluateMediaResult>;
  /** Optional: real MIME type of a provider file reference */
  getFileReferenceInfo?(
    fileRef: string
  ): Promise<{ uri: string; mimeType: string }>;
  /** Optional: upload an audio/document source and return its file reference */
  prepareFileReference?(
    source: string,
    kind: 'audio' | 'document'
  ): Promise<{ uri: string; mimeType: string }>;
  /** Optional: image editing/generation via Nano Banana image models */
  editImage?(
    inputs: import('./ImageEdit.js').EditImageInput[],
    prompt: string,
    options?: import('./ImageEdit.js').EditImageOptions
  ): Promise<import('./ImageEdit.js').EditImageResult>;
  compareImages(
    imageSources: string[],
    prompt: string,
    options?: AnalysisOptions
  ): Promise<AnalysisResult>;

  // File operations
  uploadFile(
    buffer: Buffer,
    filename: string,
    mimeType: string
  ): Promise<UploadedFile>;
  /** Optional streaming upload from a local file path (no memory buffering) */
  uploadFileFromPath?(
    filePath: string,
    mimeType: string,
    displayName?: string
  ): Promise<UploadedFile>;
  downloadFile(fileId: string): Promise<Buffer>;
  deleteFile(fileId: string): Promise<void>;

  // Model configuration
  setModel(imageModel: string, videoModel: string): void;
  getImageModel(): string;
  getVideoModel(): string;

  // Provider information
  getSupportedFormats(): ProviderCapabilities;
  getModelCapabilities(): ModelCapabilities;
  getProviderInfo(): ProviderInfo;

  // Health and status
  healthCheck(): Promise<HealthStatus>;
  supportsVideo(): boolean;
}

export interface FileUploadStrategy {
  uploadFile(
    buffer: Buffer,
    filename: string,
    mimeType: string
  ): Promise<UploadedFile>;
  /** Optional streaming upload from a local file path (no memory buffering) */
  uploadFileFromPath?(
    filePath: string,
    filename: string,
    mimeType: string
  ): Promise<UploadedFile>;
  getFileForAnalysis(uploadedFile: UploadedFile): Promise<FileReference>;
  cleanup?(fileId: string): Promise<void>;
}

export interface ProviderConfig {
  name: string;
  type: 'image' | 'video';
  models: {
    image: string;
    video: string;
  };
  credentials: Record<string, string>;
  options: Record<string, unknown>;
}

export interface ProviderFactory {
  createProvider(config: ProviderConfig): VisionProvider;
  getSupportedProviders(): string[];
  registerProvider(name: string, factory: () => VisionProvider): void;
}

// Gemini-specific types
export interface GeminiConfig {
  apiKey: string;
  baseUrl: string;
  imageModel: string;
  videoModel: string;
}

export interface GeminiFileMetadata {
  name: string;
  displayName: string;
  mimeType: string;
  sizeBytes: string;
  createTime: string;
  updateTime: string;
  expirationTime: string;
  sha256Hash: string;
  uri: string;
  state: 'PROCESSING' | 'ACTIVE' | 'FAILED';
  /** Video duration, e.g. "98s" (set once a video finishes processing) */
  videoDuration?: string;
}

export interface GeminiGenerateContentRequest {
  contents: GeminiContent[];
  generationConfig?: GeminiGenerationConfig;
  safetySettings?: GeminiSafetySetting[];
}

export interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

export type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
  | { fileData: { mimeType: string; fileUri: string } };

export interface GeminiGenerationConfig {
  temperature?: number;
  topP?: number;
  topK?: number;
  maxOutputTokens?: number;
  candidateCount?: number;
  stopSequences?: string[];
}

export interface GeminiSafetySetting {
  category: string;
  threshold: string;
}

export interface GeminiGenerateContentResponse {
  candidates: GeminiCandidate[];
  usageMetadata: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

export interface GeminiCandidate {
  content: GeminiContent;
  finishReason: string;
  index: number;
  safetyRatings?: GeminiSafetyRating[];
}

export interface GeminiSafetyRating {
  category: string;
  probability: string;
  blocked: boolean;
}

// Vertex AI-specific types
export interface VertexAIConfig {
  projectId: string;
  location: string;
  endpoint: string;
  clientEmail?: string;
  privateKey?: string;
  imageModel: string;
  videoModel: string;
}

export interface VertexAIGenerateContentRequest {
  contents: VertexAIContent[];
  generationConfig?: VertexAIGenerationConfig;
  safetySettings?: VertexAISafetySetting[];
}

export interface VertexAIContent {
  role: 'user' | 'model';
  parts: VertexAIPart[];
}

export type VertexAIPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
  | { fileData: { mimeType: string; fileUri: string } };

export interface VertexAIGenerationConfig {
  temperature?: number;
  topP?: number;
  topK?: number;
  maxOutputTokens?: number;
  candidateCount?: number;
  stopSequences?: string[];
}

export interface VertexAISafetySetting {
  category: string;
  threshold: string;
}

export interface VertexAIGenerateContentResponse {
  candidates: VertexAICandidate[];
  usageMetadata: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
  modelVersion?: string;
}

export interface VertexAICandidate {
  content: VertexAIContent;
  finishReason: string;
  index: number;
  safetyRatings?: VertexAISafetyRating[];
}

export interface VertexAISafetyRating {
  category: string;
  probability: string;
  blocked: boolean;
}
