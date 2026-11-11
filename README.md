# AI Vision MCP Server

A powerful Model Context Protocol (MCP) server that provides AI-powered image and video analysis using Google Gemini and Vertex AI models.

## Features

- **Dual Provider Support**: Choose between Google Gemini API and Vertex AI
- **Multimodal Analysis**: Images, videos (static or agentic, chosen by duration), audio, and documents (PDF, Word, PowerPoint, Excel, OpenDocument)
- **Calibrated Checks**: `evaluate_media` answers yes/no, pick-one and rubric questions about any media with probabilities instead of prose (Gemini Decisions API, typically under a second for images)
- **Dedicated Transcription**: gemini-3.5-transcribe with word timestamps, speaker diarization, 85+ languages
- **Image Editing & Generation**: Nano Banana 2.1 editing, annotation, composition, and video-to-image thumbnails
- **Current Models**: Gemini 3.5 Flash-Lite (default), 3.8 Flash, and Gemini 4 Argon/Carbon
- **Flexible File Handling**: One canonical streaming upload path (Files API) for any size up to 2GB
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

The server provides fourteen MCP tools:

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
- `options` (object, optional): Analysis options including temperature, max tokens, `mediaResolution` (low/medium/high/ultra_high, Gemini 3+ token resolution for the image), `thinkingLevel` (minimal/low/medium/high, Gemini 3+ reasoning depth), and `agenticVision` (boolean, Gemini 3+): the model runs sandboxed Python to zoom, crop, annotate, and measure the image itself before answering - an automatic alternative to `cropRegion` for tiny text, fine details, and precise counting (adds latency; enable globally with `AGENTIC_VISION=true`)

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

### 7) `edit_image`

Edits, annotates, or composes images using Gemini native image generation. The default model is Nano Banana 2.1 (`gemini-nano-banana-2.1`, GA October 2026), which replaces the now-deprecated `gemini-3.1-flash-image`. Set `EDIT_IMAGE_MODEL` to `gemini-3-pro-image` for studio-quality 4K and layouts, or `gemini-3.1-flash-lite-image` for the lowest latency. Accepts 1-14 input images and returns the edited image (file + inline preview).

**Video-to-image:** pass `videoSource` (YouTube URL, local video path, or `files/` reference) to generate thumbnails, movie posters, or summary infographics grounded in actual video content - e.g. "generate a clean 16:9 thumbnail with a catchy title". `imageSources` becomes optional. This needs an image model that accepts video: `gemini-nano-banana-2.1` does, `gemini-3-pro-image` does not ("Audio input modality is not enabled for this model"), so the server uses `gemini-nano-banana-2.1` for video requests when `EDIT_IMAGE_MODEL` cannot take video.

**Typical uses:**
- Write or draw on an image: "Add a red arrow pointing at the Save button and write 'CLICK HERE'"
- Before/after diffing: pass 2 images and ask "mark every visual difference between image 1 and image 2 with red boxes and labels"
- Composition: pass several images and ask for a combined result
- Spatial control: pass the original plus an annotated copy - boxes/arrows drawn on the reference act as placement instructions

**Parameters:**
- `imageSources` (array, 1-14): URLs, base64 data URIs, or local file paths (oversized inputs are auto-downscaled to fit the 7MB inline cap)
- `prompt` (string): the edit instruction; reference inputs as "image 1", "image 2"
- `outputFilePath` (string, optional): where to save (extra outputs get `-2`, `-3` suffixes)
- `aspectRatio` (optional): defaults to the input image's ratio
- `imageSize` (optional): `1K` (default), `2K`, `4K`. Use `2K` or `4K` when the image contains small text; at `1K` fine text is redrawn inexactly. `512` only exists on the deprecated `gemini-3.1-flash-image` and is raised to `1K` on other models.

**Note:** generative editing re-renders the whole image - unedited regions stay close but are not pixel-identical. For pixel-exact box overlays use `detect_objects_in_image` / `segment_objects_in_image` instead. When the model declines a request, the error includes its finish reason (for example `PROHIBITED_CONTENT`).

### 8) `analyze_audio`

Analyzes audio files using Gemini's native audio understanding: transcription (ask for MM:SS timestamps), summarization, speaker identification, and non-speech sound description. Audio costs ~32 tokens/second, so about an hour fits comfortably in context.

