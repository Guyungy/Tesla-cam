/**
 * Web Worker: extract Tesla SEI telemetry from a dashcam MP4 off the main
 * thread. One message per file; replies with converted datapoints.
 */
import { convertToDataPoints, extractSEIFromFile } from './parseSEI';
import type { SEIDataPoint } from './types';

export type SeiWorkerRequest = {
  id: number;
  file: File;
  startSeconds: number;
  duration: number;
};

export type SeiWorkerResponse = {
  id: number;
  points?: SEIDataPoint[];
  error?: string;
};

// The project compiles against the DOM lib; cast to the worker-scope shape.
const workerSelf = self as unknown as {
  postMessage: (msg: SeiWorkerResponse) => void;
  onmessage: ((e: MessageEvent<SeiWorkerRequest>) => void) | null;
};

workerSelf.onmessage = async (e: MessageEvent<SeiWorkerRequest>) => {
  const { id, file, startSeconds, duration } = e.data;
  try {
    const raw = await extractSEIFromFile(file);
    const points =
      raw.length > 0 ? convertToDataPoints(raw, startSeconds, duration) : [];
    workerSelf.postMessage({ id, points });
  } catch (err) {
    workerSelf.postMessage({ id, error: String(err) });
  }
};
