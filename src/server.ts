/**
 * Main MCP Server implementation
 */

import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { createRequire } from 'node:module';
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
  edit_image,
  analyze_document,
  transcribe_audio,
  evaluate_media,
} from './tools/index.js';
import { VisionError } from './types/Errors.js';
import { startJob, getJob } from './utils/jobStore.js';

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

/** Largest single JSON-RPC message accepted on stdin (see runMcpServer). */
const STDIO_MAX_BUFFER_BYTES = 256 * 1024 * 1024;

// Report the real package version (dist/server.js -> ../package.json)
const packageVersion: string = (() => {
  try {
    return createRequire(import.meta.url)('../package.json').version;
  } catch {
    return '0.0.0';
  }
})();

// Create MCP server
const server = new McpServer(
  {
    name: 'ai-vision-mcp',
    version: packageVersion,
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

/**
 * Keep long tool calls alive on clients that honor MCP progress
 * notifications: while fn runs, emit notifications/progress every 8s using
 * the client's progressToken (spec: clients MAY reset their timeout on
 * each one). Clients with hard timeouts that ignore progress (older
 * TypeScript SDK builds) should use start_video_analysis +
 * get_analysis_result instead.
 */
async function withProgressHeartbeat<T>(
  ctx: any,
  label: string,
  fn: () => Promise<T>
): Promise<T> {
  // MCP SDK v2 handler context: request metadata and notifications live
  // under ctx.mcpReq (v1 exposed them flat as extra._meta / sendNotification).
  const progressToken = ctx?.mcpReq?._meta?.progressToken;
  const notify: ((notification: unknown) => Promise<void>) | undefined =
    typeof ctx?.mcpReq?.notify === 'function'
      ? (notification: unknown) => ctx.mcpReq.notify(notification)
      : undefined;
  // Fallback for clients that send no progress token: a request-scoped log
  // notification. Clients with an idle timeout that resets on any incoming
  // notification stay alive through it; others simply ignore it.
  const log: ((message: string) => Promise<void>) | undefined =
    typeof ctx?.mcpReq?.log === 'function'
      ? (message: string) => ctx.mcpReq.log('info', message, 'heartbeat')
      : undefined;

  const beat: ((tick: number, message: string) => Promise<void>) | undefined =
    progressToken !== undefined && notify
      ? (tick, message) =>
          notify({
            method: 'notifications/progress',
            params: { progressToken, progress: tick, message },
          })
      : log
        ? (_tick, message) => log(message)
        : undefined;
  if (!beat) {
    return fn();
  }

  const startedAt = Date.now();
  let tick = 0;
  const timer = setInterval(() => {
    tick++;
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    // Promise.resolve().then() so a synchronous throw is caught as well
    Promise.resolve()
      .then(() => beat(tick, `${label}... ${elapsed}s elapsed`))
      .catch(() => {
        // Never let heartbeat failures affect the tool call
      });
  }, 8000);

  try {
    return await fn();
  } finally {
    clearInterval(timer);
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
            .max(65536)
            .optional()
            .describe(
              'Output cap in tokens. Thinking tokens count against it, so a small value truncates or empties the answer; leave unset unless you need a hard limit (Gemini 4 models are raised to at least 32768).'
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
              'Reasoning depth (Gemini 3 and 4 models). Use "high" for hard visual reasoning; "low" for fast simple descriptions. Thinking tokens count toward maxTokens. "minimal" only exists on gemini-3.5-flash-lite and 3.6-flash; it is raised to "low" on gemini-3.8-flash and Gemini 4.'
            ),
          agenticVision: z
            .boolean()
            .optional()
            .describe(
              'Agentic Vision (Gemini 3+ models). The model runs sandboxed Python to zoom, crop, annotate, and measure the image itself before answering - best for tiny text, fine details, precise counting, or reading dense UI. Adds latency (multiple code rounds) and is unnecessary for simple descriptions. An alternative to manually specifying cropRegion.'
            ),
          seed: z
            .number()
            .int()
            .optional()
            .describe(
              'Fixed seed for best-effort reproducibility: repeated identical requests return (mostly) the same answer. Useful for comparing prompts or re-running extractions consistently.'
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

      const result = await withProgressHeartbeat(_extra, 'Analyzing image', () =>
        analyze_image(validatedArgs, config, imageProvider, imageFileService)
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
            .max(65536)
            .optional()
            .describe(
              'Output cap in tokens. Thinking tokens count against it, so a small value truncates or empties the answer; leave unset unless you need a hard limit (Gemini 4 models are raised to at least 32768).'
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

      const result = await withProgressHeartbeat(_extra, 'Comparing images', () =>
        compare_images(validatedArgs, config, imageProvider, imageFileService)
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

      const result = await withProgressHeartbeat(_extra, 'Detecting objects', () =>
        detect_objects_in_image(validatedArgs, config, imageProvider, imageFileService)
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

      const result = await withProgressHeartbeat(_extra, 'Segmenting objects', () =>
        segment_objects_in_image(validatedArgs, config, imageProvider, imageFileService)
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

// Register edit_image tool
server.registerTool<any, any>(
  'edit_image',
  {
    title: 'Edit Image',
    description:
      'Edit, annotate, or compose images with Gemini native image generation (Nano Banana 2.1 by default). Accepts 1-14 input images: pass one image to edit or write/draw on it ("add a red arrow pointing at the login button", "write APPROVED across the top"); pass two to highlight before/after differences ("mark every visual difference between image 1 and image 2 with red circles on image 2"); pass several to compose them. Also supports video-to-image via videoSource (YouTube URL or local video): generate thumbnails, movie posters, or summary infographics from video content. Annotated inputs work as spatial instructions (a box drawn on a reference copy tells the model where to act). Returns the edited image file plus an inline preview. Note: the model re-renders the whole image, so unedited areas are close but not pixel-identical.',
    inputSchema: z.object({
      imageSources: z
        .array(z.string())
        .max(14)
        .optional()
        .describe(
          'Input images (0-14) - URLs, base64 data URIs, or local file paths. Reference them in the prompt by order: "image 1", "image 2". Optional when videoSource is provided.'
        ),
      videoSource: z
        .string()
        .optional()
        .describe(
          'Video-to-image: a YouTube URL, local video file path, or files/ reference used as visual context (e.g. "generate a 16:9 thumbnail for this video"). Needs a video-capable image model: gemini-nano-banana-2.1 (the default) is used automatically when EDIT_IMAGE_MODEL cannot take video (gemini-3-pro-image).'
        ),
      prompt: z
        .string()
        .describe(
          'The edit instruction. Be specific about what to change and what to preserve, e.g. "Circle the diff in red and label it BUG; keep everything else unchanged."'
        ),
      outputFilePath: z
        .string()
        .optional()
        .describe(
          'Explicit output path for the edited image (extra outputs get -2, -3 suffixes). Defaults to a temp file.'
        ),
      aspectRatio: z
        .enum([
          '1:1',
          '2:3',
          '3:2',
          '3:4',
          '4:3',
          '4:5',
          '5:4',
          '9:16',
          '16:9',
          '21:9',
          '9:21',
          '1:4',
          '4:1',
          '1:8',
          '8:1',
        ])
        .optional()
        .describe(
          'Output aspect ratio. Defaults to matching the input image.'
        ),
      imageSize: z
        .enum(['512', '1K', '2K', '4K'])
        .optional()
        .describe(
          'Output resolution (default 1K). Use 2K or 4K when the image contains small text (at 1K fine text gets redrawn inexactly). "512" only exists on the deprecated gemini-3.1-flash-image and is raised to 1K on other models.'
        ),
    }),
  },
  async (args: any, _extra: any) => {
    const {
      imageSources,
      videoSource,
      prompt,
      outputFilePath,
      aspectRatio,
      imageSize,
    } = args;
    try {
      const { config, imageProvider } = getServices();

      const result = await withProgressHeartbeat(_extra, 'Editing image', () =>
        edit_image(
          {
            imageSources,
            videoSource,
            prompt,
            outputFilePath,
            aspectRatio,
            imageSize,
          },
          config,
          imageProvider
        )
      );

      const inlineImage = result.images[0]
        ? await buildInlineImageBlock(result.images[0].path)
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
        { msg: 'Error executing edit_image tool', error: String(error) },
        'tools/edit_image'
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
              { error: true, message: errorMessage, tool: 'edit_image' },
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
              'Reasoning depth (Gemini 3 and 4 models). "low" is enough for most audio questions; thinking tokens count toward maxTokens.'
            ),
        })
        .optional(),
    }),
  },
  async (args: any, _extra: any) => {
    const { audioSource, prompt, options } = args;
    try {
      const { config, videoProvider } = getServices();

      const result = await withProgressHeartbeat(_extra, 'Analyzing audio', () =>
        analyze_audio({ audioSource, prompt, options }, config, videoProvider)
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

// Register transcribe_audio tool (dedicated speech-to-text model)
server.registerTool<any, any>(
  'transcribe_audio',
  {
    title: 'Transcribe Audio (dedicated STT)',
    description:
      'High-accuracy speech-to-text using the dedicated gemini-3.5-transcribe model: word-level timestamps, speaker diarization (speaker labels), custom vocabulary biasing (up to 1000 terms), and 85+ auto-detected languages. Use this for verbatim transcripts; use analyze_audio for questions/summaries about audio. Sources: URL, base64 data URI, or local file path (mp3, wav, aac, flac, ogg, aiff, m4a).',
    inputSchema: z.object({
      audioSource: z
        .string()
        .describe(
          'Audio source - URL, base64 data URI (data:audio/...), local file path, or files/ reference'
        ),
      options: z
        .object({
          diarization: z
            .boolean()
            .optional()
            .describe(
              'Label speakers (spk_1, spk_2, ...). Incompatible with mode "smart".'
            ),
          wordTimestamps: z
            .boolean()
            .optional()
            .describe(
              'Include word-level timing; segments get a start-offset prefix. Incompatible with mode "smart".'
            ),
          mode: z
            .enum(['verbatim', 'smart'])
            .optional()
            .describe(
              '"verbatim" (default, exact words) or "smart" (removes filler words, adds paragraphs/formatting)'
            ),
          languageCodes: z
            .array(z.string())
            .optional()
            .describe(
              'BCP-47 language hints, e.g. ["en-US", "ro-RO"]. Auto-detected when omitted.'
            ),
          customVocabulary: z
            .array(z.string())
            .optional()
            .describe(
              'Terms to bias recognition toward: names, jargon, acronyms (up to 1000). Incompatible with wordTimestamps.'
            ),
        })
        .optional(),
    }),
  },
  async (args: any, _extra: any) => {
    const { audioSource, options } = args;
    try {
      const { config, videoProvider } = getServices();

      const result = await withProgressHeartbeat(
        _extra,
        'Transcribing audio',
        () => transcribe_audio({ audioSource, options }, config, videoProvider)
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
        { msg: 'Error executing transcribe_audio tool', error: String(error) },
        'tools/transcribe_audio'
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
              { error: true, message: errorMessage, tool: 'transcribe_audio' },
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

// Register analyze_document tool (PDF + text document understanding)
server.registerTool<any, any>(
  'analyze_document',
  {
    title: 'Analyze Document',
    description:
      'Analyze a document with Gemini native document understanding. PDFs are read visually (layouts, tables, charts, diagrams, handwriting, scanned pages - up to 1000 pages). Microsoft Office and OpenDocument files are supported too: Word (.docx, .doc, .dotx, .odt), PowerPoint (.pptx, .ppt, .odp) and spreadsheets (.xlsx, .xls, .ods), plus text formats (txt, md, html, csv, xml, rtf, json, yaml, log). Caveats: .docx/.pptx/.odt arrive as text plus embedded images (page layout and charts are not rendered - export to PDF when layout matters); .doc/.ppt/.odp are rendered page by page; spreadsheets arrive as flattened CSV values without sheet names or formulas, and only the first sheet is guaranteed to be read. Great for extracting structured data, summarizing reports, comparing contract clauses, or answering questions about specs. Sources: URL, base64 data URI, local file path, or files/ reference. Each PDF page costs ~258 tokens at default resolution.',
    inputSchema: z.object({
      documentSource: z
        .string()
        .describe(
          'Document source - URL, base64 data URI (data:application/pdf;base64,...), local file path, or files/ reference from a previous upload'
        ),
      prompt: z
        .string()
        .describe(
          'What to do with the document, e.g. "Extract all invoice line items as JSON", "Summarize section 3", "What are the payment terms?"'
        ),
      options: z
        .object({
          temperature: z.number().min(0).max(2).optional(),
          maxTokens: z.number().int().min(1).max(65536).optional(),
          mediaResolution: z
            .enum(['low', 'medium', 'high', 'ultra_high'])
            .optional()
            .describe(
              'Token resolution per rendered page (PDF, .doc, .ppt, .odp). Use "high" for dense tables and small print. "ultra_high" is not available for documents and is treated as "high".'
            ),
          thinkingLevel: z
            .enum(['minimal', 'low', 'medium', 'high'])
            .optional()
            .describe(
              'Reasoning depth (Gemini 3 and 4 models). Raise for complex cross-page analysis.'
            ),
          seed: z
            .number()
            .int()
            .optional()
            .describe('Best-effort reproducibility seed'),
        })
        .optional(),
    }),
  },
  async (args: any, _extra: any) => {
    const { documentSource, prompt, options } = args;
    try {
      const { config, imageProvider } = getServices();

      const result = await withProgressHeartbeat(
        _extra,
        'Analyzing document',
        () =>
          analyze_document({ documentSource, prompt, options }, config, imageProvider)
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
        { msg: 'Error executing analyze_document tool', error: String(error) },
        'tools/analyze_document'
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
              { error: true, message: errorMessage, tool: 'analyze_document' },
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

// Register evaluate_media tool (Decisions API: calibrated checks, no prose)
server.registerTool<any, any>(
  'evaluate_media',
  {
    title: 'Evaluate Media (calibrated checks)',
    description:
      'Answer closed-ended questions about images, videos, audio, PDFs or text with calibrated probabilities instead of prose (Gemini Decisions API). Three question types: "yes_no" (probability the statement holds), "choice" (pick one option from a fixed list), "score" (rate against ordered rubric levels). All questions are evaluated independently in ONE call against the same input, typically in under a second for images, with zero output tokens. Use it for anything you want to branch on or verify: visual assertions on screenshots ("is an error banner visible?", "is the submit button disabled?"), UI state classification, checking a recording for an event, triaging documents. Each answer includes a confidence value and a lowConfidence flag (below 0.7) - treat low-confidence answers as "unsure" and follow up with analyze_image/analyze_video. Use the analyze_* tools instead when you need descriptions, extracted text, or explanations. Not supported: YouTube URLs, gs:// URIs, Office documents.',
    inputSchema: z.object({
      mediaSources: z
        .array(z.string())
        .max(16)
        .optional()
        .describe(
          'Media to evaluate (0-16): images, videos, audio files or PDFs as local file paths, HTTPS URLs, base64 data URIs, or files/ references. All questions see all media. Optional when context is provided.'
        ),
      context: z
        .string()
        .optional()
        .describe(
          'Optional text shared by all questions: background the questions need, or the full input when evaluating text only (serialize structured data as JSON text).'
        ),
      questions: z
        .array(
          z.object({
            id: z
              .string()
              .describe(
                'Key for this answer in the result (1-64 chars: letters, digits, "_" or "-"). The model never sees it.'
              ),
            type: z
              .enum(['yes_no', 'choice', 'score'])
              .describe(
                '"yes_no" = probability that the answer is yes; "choice" = pick one of options; "score" = rate on ordered levels'
              ),
            question: z
              .string()
              .describe(
                'The complete question, phrased positively and about ONE thing, e.g. "Does the screenshot show an error message or alert?"'
              ),
            yesMeans: z
              .string()
              .optional()
              .describe(
                'yes_no only: what counts as yes, when the question alone is ambiguous'
              ),
            noMeans: z
              .string()
              .optional()
              .describe('yes_no only: what counts as no'),
            options: z
              .union([z.record(z.string(), z.string()), z.array(z.string())])
              .optional()
              .describe(
                'choice only (2-255 options): an object mapping each option id to a short description of when it applies, e.g. {"dashboard": "Monitoring or metrics page", "form": "Data entry form", "other": "Anything else"}, or an array of self-explanatory option ids. Include a catch-all such as "other".'
              ),
            levels: z
              .array(z.string())
              .optional()
              .describe(
                'score only (2-255 levels): level descriptions ordered from lowest to highest, e.g. ["Everything healthy", "Minor degradation", "One component failing", "Widespread outage"]. Keep adjacent levels clearly distinct.'
              ),
          })
        )
        .min(1)
        .max(1000)
        .describe('The questions to evaluate (1-1000).'),
      options: z
        .object({
          mediaResolution: z
            .enum(['low', 'medium', 'high', 'ultra_high'])
            .optional()
            .describe(
              'Token resolution for images and video frames. Use "high" or "ultra_high" (images only) when the questions depend on small text or fine detail.'
            ),
        })
        .optional(),
    }),
  },
  async (args: any, _extra: any) => {
    const { mediaSources, context, questions, options } = args;
    try {
      const { config, imageProvider, imageFileService, videoFileService } =
        getServices();

      const result = await withProgressHeartbeat(
        _extra,
        'Evaluating media',
        () =>
          evaluate_media(
            { mediaSources, context, questions, options },
            config,
            imageProvider,
            imageFileService,
            videoFileService
          )
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
        { msg: 'Error executing evaluate_media tool', error: String(error) },
        'tools/evaluate_media'
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
              { error: true, message: errorMessage, tool: 'evaluate_media' },
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

// Register start_video_analysis tool (async job pattern for big files)
server.registerTool<any, any>(
  'start_video_analysis',
  {
    title: 'Start Video Analysis (async)',
    description:
      'Start analyzing a video in the background and return a jobId IMMEDIATELY - the reliable path for large local files (over ~50MB) whose upload + processing exceeds MCP client tool timeouts. Same arguments and result as analyze_video. After starting, poll get_analysis_result with the jobId every 15-30 seconds until status is "done". Typical total time for a several-hundred-MB recording: 2-6 minutes.',
    inputSchema: z.object({
      videoSource: z
        .string()
        .describe('Video source - can be a URL or local file path'),
      prompt: z
        .string()
        .describe(
          'The prompt describing what you want to know about the video.'
        ),
      options: z
        .object({
          temperature: z.number().min(0).max(2).optional(),
          maxTokens: z.number().int().min(1).max(65536).optional(),
          videoMetadata: z
            .object({
              startOffset: z.union([z.string(), z.number()]).optional(),
              endOffset: z.union([z.string(), z.number()]).optional(),
              fps: z.number().min(0.1).max(30).optional(),
            })
            .optional()
            .describe('Clipping/fps settings (forces static processing)'),
          mediaResolution: z
            .enum(['low', 'medium', 'high', 'ultra_high'])
            .optional(),
          thinkingLevel: z
            .enum(['minimal', 'low', 'medium', 'high'])
            .optional(),
          processing: z.enum(['auto', 'agentic', 'static']).optional(),
          seed: z.number().int().optional(),
        })
        .optional(),
    }),
  },
  async (args: any, _extra: any) => {
    const { videoSource, prompt, options } = args;
    try {
      if (!videoSource || !prompt) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  error: true,
                  message: 'videoSource and prompt are required',
                  tool: 'start_video_analysis',
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }

      const { config, videoProvider, videoFileService } = getServices();

      const job = startJob('analyze_video', async update => {
        update('uploading video (large files go to the Files API)...');
        const processedSource =
          await videoFileService.handleVideoSource(videoSource);
        update(
          'upload complete; waiting for Google processing and analyzing...'
        );
        return await analyze_video(
          { videoSource: processedSource, prompt, options },
          config,
          videoProvider,
          videoFileService
        );
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                jobId: job.id,
                status: job.status,
                note: 'Analysis running in the background. Poll get_analysis_result with this jobId every 15-30 seconds until status is "done".',
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      void logger.error(
        {
          msg: 'Error executing start_video_analysis tool',
          error: String(error),
        },
        'tools/start_video_analysis'
      );
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                error: true,
                message: error instanceof Error ? error.message : String(error),
                tool: 'start_video_analysis',
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

// Register get_analysis_result tool (poll async jobs)
server.registerTool<any, any>(
  'get_analysis_result',
  {
    title: 'Get Analysis Result',
    description:
      'Fetch the status/result of a background job started with start_video_analysis. Returns status "running" (poll again in 15-30 seconds), "done" (with the full analysis result), or "error". Results are kept for 30 minutes.',
    inputSchema: z.object({
      jobId: z.string().describe('The jobId returned by start_video_analysis'),
    }),
  },
  async (args: any, _extra: any) => {
    const job = getJob(args.jobId);

    if (!job) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                error: true,
                message: `Unknown jobId: ${args.jobId} (results expire after 30 minutes)`,
                tool: 'get_analysis_result',
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }

    const elapsedSeconds = Math.round(
      ((job.finishedAt ?? Date.now()) - job.startedAt) / 1000
    );

    const payload: Record<string, unknown> = {
      jobId: job.id,
      tool: job.tool,
      status: job.status,
      elapsedSeconds,
      message: job.message,
    };
    if (job.status === 'done') payload.result = job.result;
    if (job.status === 'error') payload.error = job.error;
    if (job.status === 'running') {
      payload.note = 'Still running - poll again in 15-30 seconds.';
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(payload, null, 2),
        },
      ],
      ...(job.status === 'error' ? { isError: true } : {}),
    };
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
      'Analyze a video using AI vision models. Supports YouTube URLs, direct video URLs, and local file paths. The audio track is analyzed too (transcription, narration). For reading exact small on-screen text at a known moment, prefer extract_video_frame + analyze_image at "ultra_high" instead - video analysis caps at 280 tokens/frame. IMPORTANT: large local files (over ~50MB) upload to the Files API and can take several minutes total, which exceeds some MCP client tool timeouts (Cursor ~60s) - for those, use start_video_analysis + get_analysis_result instead of this tool.',
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
            .max(65536)
            .optional()
            .describe(
              'Output cap in tokens. Thinking tokens count against it, so a small value truncates or empties the answer; leave unset unless you need a hard limit (Gemini 4 models are raised to at least 32768).'
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
              'Reasoning depth (Gemini 3 and 4 models). Use "high" for hard visual reasoning; "low" for fast scene summaries. Thinking tokens count toward maxTokens. "minimal" only exists on gemini-3.5-flash-lite and 3.6-flash; it is raised to "low" on gemini-3.8-flash and Gemini 4.'
            ),
          processing: z
            .enum(['auto', 'agentic', 'static'])
            .optional()
            .describe(
              'Video processing mode. "auto" (default) picks by duration: static for clips under 5 minutes, agentic for longer videos or when the duration is unknown (YouTube). "static" ingests frames at a fixed rate in one pass - fastest and cheapest for short clips, broad summaries, and frame-precise inspection; required with videoMetadata (clipping/fps). "agentic" lets the model navigate the video on demand (transcript search plus targeted frame fetches) - up to 88% fewer tokens on long videos and best for finding specific moments. On short clips it is slower and its cost depends on the question (each navigation step is billed as tool-use and thinking tokens, so a full summary can cost several times more than static). The mode used is reported in metadata.videoProcessing.'
            ),
          seed: z
            .number()
            .int()
            .optional()
            .describe(
              'Fixed seed for best-effort reproducibility across identical requests.'
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

      const result = await withProgressHeartbeat(_extra, 'Analyzing video (large files upload to the Files API first)', () =>
        analyze_video(validatedArgs, config, videoProvider, videoFileService)
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
            .max(65536)
            .optional()
            .describe(
              'Output cap in tokens. Thinking tokens count against it, so a small value truncates or empties the answer; leave unset unless you need a hard limit (Gemini 4 models are raised to at least 32768).'
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
    // SDK v2 caps the stdio read buffer at 10MB by default and closes the
    // connection when one message exceeds it. Tool calls here can carry
    // base64 images or audio inline, so allow the same sizes as before
    // (v1 was unbounded): 256MB covers a 100MB+ payload after base64.
    const transport = new StdioServerTransport(process.stdin, process.stdout, {
      maxBufferSize: STDIO_MAX_BUFFER_BYTES,
    });
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