**Parameters:**
- `audioSource` (string): URL, base64 data URI (`data:audio/...`), or local file path (mp3, wav, aac, flac, ogg, aiff, m4a)
- `prompt` (string): e.g. "Transcribe with speaker labels and MM:SS timestamps"
- `options` (object, optional): `temperature`, `maxTokens` (use 8000+ for full transcriptions), `thinkingLevel`

All audio uploads go through the Gemini Files API (streamed from disk for local files) regardless of size. Vertex AI needs a `gs://` URI for large files.

### 9) `transcribe_audio`

Dedicated speech-to-text using `gemini-3.5-transcribe` (GA Aug 2026), purpose-built for transcription accuracy across 85+ auto-detected languages. Prefer this over `analyze_audio` for verbatim transcripts; use `analyze_audio` for questions and summaries about audio.

**Parameters:**
- `audioSource` (string): URL, base64 data URI, local file path, or `files/` reference
- `options` (object, optional):
  - `diarization` (boolean) - label speakers; segments are prefixed like `[spk:0]`
  - `wordTimestamps` (boolean) - word-level timing; segments get start-offset prefixes like `[3.1s]`
  - `mode` (`verbatim` default | `smart`) - smart mode removes filler words and adds formatting (incompatible with diarization/timestamps)
  - `languageCodes` (string[]) - BCP-47 hints, e.g. `["en-US", "ro-RO"]`
  - `customVocabulary` (string[]) - up to 1000 terms to bias recognition (names, jargon; incompatible with `wordTimestamps`)

Audio without speech returns an empty transcript rather than an error. Override the model with the `TRANSCRIBE_AUDIO_MODEL` env var.

### 10) `analyze_document`

Native document understanding: PDFs are processed visually (layouts, tables, charts, diagrams, handwriting, scanned pages - up to 1000 pages). Microsoft Office and OpenDocument files and text formats are supported as well. Each PDF page costs ~258 tokens at default resolution.

| Format | Extensions | What the model receives |
| --- | --- | --- |
| PDF | `.pdf` | Every page rendered visually |
| Word / OpenDocument text | `.docx`, `.dotx`, `.odt` | Text of the whole file (plus embedded images for `.docx`); page layout and charts are not rendered |
| PowerPoint | `.pptx` | Text of all slides plus embedded images; slides are not rendered |
| Legacy and OpenDocument presentations/docs | `.doc`, `.ppt`, `.odp` | Every page or slide rendered as an image |
| Spreadsheets | `.xlsx`, `.xls`, `.ods` | Flattened CSV cell values: no sheet names, formatting, or (for `.xlsx`/`.xls`) formulas |
| Text | `.txt`, `.md`, `.html`, `.csv`, `.xml`, `.rtf`, `.json`, `.yaml`, `.log`, `.sql` | The text itself |

Two things to know. When layout or charts matter in a Word or PowerPoint file, export it to PDF first. For spreadsheets, Google documents that only the first sheet is read; in testing a three-sheet workbook came through with its first two sheets concatenated and no boundary between them, so do not rely on later sheets and put the sheet you care about first. Spreadsheet results carry this caveat in `metadata.note`.

**Parameters:**
- `documentSource` (string): URL, base64 data URI, local file path, or `files/` reference
- `prompt` (string): e.g. "Extract all invoice line items as JSON", "What are the payment terms?"
- `options` (object, optional): `mediaResolution` (use `high` for dense tables and small print; `ultra_high` is rejected by the API for documents, so it is treated as `high`), `thinkingLevel`, `maxTokens`, `seed`

Documents upload via the same canonical streaming Files API path as video/audio (any size, 48h reuse via the returned `files/` reference). Override the model with `ANALYZE_DOCUMENT_MODEL` (defaults to the image model).

### 11) `evaluate_media`

Answers closed-ended questions about images, videos, audio, PDFs or plain text with **calibrated probabilities instead of prose**, using the Gemini Decisions API (`gemini-decision-1`, released November 2026). Every question is scored independently against the same input in one call, with zero output tokens.

Use it for anything you want to branch on or verify rather than read:

- Visual assertions on screenshots: "Is an error banner visible?", "Is the Submit button disabled?"
- Classifying UI state: which page, which theme, which step of a flow
- Checking a recording for an event, or triaging documents

