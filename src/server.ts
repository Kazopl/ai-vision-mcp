/**
 * Main MCP Server implementation
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'fs/promises';
import { Image } from 'imagescript';
import { ConfigService } from './services/ConfigService.js';
import { FileService } from './services/FileService.js';
import { VisionProviderFactory } from './providers/factory/ProviderFactory.js';
import {
  analyze_image,
  compare_images,
  analyze_video,
  analyze_audio,
  detect_objects_in_image,
  segment_objects_in_image,
  audit_design,
  extract_video_frame,
} from './tools/index.js';
import { VisionError } from './types/Errors.js';

import { LoggerService } from './services/LoggerService.js';

const logger = LoggerService.getInstance('ai-vision-mcp');

// Ensure providers are initialized before server starts
try {
  VisionProviderFactory.initializeDefaultProviders();
  void logger.info({ msg: 'Providers initialized successfully' }, 'server');
} catch (error) {
  void logger.error(
    { msg: 'Failed to initialize providers', error: String(error) },
    'server'
  );
  throw error;
}

// Global exception handlers to prevent crashes from bubbling up and breaking stdio transport
process.on('uncaughtException', error => {
  void logger.error(
    { msg: 'Uncaught exception', error: String(error), stack: error.stack },
    'server'
  );
  // Don't exit - let MCP handle gracefully
});

process.on('unhandledRejection', reason => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  void logger.error(
    { msg: 'Unhandled rejection', error: error.message, stack: error.stack },
    'server'
  );
  // Don't exit - let MCP handle gracefully
});

// Create MCP server
const server = new McpServer(
  {
    name: 'ai-vision-mcp',
    version: '0.0.6',
  },
  {
    capabilities: { logging: {} },
  }
);

logger.attachServer(server);

// Helper function to initialize services (lazy loading)
function getServices() {
  try {
    void logger.info(
      { msg: 'getServices() called - initializing...' },
      'server'
    );

    // Initialize configuration
    void logger.info({ msg: 'Getting ConfigService instance...' }, 'server');
    const configService = ConfigService.getInstance();
    void logger.info({ msg: 'ConfigService instance obtained' }, 'server');

    void logger.info({ msg: 'Getting config...' }, 'server');
    const config = configService.getConfig();
    void logger.info(
      { msg: 'Config obtained', provider: config.IMAGE_PROVIDER },
      'server'
    );

    // Verify providers are registered
    void logger.info({ msg: 'Checking available providers...' }, 'server');
    const availableProviders = VisionProviderFactory.getSupportedProviders();
    void logger.info(
      { msg: 'Available providers', providers: availableProviders },
      'server'
    );

    if (availableProviders.length === 0) {
      throw new Error(
        'No providers registered. VisionProviderFactory.initializeDefaultProviders() may have failed.'
      );
    }

    // Create providers using factory
    void logger.info({ msg: 'Creating image provider...' }, 'server');
    const imageProvider = VisionProviderFactory.createProviderWithValidation(
      config,
      'image'
    );
    void logger.info({ msg: 'Image provider created' }, 'server');

    void logger.info({ msg: 'Creating video provider...' }, 'server');
    const videoProvider = VisionProviderFactory.createProviderWithValidation(
      config,
      'video'
    );
    void logger.info({ msg: 'Video provider created' }, 'server');

    // Create file services for handling file uploads
    void logger.info({ msg: 'Creating file services...' }, 'server');
    const imageFileService = new FileService(
      configService,
      'image',
      imageProvider as any
    );
    const videoFileService = new FileService(
      configService,
      'video',
      videoProvider as any
    );
    void logger.info({ msg: 'File services created' }, 'server');

    void logger.info({ msg: 'getServices() completed successfully' }, 'server');
    return {
      config,
      configService,
      imageProvider,
      videoProvider,
      imageFileService,
      videoFileService,
    };
  } catch (error) {
    void logger.error(
      { msg: 'Failed to initialize services', error: String(error) },
      'server'
    );
    throw error;
  }
}

/**
 * Build an MCP image content block from an annotated image on disk, so
 * clients render the result inline and the agent can see it directly.
 * The preview is downscaled to INLINE_IMAGE_MAX_DIM (default 1200px, 0
 * disables inline images); the full-resolution file stays on disk.
 */
