export type WheelSide = 'left_front' | 'left_rear';
export type VisionCamera =
  | 'front'
  | 'back'
  | 'left'
  | 'right'
  | 'left_pillar'
  | 'right_pillar';

export type VisionScanClip = {
  clipName: string;
  paths: string[];
  clipType?: 'recent' | 'saved' | 'sentry';
};

export type VisionScanRequest = {
  sessionId: string;
  wheel: WheelSide;
  clips: VisionScanClip[];
  cameras: VisionCamera[];
};

export type VisionCandidate = {
  id: string;
  clipName: string;
  camera: VisionCamera;
  startSeconds: number;
  endSeconds: number;
  peakSeconds: number;
  score: number;
  peakMotion: number;
  /** Internal source used to lazily render an evidence thumbnail. */
  videoPath: string;
  videoSeconds: number;
  detections: VisionDetection[];
  tracks: VisionTrack[];
};

export type VisionDetection = {
  label: 'person' | 'bicycle' | 'car' | 'motorcycle' | 'bus' | 'truck';
  confidence: number;
  /** Normalized coordinates in the source frame. */
  x: number;
  y: number;
  width: number;
  height: number;
};

export type VisionTrack = {
  label: VisionDetection['label'];
  movement: 'approaching' | 'stable' | 'leaving';
  proximity: 'far' | 'medium' | 'near' | 'very_near';
  scaleChangePct: number;
  points: { x: number; y: number; offsetSeconds: number }[];
};

export type VisionScanProgress = {
  sessionId: string;
  completed: number;
  total: number;
  clipName?: string;
  candidates: number;
  /** Ranked snapshot found so far, so review can begin before the scan ends. */
  results: VisionCandidate[];
};

export type VisionScanResult =
  | { ok: true; candidates: VisionCandidate[]; cached?: boolean }
  | { ok: false; canceled?: boolean; error?: string };