**Question types:**

| Type | Asks | Returns |
| --- | --- | --- |
| `yes_no` | Does a statement hold? | `answer` (boolean), `probability` (P(yes), 0.01-0.99) |
| `choice` | Which one of a fixed list? | `answer` (option id), `probabilities` per option |
| `score` | Where on an ordered rubric? | `level` + `levelDescription` (most likely level), `score` (probability-weighted average), `probabilities` per level |

Every answer also has `confidence` and a `lowConfidence` flag (confidence below 0.7). Treat low-confidence answers as "unsure" and follow up with `analyze_image` / `analyze_video`.

**Parameters:**
- `mediaSources` (array, 0-16): local paths, HTTPS URLs, base64 data URIs, or `files/` references. Images, video, audio and PDF can be mixed in one call.
- `context` (string, optional): text shared by all questions, or the whole input when evaluating text only
- `questions` (array, 1-1000): each has `id`, `type`, `question`, plus `yesMeans`/`noMeans` (yes_no), `options` (choice), or `levels` (score)
- `options.mediaResolution` (optional): `low`, `medium`, `high`, `ultra_high` (images only; video is capped at `high`)

**Example:**
```json
{
  "mediaSources": ["/tmp/screenshot.png"],
  "questions": [
    { "id": "error_visible", "type": "yes_no", "question": "Does the screenshot show an error message or alert?" },
    { "id": "page", "type": "choice", "question": "What kind of page is this?",
      "options": { "dashboard": "Monitoring or metrics page", "form": "Data entry form", "other": "Anything else" } },
    { "id": "severity", "type": "score", "question": "How severe is the operational state shown?",
      "levels": ["Everything healthy", "Minor degradation", "One component failing", "Widespread outage"] }
  ],
  "options": { "mediaResolution": "high" }
}
```

Returns `answers` keyed by question id plus a one-line-per-question `summary`:

```
error_visible: YES (P(yes)=92%, confidence 92%)
page: dashboard (confidence 96%)
severity: level 2/3 "One component failing" (expected score 1.71, confidence 56%) [low confidence]
```

Measured in November 2026: three to five questions about a 1920x1080 screenshot take 0.7-1.0 seconds and about 1,400 input tokens; a 98-second video takes about 4.7 seconds (after upload) and 10,400 tokens; a 24-page PDF about 1.2 seconds and 20,500 tokens.

**Writing good questions:** ask one thing per question, phrase it positively, write the full question (the model never sees the `id`), give every option and level a short description, and include a catch-all option such as `other`.

**Limits:** Gemini Developer API only (not Vertex AI). No YouTube URLs, `gs://` URIs or Office documents - use `analyze_video` / `analyze_document` for those. Requires API version `v1beta`, which this server uses by default.

### 12) `start_video_analysis` + `get_analysis_result`

The async-job pattern for videos whose upload + processing exceeds MCP client tool timeouts (Cursor enforces ~60 seconds per tool call, and progress notifications do not reliably reset it in TypeScript-SDK-based clients).

- `start_video_analysis` takes the same arguments as `analyze_video` and returns a `jobId` immediately (measured: 0.0s even for a 377MB file) while the work runs in the background.
- `get_analysis_result` polls the job: `running` (with stage message + elapsed time), `done` (full analysis result), or `error`. Results are kept for 30 minutes.

Measured on a 377MB, 5-minute 240fps screen recording: job completes in ~160s (110s upload + 50s processing/analysis) while every individual tool call stays under one second.

All long-running tools also emit MCP `notifications/progress` heartbeats every 8 seconds (when the client sends a `progressToken`), which keeps calls alive on clients that reset their timeout on progress.

### 13) `analyze_video`

**Processing modes.** Gemini can read a video two ways, and the right one depends on length:

- **Static** ingests frames at a fixed rate in a single pass. Cost is predictable (about 100 tokens per second of video at default resolution, about 300 at `high`) and it is the fastest option for short clips, broad summaries and frame-precise inspection.
- **Agentic** (Gemini 4, 3.6+ Flash, 3.5 Flash-Lite) lets the model navigate the video on demand - searching the transcript and fetching only the frames it needs. On long videos Google reports up to 88% fewer tokens and about 7% better quality. Each navigation step is billed as tool-use and thinking tokens, so on short clips the cost depends heavily on the question.