async function buildInlineImageBlock(
  filePath: string
): Promise<{ type: 'image'; data: string; mimeType: string } | null> {
  const maxDim = process.env.INLINE_IMAGE_MAX_DIM
    ? parseInt(process.env.INLINE_IMAGE_MAX_DIM, 10)
    : 1200;
  if (!maxDim || maxDim <= 0 || isNaN(maxDim)) {
    return null;
  }

  try {
    const buffer = await fs.readFile(filePath);
    const image = await Image.decode(buffer);

    let encoded: Buffer;
    if (image.width > maxDim || image.height > maxDim) {
      const scale = Math.min(maxDim / image.width, maxDim / image.height);
      image.resize(
        Math.max(1, Math.round(image.width * scale)),
        Math.max(1, Math.round(image.height * scale))
      );
      encoded = Buffer.from(await image.encode());
    } else {
      encoded = buffer;
    }

    return {
      type: 'image' as const,
      data: encoded.toString('base64'),
      mimeType: 'image/png',
    };
  } catch (error) {
    void logger.error(
      {
        msg: 'Failed to build inline image block',
        filePath,
        error: String(error),
      },
      'server'
    );
    return null;
  }
}

// Register analyze_image tool
server.registerTool<any, any>(
  'analyze_image',
  {
    title: 'Analyze Image',
    description:
      'Analyze an image using AI vision models. Supports URLs, base64 data, and local file paths.',
    inputSchema: z.object({
      imageSource: z
        .string()
        .describe(
          'Image source - can be a URL, base64 data (data:image/...), or local file path'
        ),
      prompt: z
        .string()
        .describe(
          'The prompt describing how you want to compare the images. If the task is **front-end or UI comparison**, the prompt you provide must be: "Compare the given screenshots and describe differences in layout structure, component arrangement, color scheme, typography, and visual hierarchy. Pay attention to common sections such as the navbar, header, footer, and main content areas to identify style or layout inconsistencies." + your additional requirements. \ For **other tasks**, the prompt you provide must clearly describe what to compare, identify, or analyze between the images.'
        ),
      mode: z
        .enum(['general', 'palette', 'hierarchy', 'components'])
        .optional()
        .describe(
          'Analysis mode: general (default), palette (extract design tokens), hierarchy (analyze visual hierarchy), components (catalog UI components)'
        ),
      cropRegion: z
        .object({
          x: z.number().int().min(0).describe('Left edge in pixels'),
          y: z.number().int().min(0).describe('Top edge in pixels'),
          width: z.number().int().min(1).describe('Region width in pixels'),
          height: z.number().int().min(1).describe('Region height in pixels'),
        })
        .optional()
        .describe(
          'Crop the image to this pixel region (top-left origin) before analysis. Zooming into the region of interest greatly improves small-text OCR accuracy and reduces tokens. Not supported for files/ or gs:// sources.'
        ),
      options: z
        .object({
          temperature: z
            .number()
            .min(0)
            .max(2)
            .optional()
            .describe(
              'Controls randomness in the response (0.0 = deterministic, 2.0 = very random)'
            ),
          topP: z
            .number()
            .min(0)
            .max(1)
            .optional()
            .describe('Nucleus sampling parameter (0.0-1.0)'),
          topK: z
            .number()
            .int()
            .min(1)
            .max(100)
            .optional()
            .describe('Top-k sampling parameter (1-100)'),
          maxTokens: z
            .number()
            .int()
            .min(1)
            .max(8192)
            .optional()
            .describe(
              'Maximum number of tokens to generate in the response. For detailed image analysis, 1000-2000 tokens typically sufficient.'
            ),
          mediaResolution: z
            .enum(['low', 'medium', 'high', 'ultra_high'])
            .optional()
            .describe(
              'Token resolution for the input image (Gemini 3+ models only). Use "high" or "ultra_high" for dense fine text.'
            ),
          thinkingLevel: z
            .enum(['minimal', 'low', 'medium', 'high'])
            .optional()
            .describe(
              'Reasoning depth (Gemini 3+ models only). Use "high" for hard visual reasoning or precise OCR; "minimal"/"low" for fast simple descriptions. Thinking tokens count toward maxTokens, so pair "high" with maxTokens >= 4000 or the answer gets truncated.'
            ),
          agenticVision: z
            .boolean()
            .optional()
            .describe(
              'Agentic Vision (Gemini 3+ models). The model runs sandboxed Python to zoom, crop, annotate, and measure the image itself before answering - best for tiny text, fine details, precise counting, or reading dense UI. Adds latency (multiple code rounds) and is unnecessary for simple descriptions. An alternative to manually specifying cropRegion.'
            ),
        })
        .optional(),
    }),
  },
  async (args: any, _extra: any) => {
    const { imageSource, prompt, mode, cropRegion, options } = args;

    // Early validation - BEFORE calling getServices()
    if (
      !imageSource ||
      (typeof imageSource === 'string' && imageSource.trim() === '')
    ) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                error: true,
                message: 'imageSource is required',
                tool: 'analyze_image',
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }

    if (!prompt || (typeof prompt === 'string' && prompt.trim() === '')) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                error: true,
                message: 'prompt is required',
                tool: 'analyze_image',
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }

    try {
      const validatedArgs = { imageSource, prompt, mode, cropRegion, options };

      // Initialize services on-demand (only after validation passes)
      const { config, imageProvider, imageFileService } = getServices();

      const result = await analyze_image(
        validatedArgs,
        config,
        imageProvider,
        imageFileService
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      void logger.error(
        { msg: 'Error executing analyze_image tool', error: String(error) },
        'tools/analyze_image'
      );

      let errorMessage = 'An unknown error occurred';
      if (error instanceof VisionError) {
        errorMessage = `${error.name}: ${error.message}`;
        if (error.provider) {
          errorMessage += ` (Provider: ${error.provider})`;
        }
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                error: true,
                message: errorMessage,
                tool: 'analyze_image',
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }
  }
);

