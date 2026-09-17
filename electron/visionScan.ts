import type { ChildProcessWithoutNullStreams } from 'child_process';
import { spawn } from 'child_process';
import { createHash } from 'crypto';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';

import { detectRelevantObjects } from './visionDetector.js';
import type {
  VisionCamera,
  VisionCandidate,
  VisionDetection,
  VisionScanProgress,
  VisionScanRequest,
  VisionTrack,
} from './visionTypes.js';

const WIDTH = 160;
const HEIGHT = 90;
// First pass is deliberately sparse. A person or vehicle approaching a wheel
// persists for several seconds; decoding every frame only makes review arrive
// later without improving that initial triage.
const FPS = 1;
const FRAME_BYTES = WIDTH * HEIGHT;
const PIXEL_DELTA = 22;
const MIN_ACTIVE_RATIO = 0.018;
const MAX_GLOBAL_RATIO = 0.38;
const MERGE_GAP_SECONDS = 2;
const MIN_EVENT_SECONDS = 0.65;

type ActiveScan = {
  canceled: boolean;
  process?: ChildProcessWithoutNullStreams;
};
type FrameScore = { seconds: number; motion: number; movingCamera: boolean };

export const activeVisionScans = new Map<string, ActiveScan>();

function validatePath(filePath: string): boolean {
  if (
    !path.isAbsolute(filePath) ||
    path.extname(filePath).toLowerCase() !== '.mp4'
  )
    return false;
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function cameraFor(filePath: string): VisionCamera | undefined {
  const name = path.basename(filePath).toLowerCase();
  if (name.includes('-left_repeater')) return 'left';
  if (name.includes('-left_pillar')) return 'left_pillar';
  if (name.includes('-right_repeater')) return 'right';
  if (name.includes('-right_pillar')) return 'right_pillar';
  if (name.includes('-front')) return 'front';
  if (name.includes('-back')) return 'back';
  return undefined;
}

function segmentStamp(filePath: string): number {
  const match = path
    .basename(filePath)
    .match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/);
  if (!match) return Number.NaN;
  const [, year, month, day, hour, minute, second] = match;
  return new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  ).getTime();
}

/** ROI weights favor the near-car/lower portion without pretending to know depth. */
function roiWeight(
  x: number,
  y: number,
  wheel: VisionScanRequest['wheel'],
): number {
  const nx = x / WIDTH;
  const ny = y / HEIGHT;
  if (ny < 0.28) return 0;
  const vertical = 0.35 + ny * 0.9;
  // Repeaters look rearward. Rear-wheel searches emphasize the near/lower edge;
  // front-wheel searches stay broader because the wheel itself is out of view.
  const horizontal =
    wheel === 'left_rear'
      ? 0.7 + Math.max(0, nx - 0.35) * 0.8
      : 0.85 + (1 - Math.abs(nx - 0.5) * 2) * 0.25;
  return vertical * horizontal;
}

/**
 * Estimate coarse whole-camera translation on a sparse background grid.
 * A stationary parked camera is best matched at (0, 0); a moving car usually
 * gains a strong match after shifting the previous frame. Local people/cars
 * do not dominate enough background pixels to produce that improvement.
 */
function estimateCameraMotion(
  previous: Buffer,
  current: Buffer,
  lumaShift: number,
): { magnitude: number; improvement: number } {
  const cost = (dx: number, dy: number) => {
    let sad = 0;
    let count = 0;
    // Use the upper background for ego-motion. The lower half is precisely
    // where a close person/vehicle should be allowed to dominate.
    for (let y = 6; y < Math.floor(HEIGHT * 0.46); y += 6) {
      for (let x = 10; x < WIDTH - 10; x += 8) {
        const before = previous[(y + dy) * WIDTH + x + dx];
        const after = current[y * WIDTH + x];
        sad += Math.abs(after - before - lumaShift);
        count++;
      }
    }
    return sad / Math.max(1, count);
  };

  const zero = cost(0, 0);
  if (zero < 3) return { magnitude: 0, improvement: 0 };
  let best = zero;
  let bestDx = 0;
  let bestDy = 0;
  for (let dy = -4; dy <= 4; dy += 2) {
    for (let dx = -8; dx <= 8; dx += 2) {
      if (dx === 0 && dy === 0) continue;
      const candidate = cost(dx, dy);
      if (candidate < best) {
        best = candidate;
        bestDx = dx;
        bestDy = dy;
      }
    }
  }
  return {
    magnitude: Math.hypot(bestDx, bestDy),
    improvement: (zero - best) / zero,
  };
}

