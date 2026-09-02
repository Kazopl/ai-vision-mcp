# AI Vision MCP Server

A powerful Model Context Protocol (MCP) server that provides AI-powered image and video analysis using Google Gemini and Vertex AI models.

## Features

- **Dual Provider Support**: Choose between Google Gemini API and Vertex AI
- **Multimodal Analysis**: Support for both image and video content analysis
- **Flexible File Handling**: Upload via multiple methods (URLs, local files, base64)
- **Storage Integration**: Built-in Google Cloud Storage support
- **Comprehensive Validation**: Zod-based data validation throughout
- **Error Handling**: Robust error handling with retry logic and circuit breakers
- **TypeScript**: Full TypeScript support with strict type checking


## Quick Start

### Pre-requisites

You could choose either to use [`google` provider](https://aistudio.google.com/welcome) or [`vertex_ai` provider](https://cloud.google.com/vertex-ai/generative-ai/docs/start/quickstart). For simplicity, `google` provider is recommended.

Below are the environment variables you need to set based on your selected provider. (Note: It’s recommended to set the timeout configuration to more than 5 minutes for your MCP client).

(i) **Using Google AI Studio Provider**

```bash
export IMAGE_PROVIDER="google" # or vertex_ai
export VIDEO_PROVIDER="google" # or vertex_ai
export GEMINI_API_KEY="your-gemini-api-key"
```

Get your Google AI Studio's api key [here](https://aistudio.google.com/app/api-keys)

(ii) **Using Vertex AI Provider**

```bash
export IMAGE_PROVIDER="vertex_ai"
export VIDEO_PROVIDER="vertex_ai"
export VERTEX_CLIENT_EMAIL="your-service-account@project.iam.gserviceaccount.com"
export VERTEX_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
export VERTEX_PROJECT_ID="your-gcp-project-id"
export GCS_BUCKET_NAME="your-gcs-bucket"
```

Refer to [the guideline here](docs/provider/vertex-ai-setup-guide.md) on how to set this up.


### Installation

Below are the installation guide for this MCP on different MCP clients, such as Claude Desktop, Claude Code, Cursor, Cline, etc.

<details>
<summary>Claude Desktop</summary>

Add to your Claude Desktop configuration:

(i) Using Google AI Studio Provider
```json
{
  "mcpServers": {
    "ai-vision-mcp": {
      "command": "npx",
      "args": ["ai-vision-mcp"],
      "env": {
        "IMAGE_PROVIDER": "google",
        "VIDEO_PROVIDER": "google",
        "GEMINI_API_KEY": "your-gemini-api-key"
      }
    }
  }
}
```

(ii) Using Vertex AI Provider
```json
{
  "mcpServers": {
    "ai-vision-mcp": {
      "command": "npx",
      "args": ["ai-vision-mcp"],
      "env": {
        "IMAGE_PROVIDER": "vertex_ai",
        "VIDEO_PROVIDER": "vertex_ai",
        "VERTEX_CLIENT_EMAIL": "your-service-account@project.iam.gserviceaccount.com",
        "VERTEX_PRIVATE_KEY": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
        "VERTEX_PROJECT_ID": "your-gcp-project-id",
        "GCS_BUCKET_NAME": "ai-vision-mcp-{VERTEX_PROJECT_ID}"
      }
    }
  }
}
```

</details>

<details>
<summary>Claude Code</summary>

(i) Using Google AI Studio Provider
```bash
claude mcp add ai-vision-mcp \
  -e IMAGE_PROVIDER=google \
  -e VIDEO_PROVIDER=google \
  -e GEMINI_API_KEY=your-gemini-api-key \
  -- npx ai-vision-mcp
```

(ii) Using Vertex AI Provider
```bash
claude mcp add ai-vision-mcp \
  -e IMAGE_PROVIDER=vertex_ai \
  -e VIDEO_PROVIDER=vertex_ai \
  -e VERTEX_CLIENT_EMAIL=your-service-account@project.iam.gserviceaccount.com \
  -e VERTEX_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n" \
  -e VERTEX_PROJECT_ID=your-gcp-project-id \
  -e GCS_BUCKET_NAME=ai-vision-mcp-{VERTEX_PROJECT_ID} \
  -- npx ai-vision-mcp
```


Note: Increase the MCP startup timeout to 1 minutes and MCP tool execution timeout to about 5 minutes by updating `~\.claude\settings.json` as follows:

```json
{
  "env": {
    "MCP_TIMEOUT": "60000",
    "MCP_TOOL_TIMEOUT": "300000"
  }
}
```

</details>

<details>
<summary>Cursor</summary>

Go to: Settings -> Cursor Settings -> MCP -> Add new global MCP server

Pasting the following configuration into your Cursor ~/.cursor/mcp.json file is the recommended approach. You may also install in a specific project by creating .cursor/mcp.json in your project folder. See [Cursor MCP docs](https://docs.cursor.com/context/model-context-protocol) for more info.

(i) Using Google AI Studio Provider
```json
{
  "mcpServers": {
    "ai-vision-mcp": {
      "command": "npx",
      "args": ["ai-vision-mcp"],
      "env": {
        "IMAGE_PROVIDER": "google",
        "VIDEO_PROVIDER": "google",
        "GEMINI_API_KEY": "your-gemini-api-key"
      }
    }
  }
}
```

(ii) Using Vertex AI Provider
```json
{
  "mcpServers": {
    "ai-vision-mcp": {
      "command": "npx",
      "args": ["ai-vision-mcp"],
      "env": {
        "IMAGE_PROVIDER": "vertex_ai",
        "VIDEO_PROVIDER": "vertex_ai",
        "VERTEX_CLIENT_EMAIL": "your-service-account@project.iam.gserviceaccount.com",
        "VERTEX_PRIVATE_KEY": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
        "VERTEX_PROJECT_ID": "your-gcp-project-id",
        "GCS_BUCKET_NAME": "ai-vision-mcp-{VERTEX_PROJECT_ID}"
      }
    }
  }
}
```
</details>


<details>
<summary>Cline</summary>

Cline uses a JSON configuration file to manage MCP servers. To integrate the provided MCP server configuration:

1. Open Cline and click on the MCP Servers icon in the top navigation bar.
2. Select the Installed tab, then click Advanced MCP Settings.
3. In the cline_mcp_settings.json file, add the following configuration:

(i) Using Google AI Studio Provider
```json
{
  "mcpServers": {
    "timeout": 300,
    "type": "stdio",
    "ai-vision-mcp": {
      "command": "npx",
      "args": ["ai-vision-mcp"],
      "env": {
        "IMAGE_PROVIDER": "google",
        "VIDEO_PROVIDER": "google",
        "GEMINI_API_KEY": "your-gemini-api-key"
      }
    }
  }
}
```

(ii) Using Vertex AI Provider
```json
{
  "mcpServers": {
    "ai-vision-mcp": {
      "timeout": 300,
      "type": "stdio",
      "command": "npx",
      "args": ["ai-vision-mcp"],
      "env": {
        "IMAGE_PROVIDER": "vertex_ai",
        "VIDEO_PROVIDER": "vertex_ai",
        "VERTEX_CLIENT_EMAIL": "your-service-account@project.iam.gserviceaccount.com",
        "VERTEX_PRIVATE_KEY": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
        "VERTEX_PROJECT_ID": "your-gcp-project-id",
        "GCS_BUCKET_NAME": "ai-vision-mcp-{VERTEX_PROJECT_ID}"
      }
    }
  }
}
```
</details>


<details>

<summary>Other MCP clients</summary>

The server uses stdio transport and follows the standard MCP protocol. It can be integrated with any MCP-compatible client by running:

```bash
npx ai-vision-mcp
```
</details>


## MCP Tools

The server provides seven MCP tools:

### 1) `analyze_image`

Analyzes an image using AI and returns a detailed description.

**Parameters:**
- `imageSource` (string): URL, base64 data, or file path to the image
- `prompt` (string): Question or instruction for the AI
- `mode` (string, optional): Analysis mode - one of:
  - `general` (default) - General image analysis
  - `palette` - Extract design tokens (colors, spacing, typography)
  - `hierarchy` - Analyze visual hierarchy and eye flow
  - `components` - Catalog UI components and design system maturity
- `cropRegion` (object, optional): `{x, y, width, height}` in pixels (top-left origin). Crops the image before analysis - zooming into the region of interest greatly improves small-text OCR and reduces tokens
- `options` (object, optional): Analysis options including temperature, max tokens, `mediaResolution` (low/medium/high/ultra_high, Gemini 3+ token resolution for the image) and `thinkingLevel` (minimal/low/medium/high, Gemini 3+ reasoning depth)

**Examples:**

1. **General image analysis:**
```json
{
  "imageSource": "https://plus.unsplash.com/premium_photo-1710965560034-778eedc929ff",
  "prompt": "What is this image about? Describe what you see in detail."
}
```

2. **Extract design tokens:**
```json
{
  "imageSource": "https://example.com/design.png",
  "prompt": "Extract all design tokens from this screenshot",
  "mode": "palette"
}
```

3. **Analyze visual hierarchy:**
```json
{
  "imageSource": "C:\\Users\\username\\Downloads\\ui_mockup.png",
  "prompt": "Analyze the visual hierarchy and eye flow",
  "mode": "hierarchy"
}
```

4. **Component inventory:**
```json
{
  "imageSource": "https://example.com/design-system.png",
  "prompt": "List all UI components and evaluate design system maturity",
  "mode": "components"
}
```


### 2) `compare_images`

Compares multiple images using AI and returns a detailed comparison analysis.

**Parameters:**
- `imageSources` (array): Array of image sources (URLs, base64 data, or file paths) - minimum 2, maximum 4 images
- `prompt` (string): Question or instruction for comparing the images
- `options` (object, optional): Analysis options including temperature and max tokens

**Examples:**

1. **Compare images from URLs:**
```json
{
  "imageSources": [
    "https://example.com/image1.jpg",
    "https://example.com/image2.jpg"
  ],
  "prompt": "Compare these two images and tell me the differences"
}
```

2. **Compare mixed sources:**
```json
{
  "imageSources": [
    "https://example.com/image1.jpg",
    "C:\\\\Users\\\\username\\\\Downloads\\\\image2.jpg",
    "data:image/jpeg;base64,/9j/4AAQSkZJRgAB..."
  ],
  "prompt": "Which image has the best lighting quality?"
}
```

### 3) `detect_objects_in_image`

Detects objects in an image using AI vision models and generates annotated images with bounding boxes. Returns detected objects with coordinates and either saves the annotated image to a file or temporary directory.

**Parameters:**
- `imageSource` (string): URL, base64 data, or file path to the image
- `prompt` (string): Custom detection prompt describing what to detect or recognize in the image
- `outputFilePath` (string, optional): Explicit output path for the annotated image

**Configuration:**
This function uses optimized default parameters for object detection and does not accept runtime `options` parameter. To customize the AI parameters (temperature, topP, topK, maxTokens), use environment variables:

```
# Recommended environment variable settings for object detection (these are now the defaults)
TEMPERATURE_FOR_DETECT_OBJECTS_IN_IMAGE=0.0     # Deterministic responses
TOP_P_FOR_DETECT_OBJECTS_IN_IMAGE=0.95          # Nucleus sampling
TOP_K_FOR_DETECT_OBJECTS_IN_IMAGE=30            # Vocabulary selection
MAX_TOKENS_FOR_DETECT_OBJECTS_IN_IMAGE=8192     # High token limit for JSON
```

**File Handling Logic:**
1. **Explicit outputFilePath provided** → Saves to the exact path specified
2. **If not explicit outputFilePath** → Automatically saves to temporary directory

**Response Types:**
- Returns `file` object when explicit outputFilePath is provided
- Returns `tempFile` object when explicit outputFilePath is not provided so the image file output is auto-saved to temporary folder
- Always includes `detections` array with detected objects and coordinates
- Includes `summary` with percentage-based coordinates for browser automation

**Examples:**

1. **Basic object detection:**
```json
{
  "imageSource": "https://example.com/image.jpg",
  "prompt": "Detect all objects in this image"
}
```

2. **Save annotated image to specific path:**
```json
{
  "imageSource": "C:\\Users\\username\\Downloads\\image.jpg",
  "outputFilePath": "C:\\Users\\username\\Documents\\annotated_image.png"
}
```

3. **Custom detection prompt:**
```json
{
  "imageSource": "data:image/jpeg;base64,/9j/4AAQSkZJRgAB...",
  "prompt": "Detect and label all electronic devices in this image"
}
```


### 4) `segment_objects_in_image`

Segments objects in an image using Gemini's conversational segmentation and renders per-object contour masks as a colored overlay image (masks + bounding boxes + labels). Returns the overlay inline (MCP image block) plus per-segment pixel boxes and mask coverage.

Supports relational and conditional queries, not just object classes: "the button that is disabled", "the person farthest from the camera", "employees not wearing hard hats".

**Parameters:**
- `imageSource` (string): URL, base64 data, or file path to the image
- `prompt` (string): What to segment, in natural language
- `outputFilePath` (string, optional): Explicit output path for the overlay image (otherwise saved to a temp file)

**Example:**
```json
{
  "imageSource": "https://example.com/ui.png",
  "prompt": "the primary call-to-action button"
}
```

**Note:** Both `detect_objects_in_image` and `segment_objects_in_image` also return the annotated image inline as an MCP image content block (downscaled preview, full resolution stays on disk). Control the preview size with the `INLINE_IMAGE_MAX_DIM` env var (default 1200; set 0 to disable inline images).

### 5) `audit_design`

Audits UI/UX design compliance with pixel-level analysis and AI critique.

This tool provides automated design compliance auditing using pure TypeScript/JavaScript pixel analysis combined with Gemini Vision API critique. It extracts dominant colors, detects visual complexity, validates WCAG contrast ratios, and generates actionable design recommendations.

**Inspired by:** [Automating UX/UI Design Analysis with Python, Machine Learning, and LLMs](https://medium.com/@jadeygraham96/automating-ux-ui-design-analysis-with-python-machine-learning-and-llms-1fa1440b719b) by Jade Graham

**Parameters:**
- `imageSource` (string): URL, base64 data, or file path to the design image
- `prompt` (string, optional): Custom audit context or focus areas
- `options` (object, optional): Analysis options including temperature and max tokens

**Features:**
- **Dominant Colors**: K-means clustering to extract 5 primary colors
- **Edge Complexity**: Sobel operator for visual structure analysis
- **WCAG Contrast**: W3C relative luminance formula validation (AA/AAA)
- **Luminance Stats**: Mean brightness and standard deviation calculations
- **Design Issues**: Automated detection of contrast, complexity, and brightness problems
- **AI Critique**: Gemini-powered recommendations for design improvements

**Examples:**

1. **Basic design audit:**
```json
{
  "imageSource": "https://example.com/design.png",
  "prompt": "Audit this design for accessibility and visual hierarchy"
}
```

2. **Audit local design file:**
```json
{
  "imageSource": "C:\\Users\\username\\Downloads\\ui_design.png",
  "prompt": "Check WCAG AA compliance"
}
```

### 6) `extract_video_frame`

Extracts still frames from a video with ffmpeg, at explicit timestamps or at scene changes. Runs fully locally (no AI call). Requires `ffmpeg` on PATH (or set `FFMPEG_PATH`).

**Why it matters for precision:** the Gemini API caps video at 280 tokens/frame (`high`), but a still image can be analyzed at `ultra_high` (2240 tokens). For reading exact small text (URLs, tokens, code, error messages) the precise workflow is:

1. `extract_video_frame` at the relevant timestamp (optionally with `cropRegion`)
2. `analyze_image` on the frame path with `mediaResolution: "ultra_high"`, `thinkingLevel: "high"` and `maxTokens >= 4000`

Verified on a 1080p screencast with 10px text: video-level analysis at `high` returned a garbled fragment; the frame workflow transcribed the full string character-perfect.

**Parameters:**
- `videoSource` (string): Local video file path or direct http(s) video URL (YouTube not supported; use `analyze_video` for YouTube)
- `timestamps` (array, optional): e.g. `["00:12", "75", "1:02:03.500"]`
- `sceneDetect` (boolean, optional): extract one frame per scene change instead
- `sceneThreshold` (number, optional): 0-1 sensitivity, lower = more frames (default 0.3)
- `maxFrames` (number, optional): cap for scene detection (default 20)
- `cropRegion` (object, optional): `{x, y, width, height}` pixel crop applied to every frame
- `outputDir` (string, optional): where to save frames (default: temp dir)

**Examples:**
```json
{ "videoSource": "/path/to/screencast.mp4", "timestamps": ["00:12", "01:30"] }
```
```json
{ "videoSource": "/path/to/demo.mp4", "sceneDetect": true, "maxFrames": 10 }
```

### 7) `analyze_video`

**Agentic video understanding (default).** On supported models (Gemini 3.6+, 3.5-flash-lite) the model navigates the video on demand - searching the transcript and fetching only the frames it needs - instead of statically ingesting every frame. Measured on a 45s video: 40 prompt tokens agentic vs 13,573 static, with the same answer quality; Google reports up to 66% cost reduction and better accuracy on long videos. Control it with the `processing` option (`agentic`/`static`) or the `VIDEO_PROCESSING` env var. Using `videoMetadata` (clipping/fps) automatically switches the request to static, since the API does not allow combining them; unsupported models also fall back to static.

Analyzes a video using AI and returns a detailed description.

**Parameters:**
- `videoSource` (string): YouTube URL, GCS URI, or local file path to the video
- `prompt` (string): Question or instruction for the AI
- `options` (object, optional): Analysis options:
  - `temperature`, `topP`, `topK`, `maxTokens` - standard generation parameters
  - `videoMetadata` (object) - video clipping and sampling: `fps`, `startOffset`, `endOffset` (e.g. `{ "fps": 5, "startOffset": "10s", "endOffset": "40s" }`)
  - `mediaResolution` (low/medium/high) - Gemini 3+ token resolution per frame; use `high` (~258 tokens/frame, zoomed reframing) to read small on-screen text such as URLs, code, or UI labels (`ultra_high` is image-only and falls back to `high` for video)
  - `thinkingLevel` (minimal/low/medium/high) - Gemini 3+ reasoning depth; raise for precise OCR, lower for fast scene summaries

**Supported video sources:**
- YouTube URLs (e.g., `https://www.youtube.com/watch?v=...`)
- Local file paths (e.g., `C:\Users\username\Downloads\video.mp4`)

**Examples:**

1. **Analyze video from YouTube URL:**
```json
{
  "videoSource": "https://www.youtube.com/watch?v=9hE5-98ZeCg",
  "prompt": "What is this video about? Describe what you see in detail."
}
```

2. **Analyze local video file:**
```json
{
  "videoSource": "C:\\Users\\username\\Downloads\\video.mp4",
  "prompt": "What is this video about? Describe what you see in detail."
}
```

**Note:** Only YouTube URLs are supported for public video URLs. Other public video URLs are not currently supported.


## Environment Configuration

For basic setup, you only need to configure the provider selection and required credentials:

### Google AI Studio Provider (Recommended)
```bash
export IMAGE_PROVIDER="google"
export VIDEO_PROVIDER="google"
export GEMINI_API_KEY="your-gemini-api-key"
```

### Vertex AI Provider (Production)
```bash
export IMAGE_PROVIDER="vertex_ai"
export VIDEO_PROVIDER="vertex_ai"
export VERTEX_CLIENT_EMAIL="your-service-account@project.iam.gserviceaccount.com"
export VERTEX_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
export VERTEX_PROJECT_ID="your-gcp-project-id"
export GCS_BUCKET_NAME="your-gcs-bucket"
```

### 📖 **Detailed Configuration Guide**

For comprehensive environment variable documentation, including:
- Complete configuration reference (60+ environment variables)
- Function-specific optimization examples
- Advanced configuration patterns
- Troubleshooting guidance

👉 **[See Environment Variable Guide](docs/environment-variable-guide.md)**

### Configuration Priority Overview

The server uses a hierarchical configuration system where more specific settings override general ones:

1. **LLM-assigned values** (runtime parameters in tool calls)
2. **Function-specific variables** (`TEMPERATURE_FOR_ANALYZE_IMAGE`, etc.)
3. **Task-specific variables** (`TEMPERATURE_FOR_IMAGE`, etc.)
4. **Universal variables** (`TEMPERATURE`, etc.)
5. **System defaults**

<details>
<summary><strong>Quick Configuration Examples</strong></summary>

**Basic Optimization:**
```bash
# General settings
export TEMPERATURE=0.7
export MAX_TOKENS=1500

# Task-specific optimization
export TEMPERATURE_FOR_IMAGE=0.2     # More precise for images
export TEMPERATURE_FOR_VIDEO=0.5     # More creative for videos
```

**Function-specific Optimization:**
```bash
# Optimize individual functions
export TEMPERATURE_FOR_ANALYZE_IMAGE=0.1
export TEMPERATURE_FOR_COMPARE_IMAGES=0.3
export TEMPERATURE_FOR_DETECT_OBJECTS_IN_IMAGE=0.0  # Deterministic
export MAX_TOKENS_FOR_DETECT_OBJECTS_IN_IMAGE=8192   # High token limit
```

**Model Selection:**
```bash
# Choose models per function (default: gemini-3.5-flash-lite)
export ANALYZE_IMAGE_MODEL="gemini-3.5-flash-lite"
export COMPARE_IMAGES_MODEL="gemini-3.8-flash"
export ANALYZE_VIDEO_MODEL="gemini-3.8-flash"
```

**Gemini 3+ Media Resolution & Thinking Level:**
```bash
# Token resolution for input media (low | medium | high | ultra_high).
# "high" makes small on-screen text (URLs, code, UI labels) readable in
# videos; "ultra_high" spends the most tokens for maximum fidelity but is
# image-only (videos fall back to "high").
export MEDIA_RESOLUTION_FOR_IMAGE=ultra_high
export MEDIA_RESOLUTION_FOR_VIDEO=high

# Reasoning depth (minimal | low | medium | high).
# Raise for hard OCR/visual reasoning, lower for speed.
export THINKING_LEVEL_FOR_VIDEO=medium
```
</details>

## Troubleshooting (stdio / Codex / Claude Code)

### 1) "Transport closed" / tool call fails

If you see errors like:

- `tools/call failed: Transport closed`

Common causes:

**A) Image annotation dependency failed to load**

This server uses [`imagescript`](https://github.com/matmen/ImageScript) for image annotation/dimension extraction.

Verify it loads:

```bash
npm run doctor
# or
npm run check:imagescript
```

**B) stdout logs corrupt stdio MCP framing**

This server uses the MCP **stdio** transport (newline-delimited JSON-RPC over stdout).

- ✅ stdout must contain **only** MCP JSON-RPC messages
- ✅ write logs to **stderr** (e.g. `console.error`)
- ❌ do not use `console.log` in stdio MCP servers

If stdout is polluted, clients (Codex/Claude Code) may disconnect and report `Transport closed`.

## Development

### Prerequisites

- Node.js 20+
- npm or yarn

### Setup

```bash
# Clone the repository
git clone https://github.com/tan-yong-sheng/ai-vision-mcp.git
cd ai-vision-mcp

# Install dependencies
npm install

# Build the project
npm run build

# Start development server
npm run dev
```

### Scripts

- `npm run build` - Build the TypeScript project
- `npm run dev` - Start development server with watch mode
- `npm run lint` - Run ESLint
- `npm run format` - Format code with Prettier
- `npm start` - Start the built server

## Architecture

The project follows a modular architecture:

```
src/
├── providers/          # AI provider implementations
│   ├── gemini/        # Google Gemini provider
│   ├── vertexai/      # Vertex AI provider
│   └── factory/       # Provider factory
├── services/          # Core services
│   ├── ConfigService.ts
│   └── FileService.ts
├── storage/           # Storage implementations
├── file-upload/       # File upload strategies
├── types/            # TypeScript type definitions
├── utils/            # Utility functions
└── server.ts         # Main MCP server
```

## Error Handling

The server includes comprehensive error handling:

- **Validation Errors**: Input validation using Zod schemas
- **Network Errors**: Automatic retries with exponential backoff
- **Authentication Errors**: Clear error messages for API key issues
- **File Errors**: Handling for file size limits and format restrictions

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Google for the Gemini and Vertex AI APIs
- The Model Context Protocol team for the MCP framework
- Jade Graham for the [design analysis methodology](https://medium.com/@jadeygraham96/automating-ux-ui-design-analysis-with-python-machine-learning-and-llms-1fa1440b719b) that inspired the `audit_design` tool
- All contributors and users of this project