// Register compare_images tool
server.registerTool<any, any>(
  'compare_images',
  {
    title: 'Compare Images',
    description:
      'Compare multiple images using AI vision models. Supports URLs, base64 data, and local file paths.',
    inputSchema: z.object({
      imageSources: z
        .array(z.string())
        .min(2)
        .describe(
          'Array of image sources (URLs, base64 data, or file paths) - minimum 2 images. Maximum determined by MAX_IMAGES_FOR_COMPARISON environment variable (default: 4)'
        ),
      prompt: z
        .string()
        .describe(
          'The prompt describing how you want to compare the images. If the task is **front-end or UI consistency**, the prompt you provide must specify what to evaluate — such as layout alignment, component structure, spacing, typography, color consistency, and visual hierarchy. Pay special attention to shared sections like the **navbar**, **header**, **footer**, and **main content areas** to identify layout shifts or inconsistent styles between versions. \ For **other tasks**, the prompt you provide must clearly describe what aspects to compare or analyze — such as visual differences, content changes, design variations, or quality degradation.'
        ),
      options: z
        .object({
          temperature: z
            .number()
            .min(0)
            .max(2)
            .optional()
            .describe(
              'Controls randomness in the response (0.0 = deterministic, 2.0 = very random)'
            ),
          topP: z
            .number()
            .min(0)
            .max(1)
            .optional()
            .describe('Nucleus sampling parameter (0.0-1.0)'),
          topK: z
            .number()
            .int()
            .min(1)
            .max(100)
            .optional()
            .describe('Top-k sampling parameter (1-100)'),
          maxTokens: z
            .number()
            .int()
            .min(1)
            .max(8192)
            .optional()
            .describe(
              'Maximum number of tokens to generate in the response. For comparing multiple images, recommend 1500-3000 tokens for comprehensive analysis.'
            ),
        })
        .optional(),
    }),
  },
  async (args: any, _extra: any) => {
    const { imageSources, prompt, options } = args;

    // Early validation - BEFORE calling getServices()
    if (!Array.isArray(imageSources) || imageSources.length < 2) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                error: true,
                message: 'imageSources must be an array with at least 2 images',
                tool: 'compare_images',
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }

    if (!prompt || (typeof prompt === 'string' && prompt.trim() === '')) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                error: true,
                message: 'prompt is required',
                tool: 'compare_images',
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }

    try {
      // Initialize services on-demand (only after validation passes)
      const { config, imageProvider, imageFileService } = getServices();

      // Dynamic validation using config
      const maxImages = config.MAX_IMAGES_FOR_COMPARISON || 4;
      if (imageSources.length > maxImages) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  error: true,
                  message: `Maximum ${maxImages} images allowed for comparison, received ${imageSources.length}. Configure MAX_IMAGES_FOR_COMPARISON environment variable to change this limit.`,
                  tool: 'compare_images',
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }

      const validatedArgs = { imageSources, prompt, options };

      const result = await compare_images(
        validatedArgs,
        config,
        imageProvider,
        imageFileService
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      void logger.error(
        { msg: 'Error executing compare_images tool', error: String(error) },
        'tools/compare_images'
      );

      let errorMessage = 'An unknown error occurred';
      if (error instanceof VisionError) {
        errorMessage = `${error.name}: ${error.message}`;
        if (error.provider) {
          errorMessage += ` (Provider: ${error.provider})`;
        }
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                error: true,
                message: errorMessage,
                tool: 'compare_images',
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }
  }
);