function scoreFrame(
  previous: Buffer,
  current: Buffer,
  wheel: VisionScanRequest['wheel'],
): { motion: number; movingCamera: boolean } {
  // Remove uniform exposure/headlight changes before classifying pixels as
  // motion. Sampling is enough because this is only a global luma offset.
  let lumaShift = 0;
  let lumaSamples = 0;
  for (let y = 0; y < HEIGHT; y += 4) {
    for (let x = 0; x < WIDTH; x += 4) {
      const index = y * WIDTH + x;
      lumaShift += current[index] - previous[index];
      lumaSamples++;
    }
  }
  lumaShift /= Math.max(1, lumaSamples);
  const cameraMotion = estimateCameraMotion(previous, current, lumaShift);
  const translatedCamera =
    cameraMotion.magnitude >= 2 && cameraMotion.improvement > 0.09;

  let activeWeight = 0;
  let totalWeight = 0;
  let globallyActive = 0;
  let upperActive = 0;
  let upperSamples = 0;
  const blockCols = 8;
  const blockRows = 5;
  const blockActive = new Uint16Array(blockCols * blockRows);
  const blockSamples = new Uint16Array(blockCols * blockRows);
  for (let y = 0; y < HEIGHT; y += 2) {
    for (let x = 0; x < WIDTH; x += 2) {
      const index = y * WIDTH + x;
      const delta = Math.abs(current[index] - previous[index] - lumaShift);
      const active = delta > PIXEL_DELTA;
      if (active) globallyActive++;
      if (y < HEIGHT * 0.36) {
        upperSamples++;
        if (active) upperActive++;
      }
      const blockX = Math.min(
        blockCols - 1,
        Math.floor((x / WIDTH) * blockCols),
      );
      const blockY = Math.min(
        blockRows - 1,
        Math.floor((y / HEIGHT) * blockRows),
      );
      const blockIndex = blockY * blockCols + blockX;
      blockSamples[blockIndex]++;
      if (active) blockActive[blockIndex]++;
      const weight = roiWeight(x, y, wheel);
      totalWeight += weight;
      if (active) activeWeight += weight;
    }
  }
  const samples = (WIDTH / 2) * (HEIGHT / 2);
  const globalRatio = globallyActive / samples;
  const upperRatio = upperActive / Math.max(1, upperSamples);
  let busyBlocks = 0;
  let peakBlock = 0;
  for (let i = 0; i < blockActive.length; i++) {
    const ratio = blockActive[i] / Math.max(1, blockSamples[i]);
    if (ratio > 0.12) busyBlocks++;
    peakBlock = Math.max(peakBlock, ratio);
  }
  const spread = busyBlocks / blockActive.length;

  // Driving and camera shake move most of the background at once. Nearby
  // people and vehicles are usually spatially concentrated, especially in the
  // lower/near region. Keep a large close object when the upper background is
  // still stable, but reject broad coherent scene motion.
  const movingCamera =
    translatedCamera ||
    (globalRatio > 0.16 && upperRatio > 0.04) ||
    (spread > 0.35 && upperRatio > 0.06);
  if (globalRatio > MAX_GLOBAL_RATIO || totalWeight === 0)
    return { motion: 0, movingCamera };
  if (spread > 0.55 && upperRatio > 0.12) return { motion: 0, movingCamera };
  const nearRatio = activeWeight / totalWeight;
  const locality = Math.max(0.35, 1 - spread * 0.8);
  return {
    motion: nearRatio * locality * (0.75 + peakBlock * 0.5),
    movingCamera,
  };
}

