import dayjs from 'dayjs';

import { parseTime } from './parseTime';
import {
  probeDurationFromUrl,
  probeMp4DurationFromFile,
} from './probeMp4Duration';
import type { CamFootage, CamName, CamSegment, SEIDataPoint } from './types';

const CONCURRENCY = 6;

async function mapPool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  onProgress?: (done: number, total: number) => void,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let done = 0;
  const total = items.length;

  const runners = Array.from(
    { length: Math.min(limit, total || 1) },
    async () => {
      while (true) {
        const i = next++;
        if (i >= total) return;
        results[i] = await worker(items[i], i);
        done++;
        onProgress?.(done, total);
      }
    },
  );
  await Promise.all(runners);
  return results;
}

function resolveCamName(fileName: string): CamName | undefined {
  const restName = fileName.slice(20);
  if (restName.startsWith('front')) return 'front';
  if (restName.startsWith('back')) return 'back';
  if (restName.startsWith('left_repeater')) return 'left';
  if (restName.startsWith('right_repeater')) return 'right';
  if (restName.startsWith('left_pillar')) return 'left_pillar';
  if (restName.startsWith('right_pillar')) return 'right_pillar';
  return undefined;
}

/**
 * Generate footage data from a list of video files.
 * Uses MP4 box probing (parallel) instead of per-file <video> metadata loads.
 */
export async function genFootage(
  files: File[],
  onProgress?: (current: number, total: number) => void,
): Promise<CamFootage> {
  const urls: string[] = [];
  const map: Record<string, CamSegment> = {};

  // Create object URLs synchronously (cheap); probe durations in parallel.
  type Job = { file: File; camName: CamName; segName: string; fileURL: string };
  const jobs: Job[] = [];

  for (const file of files) {
    const camName = resolveCamName(file.name);
    if (!camName) continue;
    const segName = file.name.slice(0, 19);
    if (!map[segName]) {
      map[segName] = { name: segName, duration: 0, startSeconds: 0 };
    }
    const fileURL = URL.createObjectURL(file);
    urls.push(fileURL);
    map[segName][camName] = fileURL;
    jobs.push({ file, camName, segName, fileURL });
  }

  await mapPool(
    jobs,
    CONCURRENCY,
    async (job) => {
      let duration = await probeMp4DurationFromFile(job.file);
      if (!(duration > 0)) {
        duration = await probeDurationFromUrl(job.fileURL);
      }
      if (duration > 0) {
        const seg = map[job.segName];
        if (!seg.duration || duration > seg.duration) {
          seg.duration = duration;
        }
      }
      return duration;
    },
    onProgress,
  );

  // Fallback duration for segments that still have 0 (use 60s like Python path)
  for (const seg of Object.values(map)) {
    if (!(seg.duration > 0)) seg.duration = 60;
  }

  const segments = Object.values(map);
  segments.sort(
    (a, b) =>
      dayjs(parseTime(a.name)).valueOf() - dayjs(parseTime(b.name)).valueOf(),
  );

  let duration = 0;
  segments.forEach((i) => {
    i.startSeconds = duration;
    duration += i.duration;
  });

  return { segments, duration, urls };
}

/** Extract one segment's SEI on a dedicated worker (off the main thread). */
function extractSegmentSEIViaWorker(
  worker: Worker,
  file: File,
  startSeconds: number,
  duration: number,
  id: number,
): Promise<SEIDataPoint[]> {
  return new Promise((resolve, reject) => {
    const onMessage = (
      e: MessageEvent<{ id: number; points?: SEIDataPoint[]; error?: string }>,
    ) => {
      if (e.data.id !== id) return;
      worker.removeEventListener('message', onMessage);
      if (e.data.error) reject(new Error(e.data.error));
      else resolve(e.data.points ?? []);
    };
    worker.addEventListener('message', onMessage);
    worker.postMessage({ id, file, startSeconds, duration });
  });
}

/**
 * Extract SEI metadata from front camera files asynchronously.
 * Runs in Web Workers so multi-GB scans never block the UI thread;
 * falls back to in-thread parsing when workers are unavailable.
 */
export async function extractFootageSEI(
  files: File[],
  footage: CamFootage,
): Promise<SEIDataPoint[] | undefined> {
  const frontFiles: Record<string, File> = {};
  for (const file of files) {
    const name = file.name.slice(0, 19);
    const restName = file.name.slice(20);
    if (restName.startsWith('front')) {
      frontFiles[name] = file;
    }
  }

  const allDataPoints: SEIDataPoint[] = [];

  // Process front segments with limited concurrency to keep memory bounded.
  const frontJobs = footage.segments
    .map((seg) => ({ seg, file: frontFiles[seg.name] }))
    .filter(
      (j): j is { seg: (typeof footage.segments)[0]; file: File } => !!j.file,
    );

  const WORKERS = 2;
  let workers: Worker[] = [];
  try {
    workers = Array.from(
      { length: Math.min(WORKERS, frontJobs.length || 1) },
      () =>
        new Worker(new URL('./seiWorker.ts', import.meta.url), {
          type: 'module',
        }),
    );
  } catch {
    workers = [];
  }

  try {
    if (workers.length > 0) {
      let jobId = 0;
      await mapPool(frontJobs, workers.length, async ({ seg, file }, index) => {
        const worker = workers[index % workers.length];
        try {
          const points = await extractSegmentSEIViaWorker(
            worker,
            file,
            seg.startSeconds,
            seg.duration,
            jobId++,
          );
          allDataPoints.push(...points);
        } catch (e) {
          console.warn(`SEI extraction failed for segment ${seg.name}:`, e);
        }
        return null;
      });
    } else {
      // Fallback: parse on the main thread
      const { extractSEIFromFile, convertToDataPoints } =
        await import('./parseSEI');
      await mapPool(frontJobs, 2, async ({ seg, file }) => {
        try {
          const rawMessages = await extractSEIFromFile(file);
          if (rawMessages.length > 0) {
            allDataPoints.push(
              ...convertToDataPoints(
                rawMessages,
                seg.startSeconds,
                seg.duration,
              ),
            );
          }
        } catch (e) {
          console.warn(`SEI extraction failed for segment ${seg.name}:`, e);
        }
        return null;
      });
    }
  } finally {
    workers.forEach((w) => w.terminate());
  }

  allDataPoints.sort((a, b) => a.offsetSeconds - b.offsetSeconds);
  return allDataPoints.length > 0 ? allDataPoints : undefined;
}

export function revokeFootage(footage?: CamFootage) {
  footage?.urls.forEach((i) => URL.revokeObjectURL(i));
}