// Register detect_objects_in_image tool
server.registerTool<any, any>(
  'detect_objects_in_image',
  {
    title: 'Detect Objects in Image',
    description:
      'Detect objects in an image using AI vision models and generate annotated images with bounding boxes. Supports URLs, base64 data, and local file paths. File handling: explicit filePath → exact path, otherwise → temp directory. Uses optimized default parameters for object detection.',
    inputSchema: z.object({
      imageSource: z
        .string()
        .describe(
          'Image source - can be a URL, base64 data (data:image/...), or local file path'
        ),
      prompt: z
        .string()
        .describe(
          'Text prompt describing what to detect or recognize in the image. Avoid including any instructions about output structure or formatting — these are automatically managed by the workflow.'
        ),
      outputFilePath: z
        .string()
        .optional()
        .describe(
          "Optional explicit output path for the annotated image. If provided, the image is saved to this exact path. Relative paths are resolved against the MCP server's current working directory."
        ),
      viewportWidth: z
        .number()
        .optional()
        .describe(
          'Optional logical viewport width (for web screenshots). Used to distinguish between actual image dimensions and logical viewport size.'
        ),
      viewportHeight: z
        .number()
        .optional()
        .describe(
          'Optional logical viewport height (for web screenshots). Used to distinguish between actual image dimensions and logical viewport size.'
        ),
    }),
  },
  async (args: any, _extra: any) => {
    const {
      imageSource,
      prompt,
      outputFilePath,
      viewportWidth,
      viewportHeight,
    } = args;
    try {
      const validatedArgs = {
        imageSource,
        prompt,
        outputFilePath,
        viewportWidth,
        viewportHeight,
        // Remove options parameter - use environment variable configuration instead
      };

      // Initialize services on-demand
      const { config, imageProvider, imageFileService } = getServices();

      const result = await detect_objects_in_image(
        validatedArgs,
        config,
        imageProvider,
        imageFileService
      );

      // Handle different response types; when an annotated image was saved,
      // also return it as an inline image block so clients can render it.
      const annotatedPath =
        'file' in result
          ? result.file.path
          : 'tempFile' in result
            ? result.tempFile.path
            : undefined;
      const inlineImage = annotatedPath
        ? await buildInlineImageBlock(annotatedPath)
        : null;

      const payload: Record<string, unknown> = {
        detections: result.detections,
        image_metadata: result.image_metadata,
        summary: result.summary,
        metadata: result.metadata,
      };
      if ('file' in result) payload.file = result.file;
      if ('tempFile' in result) payload.tempFile = result.tempFile;

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(payload, null, 2),
          },
          ...(inlineImage ? [inlineImage] : []),
        ],
      };
    } catch (error) {
      void logger.error(
        {
          msg: 'Error executing detect_objects_in_image tool',
          error: String(error),
        },
        'tools/detect_objects_in_image'
      );

      let errorMessage = 'An unknown error occurred';
      if (error instanceof VisionError) {
        errorMessage = `${error.name}: ${error.message}`;
        if (error.provider) {
          errorMessage += ` (Provider: ${error.provider})`;
        }
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                error: true,
                message: errorMessage,
                tool: 'detect_objects_in_image',
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }
  }
);