function mergeScores(
  scores: FrameScore[],
  meta: {
    clipName: string;
    camera: VisionCamera;
    offset: number;
    filePath: string;
  },
): VisionCandidate[] {
  // Do not trust a local-looking residual while the car is moving. Keep a
  // five-second guard around broad scene motion, then resume detecting once
  // the parked background has stabilized.
  const movingIndexes = new Set(
    scores.flatMap((frame, index) => (frame.movingCamera ? [index] : [])),
  );
  const active = scores.filter((frame, index) => {
    if (frame.motion < MIN_ACTIVE_RATIO) return false;
    for (let nearby = index - 5 * FPS; nearby <= index + 5 * FPS; nearby++) {
      if (movingIndexes.has(nearby)) return false;
    }
    return true;
  });
  if (active.length === 0) return [];
  const groups: FrameScore[][] = [];
  for (const frame of active) {
    const group = groups.at(-1);
    if (!group || frame.seconds - group.at(-1)!.seconds > MERGE_GAP_SECONDS) {
      groups.push([frame]);
    } else {
      group.push(frame);
    }
  }
  return groups.flatMap((group, index) => {
    const first = group[0];
    const last = group.at(-1)!;
    const duration = last.seconds - first.seconds + 1 / FPS;
    if (duration < MIN_EVENT_SECONDS) return [];
    const peak = group.reduce((best, frame) =>
      frame.motion > best.motion ? frame : best,
    );
    const persistence = Math.min(1, duration / 6);
    const score = Math.round(
      Math.min(100, 25 + peak.motion * 420 + persistence * 35),
    );
    const startSeconds = meta.offset + first.seconds;
    const endSeconds = meta.offset + last.seconds + 1 / FPS;
    return [
      {
        id: `${meta.clipName}:${meta.camera}:${Math.round(startSeconds * 10)}:${index}`,
        clipName: meta.clipName,
        camera: meta.camera,
        startSeconds,
        endSeconds,
        peakSeconds: meta.offset + peak.seconds,
        score,
        peakMotion: peak.motion,
        videoPath: meta.filePath,
        videoSeconds: peak.seconds,
        detections: [],
        tracks: [],
      },
    ];
  });
}

async function scanVideo(
  ffmpegPath: string,
  filePath: string,
  wheel: VisionScanRequest['wheel'],
  session: ActiveScan,
): Promise<FrameScore[]> {
  return new Promise((resolve, reject) => {
    const process = spawn(
      ffmpegPath,
      [
        '-nostdin',
        '-hide_banner',
        '-loglevel',
        'error',
        '-threads',
        '1',
        '-skip_frame',
        'nokey',
        '-i',
        filePath,
        '-vf',
        `fps=${FPS},scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=disable:flags=fast_bilinear,format=gray`,
        '-f',
        'rawvideo',
        '-pix_fmt',
        'gray',
        'pipe:1',
      ],
      { windowsHide: true },
    );
    session.process = process;
    let buffer = Buffer.alloc(0);
    let previous: Buffer | undefined;
    let frameIndex = 0;
    const scores: FrameScore[] = [];
    let stderr = '';
    process.stdout.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= FRAME_BYTES) {
        const frame = buffer.subarray(0, FRAME_BYTES);
        buffer = buffer.subarray(FRAME_BYTES);
        if (previous) {
          const score = scoreFrame(previous, frame, wheel);
          scores.push({
            seconds: frameIndex / FPS,
            ...score,
          });
        }
        previous = Buffer.from(frame);
        frameIndex++;
      }
    });
    process.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });
    process.on('error', reject);
    process.on('close', (code) => {
      session.process = undefined;
      if (session.canceled) return resolve([]);
      if (code === 0) resolve(scores);
      else reject(new Error(stderr.trim() || `FFmpeg exited with ${code}`));
    });
  });
}

function cacheFile(cacheDir: string, request: VisionScanRequest): string {
  const fingerprint = request.clips.flatMap((clip) =>
    clip.paths.map((filePath) => {
      try {
        const stat = fs.statSync(filePath);
        return `${filePath}:${stat.size}:${stat.mtimeMs}`;
      } catch {
        return filePath;
      }
    }),
  );
  const digest = createHash('sha1')
    .update(
      JSON.stringify({
        version: 7,
        wheel: request.wheel,
        cameras: [...request.cameras].sort(),
        fingerprint,
      }),
    )
    .digest('hex');
  return path.join(cacheDir, `${digest}.json`);
}

