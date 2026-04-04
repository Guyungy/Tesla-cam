import dayjs from 'dayjs';

import { getVideoDuration } from './getVideoDuration';
import { parseTime } from './parseTime';
import type { CamFootage, CamName, CamSegment, SEIDataPoint } from './types';

/**
 * Generate footage data from a list of video files.
 * SEI metadata extraction is NOT done here — it's deferred to avoid blocking.
 * Use extractFootageSEI() separately after the footage is loaded.
 */
export async function genFootage(files: File[]): Promise<CamFootage> {
  // 文件地址，收集起来便于释放内存
  const urls: string[] = [];

  const map: Record<string, CamSegment> = {};

  for (const file of files) {
    const name = file.name.slice(0, 19);
    if (!map[name]) {
      // 创建
      map[name] = {
        name: name,
        duration: 0,
        startSeconds: 0,
      };
    }

    const restName = file.name.slice(20);
    // 识别摄像头位置 (including B-pillar cameras)
    let camName: CamName | undefined;
    if (restName.startsWith('front')) {
      camName = 'front';
    } else if (restName.startsWith('back')) {
      camName = 'back';
    } else if (restName.startsWith('left_repeater')) {
      camName = 'left';
    } else if (restName.startsWith('right_repeater')) {
      camName = 'right';
    } else if (restName.startsWith('left_pillar')) {
      camName = 'left_pillar';
    } else if (restName.startsWith('right_pillar')) {
      camName = 'right_pillar';
    }
    if (camName) {
      const fileURL = URL.createObjectURL(file);
      urls.push(fileURL);
      map[name][camName] = fileURL;
      const duration = await getVideoDuration(fileURL);
      if (!map[name].duration || duration > map[name].duration) {
        map[name].duration = duration;
      }
    }
  }

  const segments = Object.values(map);
  segments.sort(
    (a, b) =>
      dayjs(parseTime(a.name)).valueOf() - dayjs(parseTime(b.name)).valueOf(),
  );

  // 提前统计片段时长，方便进度跳转
  let duration = 0;
  segments.forEach((i) => {
    i.startSeconds = duration;
    duration += i.duration;
  });

  return {
    segments,
    duration,
    urls,
    // seiData is NOT populated here — call extractFootageSEI() asynchronously
  };
}

/**
 * Extract SEI metadata from front camera files asynchronously.
 * Call this AFTER genFootage returns and the UI is already rendering.
 * Returns the SEI data points array, or undefined if no metadata found.
 */
export async function extractFootageSEI(
  files: File[],
  footage: CamFootage,
): Promise<SEIDataPoint[] | undefined> {
  // Lazy import to avoid loading the parser when not needed
  const { extractSEIFromFile, convertToDataPoints } = await import('./parseSEI');

  // Build a map of segment name -> front camera File
  const frontFiles: Record<string, File> = {};
  for (const file of files) {
    const name = file.name.slice(0, 19);
    const restName = file.name.slice(20);
    if (restName.startsWith('front')) {
      frontFiles[name] = file;
    }
  }

  const allDataPoints: SEIDataPoint[] = [];

  for (const seg of footage.segments) {
    const frontFile = frontFiles[seg.name];
    if (!frontFile) continue;

    try {
      const rawMessages = await extractSEIFromFile(frontFile);
      if (rawMessages.length > 0) {
        const frameDurationMs = (seg.duration * 1000) / rawMessages.length;
        const points = convertToDataPoints(rawMessages, seg.startSeconds, frameDurationMs);
        allDataPoints.push(...points);
      }
    } catch (e) {
      console.warn(`SEI extraction failed for segment ${seg.name}:`, e);
      // Continue with other segments
    }
  }

  return allDataPoints.length > 0 ? allDataPoints : undefined;
}

export function revokeFootage(footage?: CamFootage) {
  footage?.urls.forEach((i) => {
    URL.revokeObjectURL(i);
  });
}