// Register segment_objects_in_image tool
server.registerTool<any, any>(
  'segment_objects_in_image',
  {
    title: 'Segment Objects in Image',
    description:
      'Segment objects in an image using Gemini conversational segmentation and generate an overlay image with per-object contour masks, bounding boxes, and labels. Supports relational queries like "the button that is disabled" or "people not wearing hard hats". Supports URLs, base64 data, and local file paths. File handling: explicit outputFilePath → exact path, otherwise → temp directory.',
    inputSchema: z.object({
      imageSource: z
        .string()
        .describe(
          'Image source - can be a URL, base64 data (data:image/...), or local file path'
        ),
      prompt: z
        .string()
        .describe(
          'What to segment, in natural language. Can be relational or conditional (e.g. "the search input", "all clickable elements in the navbar", "the person farthest from the camera"). Avoid output-format instructions; the workflow manages formatting.'
        ),
      outputFilePath: z
        .string()
        .optional()
        .describe(
          "Optional explicit output path for the mask overlay image. If provided, the image is saved to this exact path. Relative paths are resolved against the MCP server's current working directory."
        ),
    }),
  },
  async (args: any, _extra: any) => {
    const { imageSource, prompt, outputFilePath } = args;
    try {
      const validatedArgs = { imageSource, prompt, outputFilePath };

      // Initialize services on-demand
      const { config, imageProvider, imageFileService } = getServices();

      const result = await segment_objects_in_image(
        validatedArgs,
        config,
        imageProvider,
        imageFileService
      );

      const annotatedPath =
        'file' in result
          ? result.file.path
          : 'tempFile' in result
            ? result.tempFile.path
            : undefined;
      const inlineImage = annotatedPath
        ? await buildInlineImageBlock(annotatedPath)
        : null;

      const payload: Record<string, unknown> = {
        segments: result.segments,
        image_metadata: result.image_metadata,
        summary: result.summary,
        metadata: result.metadata,
      };
      if ('file' in result) payload.file = result.file;
      if ('tempFile' in result) payload.tempFile = result.tempFile;

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(payload, null, 2),
          },
          ...(inlineImage ? [inlineImage] : []),
        ],
      };
    } catch (error) {
      void logger.error(
        {
          msg: 'Error executing segment_objects_in_image tool',
          error: String(error),
        },
        'tools/segment_objects_in_image'
      );

      let errorMessage = 'An unknown error occurred';
      if (error instanceof VisionError) {
        errorMessage = `${error.name}: ${error.message}`;
        if (error.provider) {
          errorMessage += ` (Provider: ${error.provider})`;
        }
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                error: true,
                message: errorMessage,
                tool: 'segment_objects_in_image',
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }
  }
);

