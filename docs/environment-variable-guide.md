# Environment Variable Configuration Guide

This guide provides comprehensive documentation for all environment variables used by the AI Vision MCP Server.

## Table of Contents

- [Quick Setup](#quick-setup)
- [Configuration Priority](#configuration-priority)
- [Environment Variables Reference](#environment-variables-reference)
- [Configuration Examples](#configuration-examples)
- [Troubleshooting](#troubleshooting)

## Quick Setup

### Google AI Studio Provider (Recommended for simplicity)

```bash
export IMAGE_PROVIDER="google"
export VIDEO_PROVIDER="google"
export GEMINI_API_KEY="your-gemini-api-key"
```

### Vertex AI Provider (Recommended for production)

```bash
export IMAGE_PROVIDER="vertex_ai"
export VIDEO_PROVIDER="vertex_ai"
export VERTEX_CLIENT_EMAIL="your-service-account@project.iam.gserviceaccount.com"
export VERTEX_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
export VERTEX_PROJECT_ID="your-project-id"
export GCS_BUCKET_NAME="your-gcs-bucket"
```

Get your Google AI Studio API key [here](https://aistudio.google.com/app/api-keys).

For Vertex AI setup, see [Vertex AI Setup Guide](provider/vertex-ai-setup-guide.md).

## Configuration Priority

The AI Vision MCP Server uses a hierarchical configuration system where more specific settings override general ones.

> Note: `temperature`, `topP`, and `topK` are deprecated across Gemini 3.x and ignored by the backend from 3.6 onward, so this server only sends them to models older than 3.6. On newer models control determinism with `thinkingLevel` and structured outputs instead. `candidateCount` is never sent.

### AI Parameters Priority (Highest to Lowest)

1. **LLM-assigned values** - Parameters passed directly in tool calls (e.g., `{"temperature": 0.1}`)
2. **Function-specific variables** - `TEMPERATURE_FOR_ANALYZE_IMAGE`, `MAX_TOKENS_FOR_COMPARE_IMAGES`, etc.
3. **Task-specific variables** - `TEMPERATURE_FOR_IMAGE`, `MAX_TOKENS_FOR_VIDEO`, etc.
4. **Universal variables** - `TEMPERATURE`, `MAX_TOKENS`, etc.
5. **System defaults** - Built-in fallback values

### Model Selection Priority (Highest to Lowest)

1. **Function-specific models** - `ANALYZE_IMAGE_MODEL`, `COMPARE_IMAGES_MODEL`, `ANALYZE_VIDEO_MODEL`
2. **Task-specific models** - `IMAGE_MODEL`, `VIDEO_MODEL`
3. **System defaults** - Built-in fallback model (`gemini-3.5-flash-lite`)

## Environment Variables Reference

### Provider Selection

| Variable | Required | Description | Default |
|----------|-----------|-------------|---------|
| `IMAGE_PROVIDER` | Yes | Provider for image analysis | `google` or `vertex_ai` |
| `VIDEO_PROVIDER` | Yes | Provider for video analysis | `google` or `vertex_ai` |

### Model Selection

| Variable | Required | Description | Default |
|----------|-----------|-------------|---------|
| `IMAGE_MODEL` | No | Model for image analysis | `gemini-3.5-flash-lite` |
| `VIDEO_MODEL` | No | Model for video analysis | `gemini-3.5-flash-lite` |

Current choices (November 2026): `gemini-3.5-flash-lite` (fastest, cheapest), `gemini-3.8-flash` (Google's recommended general-purpose model), `gemini-4-argon` and `gemini-4-carbon` (flagship reasoning, paid tier only). See "Choosing a Model" in the README for prices and measurements.

### Function-specific Model Selection

| Variable | Required | Description | Default |
|----------|-----------|-------------|---------|
| `ANALYZE_IMAGE_MODEL` | No | Model for analyze_image function | Uses `IMAGE_MODEL` |
| `COMPARE_IMAGES_MODEL` | No | Model for compare_images function | Uses `IMAGE_MODEL` |
| `DETECT_OBJECTS_IN_IMAGE_MODEL` | No | Model for detect_objects_in_image function | Uses `IMAGE_MODEL` |
| `SEGMENT_OBJECTS_IN_IMAGE_MODEL` | No | Model for segment_objects_in_image function | Uses `IMAGE_MODEL` |
| `ANALYZE_VIDEO_MODEL` | No | Model for analyze_video function | Uses `VIDEO_MODEL` |
| `ANALYZE_AUDIO_MODEL` | No | Model for analyze_audio function | Uses `VIDEO_MODEL` |
| `ANALYZE_DOCUMENT_MODEL` | No | Model for analyze_document (PDF/text understanding) | Uses `IMAGE_MODEL` |
| `TRANSCRIBE_AUDIO_MODEL` | No | Dedicated speech-to-text model for transcribe_audio (word timestamps, diarization, 85+ languages) | `gemini-3.5-transcribe` |
| `EDIT_IMAGE_MODEL` | No | Model for edit_image (must be a Nano Banana image model; does not fall back to `IMAGE_MODEL`). Options: `gemini-nano-banana-2.1` (default, GA Oct 2026, accepts video input), `gemini-3-pro-image` (Nano Banana Pro: studio 4K and layouts; cannot take video input, so video-to-image requests use the default), `gemini-3.1-flash-lite-image` (lowest latency). `gemini-3.1-flash-image` is deprecated | `gemini-nano-banana-2.1` |
| `DECISION_MODEL` | No | Model for evaluate_media (Decisions API) | `gemini-decision-1` |

### Media Resolution & Thinking Level (Gemini 3+)

| Variable | Required | Description | Default |
|----------|-----------|-------------|---------|
| `MEDIA_RESOLUTION` | No | Token resolution for input media: `low`, `medium`, `high`, `ultra_high` (`ultra_high` is image-only; videos fall back to `high`) | Model default |
| `MEDIA_RESOLUTION_FOR_IMAGE` | No | Overrides `MEDIA_RESOLUTION` for images | - |
| `MEDIA_RESOLUTION_FOR_VIDEO` | No | Overrides `MEDIA_RESOLUTION` for videos (`high` ~258 tokens/frame with zoomed reframing makes small on-screen text readable) | - |
| `THINKING_LEVEL` | No | Reasoning depth: `minimal`, `low`, `medium`, `high`. `minimal` exists only on `gemini-3.5-flash-lite` and `gemini-3.6-flash`; it is raised to `low` on `gemini-3.8-flash` and Gemini 4 | Model default (`minimal` for gemini-3.5-flash-lite, `medium` for gemini-3.8-flash and Gemini 4) |
| `THINKING_LEVEL_FOR_IMAGE` | No | Overrides `THINKING_LEVEL` for images | - |
| `THINKING_LEVEL_FOR_VIDEO` | No | Overrides `THINKING_LEVEL` for videos | - |
| `VIDEO_PROCESSING` | No | Video processing mode: `auto` (static for short videos, agentic for long ones or unknown duration), `static` (fixed-rate frame ingestion: predictable cost, fastest on short clips) or `agentic` (model navigates the video on demand: up to 88% fewer tokens on long videos; on short clips cost varies widely with the question). For screen recordings where exact small on-screen text matters, `agentic` was more accurate in testing (see README). Agentic needs Gemini 4, 3.6+ Flash or 3.5 Flash-Lite; `videoMetadata` always uses static | `auto` |
| `VIDEO_AGENTIC_MIN_DURATION` | No | In `auto` mode, videos at least this many seconds long use agentic processing | `300` |
| `AGENTIC_VISION` | No | Default for Agentic Vision on image analysis: the model runs sandboxed Python to zoom/crop/annotate the image itself (Gemini 3+). Per-call `agenticVision` option overrides | `false` |
| `SAFETY_THRESHOLD` | No | Safety filter threshold for all harm categories: `off`, `block_none`, `block_only_high`, `block_medium_and_above`. `block_none` prevents spurious refusals on legitimate dev content (security errors, tokens, exploits) | API defaults |
| `SERVICE_TIER` | No | Inference tier: `priority` (lowest latency, +75-100% price, needs Tier 2/3 paid project; auto-downgrades otherwise) or `flex` (50% cheaper, minutes-level latency) | `standard` |
| `GEMINI_TIMEOUT_MS` | No | HTTP timeout for Gemini API requests (agentic loops and Gemini 4 thinking can run for minutes) | `900000` |
| `GEMINI_API_VERSION` | No | Gemini Developer API version. `@google/genai` 3.x defaults to `v1`, which rejects agentic video, transcription options and the Decisions API, so the server pins `v1beta` | `v1beta` |
| `GEMINI_STORE_REQUESTS` | No | Whether Google may store requests in the project's logs: `false` (send `store=false`), `true`, or `project` (send nothing; follow the AI Studio project setting). New paid projects store by default since Oct 26, 2026 | `false` |
| `INLINE_IMAGE_MAX_DIM` | No | Max dimension (px) of the inline annotated-image preview returned by detect/segment/extract tools; `0` disables inline images | `1200` |
| `FFMPEG_PATH` | No | Path to the ffmpeg binary (used only by `extract_video_frame`) | `ffmpeg` on PATH |

These apply only to Gemini 3+ models; older models reject the parameters, so they are only sent when explicitly configured. Media resolution and thinking level can also be set per call via the tool `options` (`mediaResolution`, `thinkingLevel`), which takes priority over env vars. Note: `ultra_high` is applied per media part (the request-level config rejects it); `segment_objects_in_image` defaults to `thinkingLevel: minimal` per Google's segmentation guidance.

### Google Gemini API Configuration

| Variable | Required | Description | Default |
|----------|-----------|-------------|---------|
| `GEMINI_API_KEY` | Yes if using `google` provider | Google Gemini API key | Required for Gemini |
| `GEMINI_BASE_URL` | No | Gemini API base URL | `https://generativelanguage.googleapis.com` |

### Vertex AI Configuration

| Variable | Required | Description | Default |
|----------|-----------|-------------|---------|
| `VERTEX_CLIENT_EMAIL` | Yes if using `vertex_ai` provider | Service account client email | Required for Vertex AI |
| `VERTEX_PRIVATE_KEY` | Yes if using `vertex_ai` provider | Service account private key | Required for Vertex AI |
| `VERTEX_PROJECT_ID` | Yes if using `vertex_ai` provider | Google Cloud project ID | Required for Vertex AI |
| `VERTEX_LOCATION` | No | Vertex AI region | `us-central1` |
| `VERTEX_ENDPOINT` | No | Vertex AI endpoint URL | `https://aiplatform.googleapis.com` |

#### Setting Up Vertex AI Credentials

Vertex AI requires a Google Cloud service account. Extract these fields from your service account JSON file:

```bash
# From your service-account.json file:
{
  "client_email": "your-service-account@project-id.iam.gserviceaccount.com",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "project_id": "your-project-id"
}

# Set as environment variables:
export VERTEX_CLIENT_EMAIL="your-service-account@project-id.iam.gserviceaccount.com"
export VERTEX_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
export VERTEX_PROJECT_ID="your-project-id"
```

**For GitHub Actions secrets:**
Add each value as a separate secret:
- `VERTEX_CLIENT_EMAIL`: The client_email value from your service account JSON
- `VERTEX_PRIVATE_KEY`: The full private_key value (including `\n` characters)
- `VERTEX_PROJECT_ID`: The project_id value

**For shell/environment files:**
When setting `VERTEX_PRIVATE_KEY`, ensure the newlines are preserved:
```bash
# If your private key has literal \n, keep them as-is
export VERTEX_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBg...\n-----END PRIVATE KEY-----\n"
```

### Google Cloud Storage (Required for Vertex AI)

| Variable | Required | Description | Default |
|----------|-----------|-------------|---------|
| `GCS_BUCKET_NAME` | Yes if using `vertex_ai` provider | GCS bucket name for Vertex AI uploads | Required for Vertex AI |

**Note:** GCS uses the same credentials as Vertex AI (`VERTEX_CLIENT_EMAIL`, `VERTEX_PRIVATE_KEY`, `VERTEX_PROJECT_ID`).

### Universal API Parameters

| Variable | Required | Description | Range | Default |
|----------|-----------|-------------|-------|---------|
| `TEMPERATURE` | No | AI response temperature | 0.0–2.0 | `0.8` |
| `TOP_P` | No | Top-p sampling parameter | 0.0–1.0 | `0.95` |
| `TOP_K` | No | Top-k sampling parameter | 1–100 | `30` |
| `MAX_TOKENS` | No | Output cap. Thinking tokens count against it, so small values truncate or empty the answer. Gemini 4 models are raised to at least 32768 | 1–65536 | `16384` |

`TEMPERATURE`, `TOP_P` and `TOP_K` are ignored by Gemini 3.6+ and Gemini 4 and are not sent to those models.

### Task-specific API Parameters

| Variable | Required | Description | Range | Default |
|----------|-----------|-------------|-------|---------|
| `TEMPERATURE_FOR_IMAGE` | No | Image-specific temperature | 0.0–2.0 | Uses `TEMPERATURE` |
| `TOP_P_FOR_IMAGE` | No | Image-specific top-p | 0.0–1.0 | Uses `TOP_P` |
| `TOP_K_FOR_IMAGE` | No | Image-specific top-k | 1–100 | Uses `TOP_K` |
| `MAX_TOKENS_FOR_IMAGE` | No | Maximum tokens for image analysis | 1–65536 | Uses `MAX_TOKENS` |
| `TEMPERATURE_FOR_VIDEO` | No | Video-specific temperature | 0.0–2.0 | Uses `TEMPERATURE` |
| `TOP_P_FOR_VIDEO` | No | Video-specific top-p | 0.0–1.0 | Uses `TOP_P` |
| `TOP_K_FOR_VIDEO` | No | Video-specific top-k | 1–100 | Uses `TOP_K` |
| `MAX_TOKENS_FOR_VIDEO` | No | Maximum tokens for video analysis | 1–65536 | Uses `MAX_TOKENS` |

### Function-specific API Parameters

| Variable | Required | Description | Range | Default |
|----------|-----------|-------------|-------|---------|
| `TEMPERATURE_FOR_ANALYZE_IMAGE` | No | Temperature for analyze_image | 0.0–2.0 | Uses `TEMPERATURE_FOR_IMAGE` |
| `TOP_P_FOR_ANALYZE_IMAGE` | No | Top-p for analyze_image | 0.0–1.0 | Uses `TOP_P_FOR_IMAGE` |
| `TOP_K_FOR_ANALYZE_IMAGE` | No | Top-k for analyze_image | 1–100 | Uses `TOP_K_FOR_IMAGE` |
| `MAX_TOKENS_FOR_ANALYZE_IMAGE` | No | Max tokens for analyze_image | 1–65536 | Uses `MAX_TOKENS_FOR_IMAGE` |
| `TEMPERATURE_FOR_COMPARE_IMAGES` | No | Temperature for compare_images | 0.0–2.0 | Uses `TEMPERATURE_FOR_IMAGE` |
| `TOP_P_FOR_COMPARE_IMAGES` | No | Top-p for compare_images | 0.0–1.0 | Uses `TOP_P_FOR_IMAGE` |
| `TOP_K_FOR_COMPARE_IMAGES` | No | Top-k for compare_images | 1–100 | Uses `TOP_K_FOR_IMAGE` |
| `MAX_TOKENS_FOR_COMPARE_IMAGES` | No | Max tokens for compare_images | 1–65536 | Uses `MAX_TOKENS_FOR_IMAGE` |
| `TEMPERATURE_FOR_DETECT_OBJECTS_IN_IMAGE` | No | Temperature for object detection | 0.0–2.0 | `0.0` |
| `TOP_P_FOR_DETECT_OBJECTS_IN_IMAGE` | No | Top-p for object detection | 0.0–1.0 | `0.95` |
| `TOP_K_FOR_DETECT_OBJECTS_IN_IMAGE` | No | Top-k for object detection | 1–100 | `30` |
| `MAX_TOKENS_FOR_DETECT_OBJECTS_IN_IMAGE` | No | Max tokens for object detection | 1–65536 | `8192` |
| `TEMPERATURE_FOR_ANALYZE_VIDEO` | No | Temperature for analyze_video | 0.0–2.0 | Uses `TEMPERATURE_FOR_VIDEO` |
| `TOP_P_FOR_ANALYZE_VIDEO` | No | Top-p for analyze_video | 0.0–1.0 | Uses `TOP_P_FOR_VIDEO` |
| `TOP_K_FOR_ANALYZE_VIDEO` | No | Top-k for analyze_video | 1–100 | Uses `TOP_K_FOR_VIDEO` |
| `MAX_TOKENS_FOR_ANALYZE_VIDEO` | No | Max tokens for analyze_video | 1–65536 | Uses `MAX_TOKENS_FOR_VIDEO` |
| `TEMPERATURE_FOR_AUDIT_DESIGN` | No | Temperature for audit_design | 0.0–2.0 | `0.0` (deterministic) |
| `TOP_P_FOR_AUDIT_DESIGN` | No | Top-p for audit_design | 0.0–1.0 | `0.95` |
| `TOP_K_FOR_AUDIT_DESIGN` | No | Top-k for audit_design | 1–100 | `30` |
| `MAX_TOKENS_FOR_AUDIT_DESIGN` | No | Max tokens for audit_design | 1–65536 | Uses `MAX_TOKENS_FOR_IMAGE` |

### File Processing Configuration

| Variable | Required | Description | Default |
|----------|-----------|-------------|---------|
| `MAX_IMAGE_SIZE` | No | Maximum image size in bytes | `20971520` (20 MB) |
| `MAX_VIDEO_SIZE` | No | Maximum video size in bytes | `2147483648` (2 GB) |
| `MAX_VIDEO_DURATION` | No | Maximum video duration (seconds) | `3600` (1 hour) |
| `MAX_IMAGES_FOR_COMPARISON` | No | Maximum images for comparison | `4` |
| `ALLOWED_IMAGE_FORMATS` | No | Comma-separated image formats | `png,jpg,jpeg,webp,gif,bmp,tiff` |
| `ALLOWED_VIDEO_FORMATS` | No | Comma-separated video formats | `mp4,mov,avi,mkv,webm,flv,wmv,3gp` |

### File Upload Configuration

| Variable | Required | Description | Default |
|----------|-----------|-------------|---------|
| `GEMINI_FILES_API_THRESHOLD` | No | Inline/Files API cutoff for **images only** (videos and audio always use the Files API) | `10485760` (10 MB) |
| `VERTEX_AI_FILES_API_THRESHOLD` | No | Size threshold for Vertex AI uploads | `0` |

### Development Configuration

| Variable | Required | Description | Default |
|----------|-----------|-------------|---------|
| `LOG_LEVEL` | No | Logging level | `info` |
| `NODE_ENV` | No | Environment mode | `development` |

## Configuration Examples

### Basic Development Setup

```bash
# Provider selection
export IMAGE_PROVIDER="google"
export VIDEO_PROVIDER="google"
export GEMINI_API_KEY="your-gemini-api-key"

# Basic configuration
export MAX_TOKENS=16384   # the default; thinking tokens count against it
export LOG_LEVEL="debug"
```

### Production Setup with Vertex AI

```bash
# Provider selection
export IMAGE_PROVIDER="vertex_ai"
export VIDEO_PROVIDER="vertex_ai"

# Vertex AI credentials
export VERTEX_CLIENT_EMAIL="your-service-account@project-id.iam.gserviceaccount.com"
export VERTEX_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
export VERTEX_PROJECT_ID="your-project-id"
export GCS_BUCKET_NAME="your-production-bucket"

# Production models
export IMAGE_MODEL="gemini-3.8-flash"
export VIDEO_MODEL="gemini-3.8-flash"

# Production parameters
export TEMPERATURE=0.3
export MAX_TOKENS=2000
export NODE_ENV="production"
export LOG_LEVEL="info"
```

### Function-specific Optimization

```bash
# General settings
export IMAGE_PROVIDER="google"
export GEMINI_API_KEY="your-gemini-api-key"

# Function-specific optimizations
export TEMPERATURE_FOR_ANALYZE_IMAGE=0.1      # Precise image analysis
export TEMPERATURE_FOR_COMPARE_IMAGES=0.5     # More creative comparisons
export TEMPERATURE_FOR_DETECT_OBJECTS_IN_IMAGE=0.0  # Deterministic detection
export TEMPERATURE_FOR_AUDIT_DESIGN=0.0       # Deterministic design auditing
export MAX_TOKENS_FOR_DETECT_OBJECTS_IN_IMAGE=8192   # High token limit for JSON
export MAX_TOKENS_FOR_AUDIT_DESIGN=1500       # Detailed design critique

# Function-specific models
export ANALYZE_IMAGE_MODEL="gemini-3.5-flash-lite"
export COMPARE_IMAGES_MODEL="gemini-3.8-flash"
export DETECT_OBJECTS_IN_IMAGE_MODEL="gemini-3.5-flash-lite"
```

### Mixed Provider Setup

```bash
# Use Gemini for images (simpler, faster)
export IMAGE_PROVIDER="google"
export GEMINI_API_KEY="your-gemini-api-key"

# Use Vertex AI for videos (enterprise features)
export VIDEO_PROVIDER="vertex_ai"
export VERTEX_CLIENT_EMAIL="your-service-account@project-id.iam.gserviceaccount.com"
export VERTEX_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
export VERTEX_PROJECT_ID="your-project-id"
export GCS_BUCKET_NAME="your-mixed-provider-bucket"

# Task-specific parameters
export TEMPERATURE_FOR_IMAGE=0.2
export TEMPERATURE_FOR_VIDEO=0.5
export MAX_TOKENS_FOR_IMAGE=8192
export MAX_TOKENS_FOR_VIDEO=16384
```

## File Upload Strategy Configuration

### Gemini Provider Strategy

**Videos and audio always use the Files API** - a single canonical upload
path for every file size. The SDK streams the file from disk over the
resumable upload protocol in 8MB chunks (constant memory), up to the API's
2GB per-file cap. Uploaded files are reusable for 48 hours (pass the
returned `files/...` reference to skip re-uploading).

The threshold below applies to **images only**:

```bash
export GEMINI_FILES_API_THRESHOLD=10485760  # 10MB

# Images ≤ 10MB: inline base64 data (lowest latency for screenshots)
# Images > 10MB: Gemini Files API
```

### Vertex AI Provider Strategy

```bash
export VERTEX_AI_FILES_API_THRESHOLD=0  # All files use GCS

# All files: Upload to Google Cloud Storage and use gs:// URIs
```

## Troubleshooting

### Common Issues

1. **Missing API Key Error**
   ```
   Error: Missing required configuration for google: GEMINI_API_KEY
   ```
   **Solution**: Set `GEMINI_API_KEY` environment variable when using `google` provider

2. **Vertex AI Authentication Error**
   ```
   Error: Missing required configuration for vertex_ai: VERTEX_CLIENT_EMAIL
   ```
   **Solution**: Set `VERTEX_CLIENT_EMAIL`, `VERTEX_PRIVATE_KEY`, `VERTEX_PROJECT_ID`, and `GCS_BUCKET_NAME` for Vertex AI

3. **File Size Limit Exceeded**
   ```
   Error: File size exceeds maximum limit
   ```
   **Solution**: Increase `MAX_IMAGE_SIZE` or `MAX_VIDEO_SIZE`, or reduce file size

4. **Unsupported File Format**
   ```
   Error: Unsupported file format
   ```
   **Solution**: Check `ALLOWED_IMAGE_FORMATS` and `ALLOWED_VIDEO_FORMATS` settings

5. **Empty or cut-off answer**
   ```
   Error: gemini-4-argon used the whole output budget before writing an answer (497 tokens went to thinking)
   ```
   or a result with `finishReason: "MAX_TOKENS"` and a `metadata.note`.
   **Solution**: Thinking tokens count against the output cap. Increase the relevant `MAX_TOKENS_*` variable (or the per-call `maxTokens`), or lower `THINKING_LEVEL`

6. **Agentic video rejected**
   ```
   Agentic video processing is not enabled for api version v1. Use api version v1beta instead.
   ```
   **Solution**: Remove `GEMINI_API_VERSION=v1` (the server defaults to `v1beta`)

7. **Document analysis fails with `INVALID_ARGUMENT`**
   The API rejects `ultra_high` media resolution on documents. The server now treats it as `high` for `analyze_document`, so this only appears on versions before 0.1.0

### Debug Mode

Enable debug logging to troubleshoot issues:

```bash
export LOG_LEVEL="debug"
```

This will provide detailed information about:
- Configuration loading
- Provider initialization
- File processing
- API requests and responses
- Error details

### Configuration Validation

The server validates configuration on startup. Common validation errors:

- Missing required provider-specific variables
- Invalid file paths in credentials
- Incompatible configuration combinations
- Out-of-range parameter values

Check the console output for detailed validation messages.

## Best Practices

1. **Use Environment-specific Files**: Create `.env.development` and `.env.production` files
2. **Secure Credentials**: Never commit API keys or credentials to version control
3. **Control cost with thinking level, not small token caps**: `MAX_TOKENS` is only a ceiling; a low value truncates answers on thinking models. Lower `THINKING_LEVEL` instead
4. **Check real usage**: `metadata.usage` includes `thoughtsTokenCount` and `toolUsePromptTokenCount`, which is where agentic video and high thinking levels spend tokens
5. **Test Configuration**: Validate configuration in development before production deployment

## Related Documentation

- [Installation Guide](../README.md#installation)
- [Vertex AI Setup Guide](provider/vertex-ai-setup-guide.md)
- [Technical Specification](SPEC.md)
- [Development Patterns](../CLAUDE.md)
