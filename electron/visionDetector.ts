import { spawn } from 'child_process';
import * as ort from 'onnxruntime-node';

import type { VisionDetection } from './visionTypes.js';

const SIZE = 416;
const FRAME_BYTES = SIZE * SIZE * 3;
const RELEVANT = new Map<number, VisionDetection['label']>([
  [0, 'person'],
  [1, 'bicycle'],
  [2, 'car'],
  [3, 'motorcycle'],
  [5, 'bus'],
  [7, 'truck'],
]);

let sessionPromise: Promise<ort.InferenceSession> | undefined;

function session(modelPath: string) {
  sessionPromise ??= ort.InferenceSession.create(modelPath, {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
  });
  return sessionPromise;
}

async function extractFrame(
  ffmpegPath: string,
  filePath: string,
  seconds: number,
): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const proc = spawn(
      ffmpegPath,
      [
        '-nostdin',
        '-hide_banner',
        '-loglevel',
        'error',
        '-ss',
        Math.max(0, seconds).toFixed(3),
        '-i',
        filePath,
        '-frames:v',
        '1',
        '-vf',
        `scale=${SIZE}:${SIZE}:force_original_aspect_ratio=decrease:flags=fast_bilinear,pad=${SIZE}:${SIZE}:0:0:color=0x727272`,
        '-f',
        'rawvideo',
        '-pix_fmt',
        'rgb24',
        'pipe:1',
      ],
      { windowsHide: true },
    );
    const chunks: Buffer[] = [];
    let length = 0;
    proc.stdout.on('data', (chunk: Buffer) => {
      length += chunk.length;
      if (length <= FRAME_BYTES) chunks.push(chunk);
    });
    proc.on('error', () => resolve(null));
    proc.on('close', (code) => {
      const data = Buffer.concat(chunks);
      resolve(code === 0 && data.length === FRAME_BYTES ? data : null);
    });
  });
}

function iou(a: VisionDetection, b: VisionDetection): number {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  const union = a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
}

function decode(output: Float32Array): VisionDetection[] {
  const strides = [8, 16, 32];
  const candidates: VisionDetection[] = [];
  let row = 0;
  for (const stride of strides) {
    const grid = SIZE / stride;
    for (let gy = 0; gy < grid; gy++) {
      for (let gx = 0; gx < grid; gx++, row++) {
        const base = row * 85;
        const objectness = output[base + 4];
        if (objectness < 0.2) continue;
        let bestClass = -1;
        let bestScore = 0;
        for (const classId of RELEVANT.keys()) {
          const score = objectness * output[base + 5 + classId];
          if (score > bestScore) {
            bestScore = score;
            bestClass = classId;
          }
        }
        if (bestScore < 0.3) continue;
        const label = RELEVANT.get(bestClass);
        if (!label) continue;
        const cx = (output[base] + gx) * stride;
        const cy = (output[base + 1] + gy) * stride;
        const width = Math.exp(output[base + 2]) * stride;
        const height = Math.exp(output[base + 3]) * stride;
        const paddedY = Math.max(0, (cy - height / 2) / SIZE);
        const contentRatio = 0.75; // Tesla camera footage is 4:3 in 416×416 pad.
        const detection: VisionDetection = {
          label,
          confidence: bestScore,
          x: Math.max(0, (cx - width / 2) / SIZE),
          y: Math.max(0, paddedY / contentRatio),
          width: Math.min(1, width / SIZE),
          height: Math.min(1, height / SIZE / contentRatio),
        };
        const bottom = detection.y + detection.height;
        const area = detection.width * detection.height;
        // Distant traffic is not a wheel-contact candidate. Require the object
        // to reach the lower half and occupy a meaningful portion of frame.
        const near =
          bottom >= 0.52 &&
          (label === 'person'
            ? detection.height >= 0.16 && area >= 0.008
            : area >= 0.018);
        if (near) candidates.push(detection);
      }
    }
  }
  candidates.sort((a, b) => b.confidence - a.confidence);
  const kept: VisionDetection[] = [];
  for (const candidate of candidates) {
    if (
      kept.some(
        (existing) =>
          existing.label === candidate.label && iou(existing, candidate) > 0.5,
      )
    )
      continue;
    kept.push(candidate);
  }
  return kept.slice(0, 8);
}

export async function detectRelevantObjects(
  modelPath: string,
  ffmpegPath: string,
  filePath: string,
  seconds: number,
): Promise<VisionDetection[]> {
  const frame = await extractFrame(ffmpegPath, filePath, seconds);
  if (!frame) return [];
  const input = new Float32Array(3 * SIZE * SIZE);
  const plane = SIZE * SIZE;
  for (let pixel = 0; pixel < plane; pixel++) {
    input[pixel] = frame[pixel * 3];
    input[plane + pixel] = frame[pixel * 3 + 1];
    input[plane * 2 + pixel] = frame[pixel * 3 + 2];
  }
  const inference = await session(modelPath);
  const result = await inference.run({
    images: new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]),
  });
  return decode(result.output.data as Float32Array);
}