// Register analyze_audio tool
server.registerTool<any, any>(
  'analyze_audio',
  {
    title: 'Analyze Audio',
    description:
      'Analyze an audio file using Gemini native audio understanding: transcription (with timestamps on request), summarization, speaker identification, and non-speech sound description. Supports mp3, wav, aac, flac, ogg, aiff, m4a via URL, base64 data URI, or local file path. Audio costs ~32 tokens/second (~1 hour fits comfortably in context).',
    inputSchema: z.object({
      audioSource: z
        .string()
        .describe(
          'Audio source - URL, base64 data URI (data:audio/...), or local file path'
        ),
      prompt: z
        .string()
        .describe(
          'What to do with the audio, e.g. "Transcribe with speaker labels and MM:SS timestamps", "Summarize this meeting", "What sounds are audible?"'
        ),
      options: z
        .object({
          temperature: z.number().min(0).max(2).optional(),
          maxTokens: z
            .number()
            .int()
            .min(1)
            .max(65536)
            .optional()
            .describe(
              'Max output tokens. Full transcriptions of long audio need generous budgets (8000+).'
            ),
          thinkingLevel: z
            .enum(['minimal', 'low', 'medium', 'high'])
            .optional()
            .describe(
              'Reasoning depth (Gemini 3+ models only). "low" is enough for transcription; thinking tokens count toward maxTokens.'
            ),
        })
        .optional(),
    }),
  },
  async (args: any, _extra: any) => {
    const { audioSource, prompt, options } = args;
    try {
      const { config, videoProvider } = getServices();

      const result = await analyze_audio(
        { audioSource, prompt, options },
        config,
        videoProvider
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      void logger.error(
        { msg: 'Error executing analyze_audio tool', error: String(error) },
        'tools/analyze_audio'
      );

      let errorMessage = 'An unknown error occurred';
      if (error instanceof VisionError) {
        errorMessage = `${error.name}: ${error.message}`;
        if (error.provider) {
          errorMessage += ` (Provider: ${error.provider})`;
        }
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              { error: true, message: errorMessage, tool: 'analyze_audio' },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }
  }
);

// Register extract_video_frame tool
server.registerTool<any, any>(
  'extract_video_frame',
  {
    title: 'Extract Video Frame',
    description:
      'Extract still frames from a video (local file or direct video URL) at specific timestamps or at scene changes, using ffmpeg. Runs fully locally, no AI call. Key use: video analysis caps at 280 tokens/frame, but a still image can be analyzed at "ultra_high" (2240 tokens) - so for reading exact small text (URLs, code, UI labels, error messages) extract the frame, then call analyze_image on the frame path with mediaResolution "ultra_high" and optionally cropRegion. YouTube URLs are not supported (use analyze_video for those).',
    inputSchema: z.object({
      videoSource: z
        .string()
        .describe(
          'Local video file path or direct http(s) video file URL. YouTube URLs are NOT supported.'
        ),
      timestamps: z
        .array(z.string())
        .optional()
        .describe(
          'Timestamps to extract, e.g. ["00:12", "75", "1:02:03.500"]. Accepts seconds or MM:SS / H:MM:SS clock format.'
        ),
      sceneDetect: z
        .boolean()
        .optional()
        .describe(
          'Extract frames at scene changes instead of explicit timestamps. Useful to get one frame per distinct screen/view.'
        ),
      sceneThreshold: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe(
          'Scene-change sensitivity 0-1 (default 0.3). Lower values yield more frames.'
        ),
      maxFrames: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe('Cap on frames for scene detection (default 20).'),
      cropRegion: z
        .object({
          x: z.number().int().min(0).describe('Left edge in pixels'),
          y: z.number().int().min(0).describe('Top edge in pixels'),
          width: z.number().int().min(1).describe('Region width in pixels'),
          height: z.number().int().min(1).describe('Region height in pixels'),
        })
        .optional()
        .describe(
          'Optional pixel crop (top-left origin) applied to every extracted frame.'
        ),
      outputDir: z
        .string()
        .optional()
        .describe(
          'Directory to save frames into (default: a temp directory).'
        ),
    }),
  },
  async (args: any, _extra: any) => {
    try {
      const result = await extract_video_frame(args);

      // Inline preview of the first frame only, to avoid flooding context
      const inlineImage = result.frames[0]
        ? await buildInlineImageBlock(result.frames[0].path)
        : null;

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
          ...(inlineImage ? [inlineImage] : []),
        ],
      };
    } catch (error) {
      void logger.error(
        {
          msg: 'Error executing extract_video_frame tool',
          error: String(error),
        },
        'tools/extract_video_frame'
      );

      let errorMessage = 'An unknown error occurred';
      if (error instanceof VisionError) {
        errorMessage = `${error.name}: ${error.message}`;
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                error: true,
                message: errorMessage,
                tool: 'extract_video_frame',
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }
  }
);

// Register analyze_video tool
server.registerTool<any, any>(
  'analyze_video',
  {
    title: 'Analyze Video',
    description:
      'Analyze a video using AI vision models. Supports YouTube URLs, direct video URLs, and local file paths. The audio track is analyzed too (transcription, narration). For reading exact small on-screen text at a known moment, prefer extract_video_frame + analyze_image at "ultra_high" instead - video analysis caps at 280 tokens/frame.',
    inputSchema: z.object({
      videoSource: z
        .string()
        .describe('Video source - can be a URL or local file path'),
      prompt: z
        .string()
        .describe(
          'The prompt describing what you want to know about the video. When referring to specific moments, use MM:SS format (or MM:SS.sss when fps > 1); when asking for event localization, explicitly ask for timestamps in that format.'
        ),
      options: z
        .object({
          temperature: z
            .number()
            .min(0)
            .max(2)
            .optional()
            .describe(
              'Controls randomness in the response (0.0 = deterministic, 2.0 = very random)'
            ),
          topP: z
            .number()
            .min(0)
            .max(1)
            .optional()
            .describe('Nucleus sampling parameter (0.0-1.0)'),
          topK: z
            .number()
            .int()
            .min(1)
            .max(100)
            .optional()
            .describe('Top-k sampling parameter (1-100)'),
          maxTokens: z
            .number()
            .int()
            .min(1)
            .max(8192)
            .optional()
            .describe(
              'Maximum number of tokens to generate in the response. For video analysis, recommend 2000-4000 tokens for comprehensive temporal understanding.'
            ),
          videoMetadata: z
            .object({
              startOffset: z
                .union([z.string(), z.number()])
                .optional()
                .describe(
                  'Start time offset (e.g., "40s", "2m30s", "00:02:30", or seconds)'
                ),
              endOffset: z
                .union([z.string(), z.number()])
                .optional()
                .describe(
                  'End time offset (e.g., "80s", "3m", "00:03:00", or seconds)'
                ),
              fps: z
                .number()
                .min(0.1)
                .max(30)
                .optional()
                .describe(
                  'Frame rate for sampling (default: 1, range: 0.1-30). Use < 1 for long/static content (lectures, dashboards); 2-5 for fast UI changes or precise OCR of briefly-visible text.'
                ),
            })
            .optional()
            .describe(
              'Video clipping and frame rate settings. Always clip (startOffset/endOffset) to the relevant segment when known - it cuts tokens massively and improves focus.'
            ),
          mediaResolution: z
            .enum(['low', 'medium', 'high', 'ultra_high'])
            .optional()
            .describe(
              'Token resolution for video frames (Gemini 3+ models only). Default "low" (~66 tokens/frame) is enough for scene understanding; use "high" (~258 tokens/frame, zoomed reframing) to read small on-screen text such as URLs, code, or UI labels. "ultra_high" is image-only and falls back to "high" for video.'
            ),
          thinkingLevel: z
            .enum(['minimal', 'low', 'medium', 'high'])
            .optional()
            .describe(
              'Reasoning depth (Gemini 3+ models only). Use "high" for hard visual reasoning or precise OCR of on-screen text; "minimal"/"low" for fast scene summaries. Thinking tokens count toward maxTokens, so pair "high" with maxTokens >= 4000 or the answer gets truncated. Gemini 3.7+ does not support "minimal" (auto-upgraded to "low").'
            ),
          processing: z
            .enum(['agentic', 'static'])
            .optional()
            .describe(
              'Video processing mode (Gemini 3.6+/3.5-flash-lite). "agentic" (default) lets the model navigate the video on demand - transcript search plus targeted frame fetches - cutting tokens by up to ~97% on long videos with equal or better accuracy; ideal for long content and moment retrieval. "static" ingests frames at a fixed rate; required when using videoMetadata (clipping/fps) and preferred for exhaustive frame-precise inspection of short clips. videoMetadata automatically forces static.'
            ),
        })
        .optional(),
    }),
  },
  async (args: any, _extra: any) => {
    const { videoSource, prompt, options } = args;
    try {
      const validatedArgs = {
        videoSource,
        prompt,
        options,
      };

      // Initialize services on-demand
      const { config, videoProvider, videoFileService } = getServices();

      const result = await analyze_video(
        validatedArgs,
        config,
        videoProvider,
        videoFileService
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      void logger.error(
        { msg: 'Error executing analyze_video tool', error: String(error) },
        'tools/analyze_video'
      );

      let errorMessage = 'An unknown error occurred';
      if (error instanceof VisionError) {
        errorMessage = `${error.name}: ${error.message}`;
        if (error.provider) {
          errorMessage += ` (Provider: ${error.provider})`;
        }
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                error: true,
                message: errorMessage,
                tool: 'analyze_video',
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }
  }
);

// Register audit_design tool
server.registerTool<any, any>(
  'audit_design',
  {
    title: 'Audit Design',
    description:
      'Perform design compliance auditing with pixel-level analysis (K-means colors, Sobel edges, WCAG contrast) and the critique of Vision Language Model.',
    inputSchema: z.object({
      imageSource: z
        .string()
        .describe(
          'Image source - can be a URL, base64 data (data:image/...), or local file path'
        ),
      prompt: z
        .string()
        .optional()
        .describe(
          'Optional custom audit prompt to supplement the default design audit criteria'
        ),
      options: z
        .object({
          temperature: z
            .number()
            .min(0)
            .max(2)
            .optional()
            .describe(
              'Controls randomness in the response (0.0 = deterministic, 2.0 = very random)'
            ),
          topP: z
            .number()
            .min(0)
            .max(1)
            .optional()
            .describe('Nucleus sampling parameter (0.0-1.0)'),
          topK: z
            .number()
            .int()
            .min(1)
            .max(100)
            .optional()
            .describe('Top-k sampling parameter (1-100)'),
          maxTokens: z
            .number()
            .int()
            .min(1)
            .max(8192)
            .optional()
            .describe(
              'Maximum number of tokens to generate in the response. For design audits, 1000-1500 tokens typically sufficient.'
            ),
        })
        .optional(),
    }),
  },
  async (args: any, _extra: any) => {
    const { imageSource, prompt, options } = args;

    // Early validation - BEFORE calling getServices()
    if (
      !imageSource ||
      (typeof imageSource === 'string' && imageSource.trim() === '')
    ) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                error: true,
                message: 'imageSource is required',
                tool: 'audit_design',
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }

    try {
      const validatedArgs = { imageSource, prompt, options };

      // Initialize services on-demand (only after validation passes)
      const { config, imageProvider } = getServices();

      const result = await audit_design(
        validatedArgs,
        config,
        imageProvider
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      void logger.error(
        { msg: 'Error executing audit_design tool', error: String(error) },
        'tools/audit_design'
      );

      let errorMessage = 'An unknown error occurred';
      if (error instanceof VisionError) {
        errorMessage = `${error.name}: ${error.message}`;
        if (error.provider) {
          errorMessage += ` (Provider: ${error.provider})`;
        }
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                error: true,
                message: errorMessage,
                tool: 'audit_design',
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }
  }
);

// Graceful shutdown
process.on('SIGINT', async () => {
  // IMPORTANT (stdio MCP): never write logs to stdout; it corrupts JSON-RPC framing.
  console.error('Shutting down MCP server...');
  try {
    await server.close();
  } finally {
    process.exit(0);
  }
});

process.on('SIGTERM', async () => {
  // IMPORTANT (stdio MCP): never write logs to stdout; it corrupts JSON-RPC framing.
  console.error('Shutting down MCP server...');
  try {
    await server.close();
  } finally {
    process.exit(0);
  }
});

// Start server
export async function runMcpServer(): Promise<void> {
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    await logger.info('AI Vision MCP Server started successfully', 'server');
  } catch (error) {
    // Pre-connect failures may prevent MCP logging; always write to stderr.
    console.error('Failed to start MCP server:', error);
    process.exit(1);
  }
}

// Only run MCP server if this file is executed directly (not imported)
if (import.meta.url === `file://${process.argv[1]}`) {
  runMcpServer();
}
