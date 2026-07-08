import { extract_video_frame } from '../../tools/extract_video_frame.js';
import { formatOutput, handleError, parseArgs } from '../utils.js';

export async function runExtractFrame(args: string[]): Promise<void> {
  const { positional, options } = parseArgs(args);

  if (positional.length < 1) {
    console.error('Error: Video source required');
    console.error(
      'Usage: ai-vision extract-frame <source> --timestamps "00:12,01:30" [--scene-detect] [--crop <x,y,w,h>] [--output-dir <dir>]'
    );
    process.exit(1);
  }

  const videoSource = positional[0];
  const timestamps = options.timestamps
    ? options.timestamps.split(',').map(t => t.trim())
    : undefined;
  const sceneDetect = 'scene-detect' in options || 'sceneDetect' in options;
  const sceneThreshold = options['scene-threshold']
    ? parseFloat(options['scene-threshold'])
    : undefined;
  const maxFrames = options['max-frames']
    ? parseInt(options['max-frames'], 10)
    : undefined;
  const outputDir = options['output-dir'] || options.output;

  let cropRegion:
    | { x: number; y: number; width: number; height: number }
    | undefined;
  if (options.crop) {
    const parts = options.crop.split(',').map(p => parseInt(p.trim(), 10));
    if (parts.length !== 4 || parts.some(p => isNaN(p))) {
      console.error(
        'Error: --crop must be "x,y,width,height" in pixels (e.g. --crop "100,200,640,360")'
      );
      process.exit(1);
    }
    cropRegion = {
      x: parts[0],
      y: parts[1],
      width: parts[2],
      height: parts[3],
    };
  }

  try {
    const result = await extract_video_frame({
      videoSource,
      timestamps,
      sceneDetect,
      sceneThreshold,
      maxFrames,
      cropRegion,
      outputDir,
    });

    if ('json' in options) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(formatOutput(result as any, false));
    }
  } catch (error) {
    handleError(error, 'json' in options);
  }
}
