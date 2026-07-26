export type ClipType = 'recent' | 'saved' | 'sentry';

export type CamClip = {
  name: string;
  type?: ClipType;
  saveType?: 'aeb' | 'manual';
  thumb?: File;
  event?: CamClipEvent;
  videos: File[];
  sourcePaths?: string[];
};

export type CamClipEvent = {
  timestamp: string;
  city: string;
  street?: string;
  est_lat: string;
  est_lon: string;
  reason: string;
  camera: string;
};

/** All 6 Tesla camera positions (4 original + 2 B-pillar) */
export type CamName =
  | 'front'
  | 'back'
  | 'left'
  | 'right'
  | 'left_pillar'
  | 'right_pillar';

/** Layout modes for the viewer */
export type ViewType =
  | 'grid6' // 6-camera grid (3x2): all cameras
  | 'grid4' // 4-camera grid (2x2): front, back, left, right (new layout)
  | 'grid4old' // 4-camera grid (legacy): front top-wide, 3 bottom
  | 'front' // Single camera fullscreen
  | 'back'
  | 'left'
  | 'right'
  | 'left_pillar'
  | 'right_pillar';

export type CamFootage = {
  segments: CamSegment[];
  duration: number;
  urls: string[];
  /** Pre-parsed SEI metadata for the entire footage, indexed by seconds offset */
  seiData?: SEIDataPoint[];
};

export type CamSegment = {
  name: string;
  duration: number;
  startSeconds: number; // 方便进度相关计算
} & {
  [T in CamName]?: string;
};

export type PlayerState = {
  index?: number;
  currentTime?: number;
  ended?: boolean;
};

export type SeekInfo = {
  index: number;
  seconds: number;
};

// ── SEI Metadata Types (Tesla Software 2025.44.25.11+) ──────────────

/** Gear state */
export type GearState = 'P' | 'R' | 'N' | 'D' | 'UNKNOWN';

/** Autopilot / FSD engagement status */
export type APStatus = 'OFF' | 'STANDBY' | 'AP' | 'FSD' | 'UNKNOWN';

/** A single point of driving telemetry extracted from SEI NAL units */
export type SEIDataPoint = {
  /** Absolute seconds from the start of the entire footage */
  offsetSeconds: number;
  /** Speed in km/h */
  speedKph: number;
  /** Current gear */
  gear: GearState;
  /** Steering wheel angle in degrees (negative = left, positive = right) */
  steeringAngleDeg: number;
  /** Brake pedal percentage (0-100) */
  brakePct: number;
  /** Throttle pedal percentage (0-100) */
  throttlePct: number;
  /** Autopilot status */
  apStatus: APStatus;
  /** GPS latitude */
  latitude: number;
  /** GPS longitude */
  longitude: number;
};
