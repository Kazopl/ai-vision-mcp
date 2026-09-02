#!/usr/bin/env node
import { ConfigService } from '../services/ConfigService.js';
import { runAnalyzeImage } from './commands/analyze-image.js';
import { runCompareImages } from './commands/compare-images.js';
import { runDetectObjects } from './commands/detect-objects.js';
import { runSegmentObjects } from './commands/segment-objects.js';
import { runAnalyzeVideo } from './commands/analyze-video.js';
import { runAnalyzeAudio } from './commands/analyze-audio.js';
import { runAuditDesign } from './commands/audit-design.js';
import { runExtractFrame } from './commands/extract-frame.js';

export async function runCli(args: string[]): Promise<void> {
  const command = args[0];
  const commandArgs = args.slice(1);

  // Initialize services (same as MCP mode)
  const configService = ConfigService.getInstance();
  const config = configService.getConfig();

  switch (command) {
    case 'analyze-image':
      await runAnalyzeImage(commandArgs, config);
      break;
    case 'compare-images':
      await runCompareImages(commandArgs, config);
      break;
    case 'detect-objects':
      await runDetectObjects(commandArgs, config);
      break;
    case 'segment-objects':
      await runSegmentObjects(commandArgs, config);
      break;
    case 'analyze-video':
      await runAnalyzeVideo(commandArgs, config);
      break;
    case 'analyze-audio':
      await runAnalyzeAudio(commandArgs, config);
      break;
    case 'audit-design':
      await runAuditDesign(commandArgs, config);
      break;
    case 'extract-frame':
      await runExtractFrame(commandArgs);
      break;
    case 'help':
    case '--help':
    case '-h':
      showHelp();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      showHelp();
      process.exit(1);
  }
}

function showHelp(): void {
  console.log(`
ai-vision CLI

Usage: ai-vision <command> [options]

Commands:
  analyze-image <source>       Analyze an image
  compare-images <sources...>  Compare multiple images (2-4)
  detect-objects <source>      Detect objects in an image
  segment-objects <source>     Segment objects (mask overlay image)
  analyze-video <source>       Analyze a video
  analyze-audio <source>       Analyze audio (transcribe, summarize, identify speakers)
  audit-design <source>        Audit design compliance (pixel metrics + Gemini critique)
  extract-frame <source>       Extract video frames via ffmpeg (local, no AI call)

Global Options:
  --prompt <text>              The analysis prompt (required for some commands)
  --json                       Output raw JSON
  --temperature <num>          Temperature 0-2 (default: 0.7)
  --top-p <num>                Top P 0-1
  --top-k <num>                Top K 1-100
  --max-tokens <num>           Max output tokens
  --media-resolution <level>   low | medium | high | ultra_high (Gemini 3+)
  --thinking-level <level>     minimal | low | medium | high (Gemini 3+)
  --crop <x,y,w,h>             Crop image before analysis (analyze-image only)
  --help                       Show this help

Examples:
  ai-vision analyze-image https://example.com/img.jpg --prompt "describe"
  ai-vision analyze-image shot.png --prompt "read the URL" --crop "0,0,800,80" --media-resolution ultra_high
  ai-vision compare-images img1.jpg img2.jpg --prompt "find differences" --json
  ai-vision detect-objects photo.jpg --prompt "find all cars" --output annotated.jpg
  ai-vision segment-objects ui.png --prompt "the primary call-to-action button" --output masks.png
  ai-vision audit-design design.png --prompt "check accessibility"
  ai-vision extract-frame demo.mp4 --timestamps "00:12,01:30" --crop "0,0,1280,120"
  ai-vision extract-frame demo.mp4 --scene-detect --max-frames 10
`);
}