The default is **`auto`**: static for videos under 5 minutes, agentic for longer ones or when the duration is unknown (YouTube URLs). Override per call with the `processing` option (`auto` / `agentic` / `static`), globally with `VIDEO_PROCESSING`, and move the threshold with `VIDEO_AGENTIC_MIN_DURATION` (seconds). `videoMetadata` (clipping/fps) always uses static, since the API does not allow combining them, as do models without agentic support. The mode actually used is returned in `metadata.videoProcessing`.

Measured in November 2026 on one 98-second clip with `gemini-3.8-flash` at `high` resolution:

| Question | Static | Agentic |
| --- | --- | --- |
| "Name three animals shown" | 28.5k tokens, 18s | 13.5k tokens, 19s |
| "When does a giraffe first appear?" | 28.8k tokens, 19s | 135.5k tokens, 59s |
| "Summarize, listing every animal in order" | 29.6k tokens, 25s | 59.9k tokens, 48s |

Static stayed flat; agentic ranged from half the cost to almost five times the cost and close to the 60-second tool timeout some MCP clients enforce. That is why `auto` keeps short clips on static. This is one clip, so treat the numbers as an illustration rather than a benchmark.

> Earlier versions of this README claimed agentic used "40 prompt tokens vs 13,573 static" on a short clip. That comparison counted only prompt tokens and missed the tool-use tokens agentic spends loading frames. `metadata.usage` now reports `thoughtsTokenCount` and `toolUsePromptTokenCount` so the full cost is visible.

Analyzes a video using AI and returns a detailed description.

**Parameters:**
- `videoSource` (string): YouTube URL, GCS URI, or local file path to the video
- `prompt` (string): Question or instruction for the AI
- `options` (object, optional): Analysis options:
  - `temperature`, `topP`, `topK`, `maxTokens` - standard generation parameters
  - `videoMetadata` (object) - video clipping and sampling: `fps`, `startOffset`, `endOffset` (e.g. `{ "fps": 5, "startOffset": "10s", "endOffset": "40s" }`)
  - `mediaResolution` (low/medium/high) - token resolution per frame; use `high` (~258 tokens/frame, zoomed reframing) to read small on-screen text such as URLs, code, or UI labels (`ultra_high` is image-only and falls back to `high` for video)
  - `thinkingLevel` (minimal/low/medium/high) - reasoning depth; `minimal` exists only on `gemini-3.5-flash-lite` and `gemini-3.6-flash` and is raised to `low` on `gemini-3.8-flash` and Gemini 4
  - `processing` (auto/agentic/static) - see processing modes above

**Supported video sources:**
- YouTube URLs (e.g., `https://www.youtube.com/watch?v=...`)
- Local file paths (e.g., `C:\Users\username\Downloads\video.mp4`)
- Remote video URLs and `files/...` references from a previous upload

**File handling:** every local or remote video goes through one canonical path - the Gemini Files API resumable upload, streamed from disk in 8MB chunks. Constant memory for any size up to the API's 2GB cap, no inline/upload branching. The returned `files/...` reference stays valid for 48 hours, so repeat analyses of the same video skip the upload entirely.

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
export TEMPERATURE=0.7      # ignored by Gemini 3.6+ and Gemini 4
export MAX_TOKENS=16384     # the default; thinking tokens count against it

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
export ANALYZE_DOCUMENT_MODEL="gemini-4-carbon"   # dense PDFs, hardest reasoning
```

**Video processing, logging and API version:**
```bash
# auto (default): static under 5 minutes, agentic for longer videos
export VIDEO_PROCESSING=auto            # auto | agentic | static
export VIDEO_AGENTIC_MIN_DURATION=300   # seconds; auto switches to agentic from here

# Ask Google not to store requests in the project's logs (the default here)
export GEMINI_STORE_REQUESTS=false      # false | true | project

# v1beta is required for agentic video, transcription options and evaluate_media
export GEMINI_API_VERSION=v1beta
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

## Choosing a Model

Google's guidance as of November 2026, with what was measured here:

| Model | Role | Price per 1M tokens (in / out) | Notes |
| --- | --- | --- | --- |
| `gemini-3.5-flash-lite` | Default here. Fastest and cheapest | $0.30 / $2.50 | Supports `minimal` thinking |
| `gemini-3.8-flash` | Google's recommended general-purpose model | $0.75 / $3.75 through Dec 31, 2026, then $1.50 / $7.50 | Thinking `low` / `medium` (default) / `high` |
| `gemini-4-argon` | Efficient Gemini 4 reasoning | $2 / $10 through Nov 30, 2026, then $4 / $20 | Paid tier only |
| `gemini-4-carbon` | Strongest reasoning, most thinking per turn | Same as Argon | Paid tier only |

On one test - transcribing every character of a 1920x1080 dashboard screenshot with 11-18px text, 13 strings checked - `ultra_high` resolution mattered more than the model: every model scored 13/13 with it (`gemini-3.5-flash-lite` in 1.2 seconds), while at default resolution only the Gemini 4 models got all 13 and the Flash models missed the smallest footer text. So for reading screenshots, set `MEDIA_RESOLUTION_FOR_IMAGE=ultra_high` first, and reach for Gemini 4 when the task needs reasoning rather than reading.

**Gemini 4 specifics handled by this server:**
- Thinking tokens count against the output limit, so a small `maxTokens` can be spent entirely on reasoning and return nothing. The server raises the limit to at least 32,768 on Gemini 4 models (Google's recommendation). Billing is by tokens actually generated, not by the limit.
- `minimal` thinking is not supported and is raised to `low`.
- Sampling parameters (`temperature`, `topP`, `topK`) are ignored by the API and are not sent.
- Hard prompts can think for minutes; the HTTP timeout defaults to 15 minutes (`GEMINI_TIMEOUT_MS`). For long work in clients with a short tool timeout, use `start_video_analysis`.

**Deprecations to be aware of:** `gemini-3.1-flash-image` is deprecated in favor of `gemini-nano-banana-2.1`; `gemini-3.7-flash` and `gemini-3.5-flash` now route to `gemini-3.8-flash` and `gemini-3.6-flash`; from December 1, 2026 `gemini-2.5-pro` and `gemini-2.5-flash` route to `gemini-3.8-flash` and `gemini-3.5-flash-lite`.

## Privacy: Request Logging

Since October 26, 2026 the Gemini API stores `generateContent` requests by default for newly created paid projects (older projects keep their previous setting). Screenshots and recordings can contain sensitive data, so this server sends `store: false` with every request unless you change `GEMINI_STORE_REQUESTS`:

- `false` (default): never store
- `true`: store, for example to debug in the AI Studio logs dashboard
- `project`: send nothing and follow the project-level setting in AI Studio

This applies to the Gemini Developer API provider. Uploaded files are still kept by the Files API for 48 hours, as before.

## Troubleshooting (stdio / Codex / Claude Code)

### 0) Tool call times out on large videos (Cursor ~60s limit)

Cursor (and other TypeScript-SDK-based clients) enforce a hard ~60 second timeout per MCP tool call that progress notifications do not reliably reset. Uploading + processing a large local video takes minutes, so `analyze_video` on big files dies at the client. Use the async pattern instead: `start_video_analysis` (returns a jobId instantly) then poll `get_analysis_result` every 15-30 seconds. The server also fixed its own Files API processing wait (was capped at 60s, now up to 10 minutes with backoff).

### 0b) Empty or cut-off answers

Current Gemini models think before answering, and thinking tokens count against the output limit. If the limit is too small the answer is truncated or missing. The server now reports this instead of returning an empty string: an error such as "used the whole output budget before writing an answer (497 tokens went to thinking)", or a `metadata.note` plus `finishReason: "MAX_TOKENS"` when the answer was cut off. Raise `maxTokens` / `MAX_TOKENS` (default 16384) or lower `thinkingLevel`.

### 0c) "Agentic video processing is not enabled for api version v1"

`@google/genai` 3.x defaults to API version `v1`, which lacks agentic video, transcription options and the Decisions API. This server pins `v1beta`; the error only appears if `GEMINI_API_VERSION` was set to `v1`.

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

- Node.js 22+ (required by `@google/genai` 3.x; Node 20 reached end-of-life in April 2026)
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