export async function runVisionScan(
  ffmpegPath: string,
  modelPath: string,
  cacheDir: string,
  request: VisionScanRequest,
  onProgress: (progress: VisionScanProgress) => void,
): Promise<{ candidates: VisionCandidate[]; cached: boolean }> {
  if (!/^[\w.-]{1,64}$/.test(request.sessionId))
    throw new Error('Invalid session id');
  if (!Array.isArray(request.clips) || request.clips.length === 0)
    throw new Error('No clips to scan');
  if (!Array.isArray(request.cameras) || request.cameras.length === 0)
    throw new Error('No cameras selected');
  const target = cacheFile(cacheDir, request);
  try {
    const parsed = JSON.parse(await fsPromises.readFile(target, 'utf8')) as {
      candidates?: VisionCandidate[];
    };
    if (Array.isArray(parsed.candidates)) {
      return { candidates: parsed.candidates, cached: true };
    }
  } catch {
    // Cache miss.
  }

  const priority = { sentry: 0, saved: 1, recent: 2 } as const;
  const jobs = request.clips
    .flatMap((clip) => {
      const selectedCameras = new Set(request.cameras);
      const paths = clip.paths.filter(validatePath).filter((filePath) => {
        const camera = cameraFor(filePath);
        return camera !== undefined && selectedCameras.has(camera);
      });
      const baseStamp = Math.min(
        ...paths.map(segmentStamp).filter(Number.isFinite),
      );
      return paths.map((filePath) => {
        const stamp = segmentStamp(filePath);
        return {
          clipName: clip.clipName,
          filePath,
          camera: cameraFor(filePath)!,
          offset:
            Number.isFinite(stamp) && Number.isFinite(baseStamp)
              ? Math.max(0, (stamp - baseStamp) / 1000)
              : 0,
          priority: clip.clipType ? priority[clip.clipType] : 3,
        };
      });
    })
    .sort(
      (a, b) => a.priority - b.priority || a.clipName.localeCompare(b.clipName),
    );
  if (jobs.length === 0) throw new Error('No left camera videos found');

  const session: ActiveScan = { canceled: false };
  activeVisionScans.set(request.sessionId, session);
  const candidates: VisionCandidate[] = [];
  onProgress({
    sessionId: request.sessionId,
    completed: 0,
    total: jobs.length,
    candidates: 0,
    results: [],
  });
  try {
    for (let i = 0; i < jobs.length; i++) {
      if (session.canceled)
        throw Object.assign(new Error('Canceled'), { canceled: true });
      const job = jobs[i];
      const scores = await scanVideo(
        ffmpegPath,
        job.filePath,
        request.wheel,
        session,
      );
      const motionCandidates = mergeScores(scores, job);
      for (const candidate of motionCandidates) {
        if (session.canceled) break;
        const detectionFrames: VisionDetection[][] = [];
        for (const delta of [-1, 0, 1]) {
          detectionFrames.push(
            await detectRelevantObjects(
              modelPath,
              ffmpegPath,
              candidate.videoPath,
              Math.max(0, candidate.videoSeconds + delta),
            ),
          );
        }
        const labelCounts = new Map<string, number>();
        for (const frame of detectionFrames) {
          for (const label of new Set(frame.map((item) => item.label))) {
            labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
          }
        }
        const stableLabels = new Set(
          [...labelCounts]
            .filter(([, count]) => count >= 2)
            .map(([label]) => label),
        );
        const detections = detectionFrames[1].filter((item) =>
          stableLabels.has(item.label),
        );
        if (detections.length === 0) continue;
        candidate.detections = detections;
        const center = (item: (typeof detections)[number]) => ({
          x: item.x + item.width / 2,
          y: item.y + item.height / 2,
        });
        const nearest = (
          target: (typeof detections)[number],
          frame: typeof detections,
        ) => {
          const origin = center(target);
          return frame
            .filter((item) => item.label === target.label)
            .map((item) => {
              const point = center(item);
              return {
                item,
                distance: Math.hypot(point.x - origin.x, point.y - origin.y),
              };
            })
            .filter((match) => match.distance < 0.32)
            .sort((a, b) => a.distance - b.distance)[0]?.item;
        };
        const tracks: VisionTrack[] = detections.flatMap((detection) => {
          const before = nearest(detection, detectionFrames[0]);
          const after = nearest(detection, detectionFrames[2]);
          const samples = [before, detection, after].filter(
            (item): item is typeof detection => Boolean(item),
          );
          if (samples.length < 2) return [];
          const firstArea = samples[0].width * samples[0].height;
          const last = samples.at(-1)!;
          const lastArea = last.width * last.height;
          const scaleChangePct =
            firstArea > 0 ? ((lastArea - firstArea) / firstArea) * 100 : 0;
          const movement =
            scaleChangePct > 12
              ? 'approaching'
              : scaleChangePct < -12
                ? 'leaving'
                : 'stable';
          const bottom = detection.y + detection.height;
          const area = detection.width * detection.height;
          const proximityScore = bottom * 0.62 + Math.min(1, area * 5) * 0.38;
          const proximity =
            proximityScore >= 0.82
              ? 'very_near'
              : proximityScore >= 0.68
                ? 'near'
                : proximityScore >= 0.54
                  ? 'medium'
                  : 'far';
          return [
            {
              label: detection.label,
              movement,
              proximity,
              scaleChangePct,
              points: samples.map((item, index) => ({
                ...center(item),
                offsetSeconds: index - (before ? 1 : 0),
              })),
            } satisfies VisionTrack,
          ];
        });
        if (tracks.length === 0) continue;
        candidate.tracks = tracks;
        const confidence = Math.max(
          ...detections.map((item) => item.confidence),
        );
        const duration = candidate.endSeconds - candidate.startSeconds;
        candidate.score = Math.round(
          Math.min(100, 45 + confidence * 35 + Math.min(20, duration * 3)),
        );
        candidates.push(candidate);
      }
      candidates.sort(
        (a, b) => b.score - a.score || a.peakSeconds - b.peakSeconds,
      );
      onProgress({
        sessionId: request.sessionId,
        completed: i + 1,
        total: jobs.length,
        clipName: job.clipName,
        candidates: candidates.length,
        results: [...candidates],
      });
    }
  } finally {
    activeVisionScans.delete(request.sessionId);
  }
  candidates.sort((a, b) => b.score - a.score || a.peakSeconds - b.peakSeconds);
  await fsPromises.mkdir(cacheDir, { recursive: true });
  await fsPromises.writeFile(
    target,
    JSON.stringify({ version: 7, savedAt: Date.now(), candidates }),
    'utf8',
  );
  return { candidates, cached: false };
}

