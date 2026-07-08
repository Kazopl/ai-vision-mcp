/**
 * Analysis types for vision providers
 */

import { type FunctionName } from '../constants/FunctionNames.js';

export type TaskType = 'image' | 'video';

/**
 * Video metadata for clipping and frame rate control
 * Used with Gemini API for YouTube videos and file URIs
 */
export interface VideoMetadata {
  /** Start time offset (e.g., "40s", "2m30s", or seconds) */
  startOffset?: string | number;
  /** End time offset (e.g., "80s", "3m", or seconds) */
  endOffset?: string | number;
  /** Frame rate for sampling (default: 1, range: 0.1-30) */
  fps?: number;
}

export interface AnalysisOptions {
  temperature?: number | undefined;
  topP?: number | undefined;
  topK?: number | undefined;
  maxTokens?: number | undefined;
  maxTokensForImage?: number | undefined;
  maxTokensForVideo?: number | undefined;
  stopSequences?: string[] | undefined;
  taskType?: TaskType;
  functionName?: FunctionName;
  responseSchema?: any; // Structured output schema for object detection
  systemInstruction?: string | undefined; // System instruction to guide model behavior
  videoMetadata?: VideoMetadata; // Video clipping and frame rate settings
  mediaResolution?: MediaResolutionLevel; // Token resolution for input media (Gemini 3+)
  thinkingLevel?: ThinkingLevel; // Reasoning depth (Gemini 3+)
}

/**
 * Media resolution for input media tokenization (Gemini 3+ models).
 * 'low' ~66 tokens/frame, 'medium'/'high' ~258 tokens/frame (high uses zoomed
 * reframing), 'ultra_high' spends the most tokens for maximum fidelity.
 * Higher levels make small text (e.g. UI labels, URLs) readable in videos.
 */
export type MediaResolutionLevel = 'low' | 'medium' | 'high' | 'ultra_high';

/**
 * Thinking level for Gemini 3+ models (replaces the numeric thinkingBudget
 * used by Gemini 2.5). Higher levels improve hard reasoning/OCR at the cost
 * of latency and output tokens. Gemini 3.5 Flash defaults to 'medium';
 * Gemini 3.1 Flash-Lite defaults to 'minimal'.
 */
export type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high';

export interface AnalysisResult {
  text: string;
  metadata: AnalysisMetadata;
}

export interface AnalysisMetadata {
  model: string;
  provider: string;
  usage?: UsageMetadata;
  processingTime?: number;
  fileType?: string;
  fileSize?: number;
  modelVersion?: string; // "gemini-3.1-flash-lite"
  responseId?: string; // "abc123..."
}

export interface UsageMetadata {
  promptTokenCount: number;
  candidatesTokenCount: number;
  totalTokenCount: number;
}

export interface UploadedFile {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  url?: string;
  uri?: string;
  displayName?: string;
  state?: 'PROCESSING' | 'ACTIVE' | 'FAILED';
  createTime?: string;
  updateTime?: string;
  expirationTime?: string;
  sha256Hash?: string;
}

export interface FileReference {
  type: 'file_uri' | 'public_url' | 'base64';
  uri?: string;
  url?: string;
  data?: string;
  mimeType: string;
}

export interface HealthStatus {
  status: 'healthy' | 'unhealthy' | 'degraded';
  message?: string;
  lastCheck: string;
  responseTime?: number;
}

export interface RateLimitInfo {
  requestsPerMinute?: number;
  requestsPerDay?: number;
  currentUsage?: {
    requestsPerMinute: number;
    requestsPerDay: number;
  };
  resetTime?: string;
}

export interface ProviderCapabilities {
  supportedImageFormats: string[];
  supportedVideoFormats: string[];
  maxImageSize: number;
  maxVideoSize: number;
  maxVideoDuration: number;
  supportsVideo: boolean;
  supportsFileUpload: boolean;
}

export interface ModelCapabilities {
  imageAnalysis: boolean;
  videoAnalysis: boolean;
  maxTokensForImage: number;
  maxTokensForVideo: number;
  supportedFormats: string[];
}

export interface ProviderInfo {
  name: string;
  version: string;
  description: string;
  capabilities: ProviderCapabilities;
  modelCapabilities: ModelCapabilities;
  rateLimit?: RateLimitInfo; // Optional - rate limits vary by user tier/project
}