export function cancelVisionScan(sessionId: string): void {
  const session = activeVisionScans.get(sessionId);
  if (!session) return;
  session.canceled = true;
  session.process?.kill('SIGKILL');
}

/** Extract and cache one evidence frame only when its result card is visible. */
export async function getVisionThumbnail(
  ffmpegPath: string,
  cacheDir: string,
  filePath: string,
  seconds: number,
): Promise<string | null> {
  if (!validatePath(filePath) || !Number.isFinite(seconds) || seconds < 0)
    return null;
  let stat: fs.Stats;
  try {
    stat = await fsPromises.stat(filePath);
  } catch {
    return null;
  }
  const digest = createHash('sha1')
    .update(`${filePath}:${stat.size}:${stat.mtimeMs}:${seconds.toFixed(1)}`)
    .digest('hex');
  const dir = path.join(cacheDir, 'thumbs');
  const target = path.join(dir, `${digest}.jpg`);
  try {
    const cached = await fsPromises.readFile(target);
    return `data:image/jpeg;base64,${cached.toString('base64')}`;
  } catch {
    // Cache miss.
  }

  const jpeg = await new Promise<Buffer | null>((resolve) => {
    const process = spawn(
      ffmpegPath,
      [
        '-nostdin',
        '-hide_banner',
        '-loglevel',
        'error',
        '-ss',
        seconds.toFixed(3),
        '-i',
        filePath,
        '-frames:v',
        '1',
        '-vf',
        'scale=320:-2:flags=fast_bilinear',
        '-q:v',
        '5',
        '-f',
        'image2pipe',
        '-vcodec',
        'mjpeg',
        'pipe:1',
      ],
      { windowsHide: true },
    );
    const chunks: Buffer[] = [];
    let size = 0;
    process.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size <= 2 * 1024 * 1024) chunks.push(chunk);
    });
    process.on('error', () => resolve(null));
    process.on('close', (code) =>
      resolve(
        code === 0 && size <= 2 * 1024 * 1024 ? Buffer.concat(chunks) : null,
      ),
    );
  });
  if (!jpeg?.length) return null;
  await fsPromises.mkdir(dir, { recursive: true });
  await fsPromises.writeFile(target, jpeg).catch(() => {});
  return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
}
