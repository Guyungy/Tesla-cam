/**
 * Shared types for the compose export IPC contract.
 *
 * This file must stay free of runtime imports (no `fs`, no `electron`) so it
 * can be type-imported from the renderer (`src/vite-env.d.ts`), the preload
 * script, and the main process without pulling Node types into the renderer.
 */

export type CamName =
  | 'front'
  | 'back'
  | 'left'
  | 'right'
  | 'left_pillar'
  | 'right_pillar';

export type ComposeViewType = 'grid6' | 'grid4' | 'grid4old' | CamName;

export type ComposeSegment = {
  name: string;
  startSeconds: number;
  duration: number;
  paths: Partial<Record<CamName, string>>;
};

/** A time window (seconds, relative to export start) with static overlay text. */
export type ComposeDriveWindow = {
  start: number;
  end: number;
  text: string;
};

export type ComposeOverlay = {
  showTime?: boolean;
  showLocation?: boolean;
  showDriveData?: boolean;
  locationText?: string;
  /** Static fallback label when no epoch is available. */
  baseTimestampLabel?: string;
  /** Unix seconds at export start — enables a live-updating clock overlay. */
  baseTimestampEpoch?: number;
  /** Pre-sampled drive telemetry windows (speed / gear / AP). */
  driveWindows?: ComposeDriveWindow[];
};

export type ComposeExportRequest = {
  sessionId: string;
  fileName: string;
  viewType: ComposeViewType;
  startSeconds: number;
  durationSeconds: number;
  segments: ComposeSegment[];
  overlay?: ComposeOverlay;
  labels?: Partial<Record<CamName, string>>;
  fps?: number;
  /** Use a hardware H.264 encoder when one is detected (default true). */
  useHardware?: boolean;
};

export type ComposeExportResult = {
  ok: boolean;
  /** True when the user canceled (save dialog or mid-encode). Not an error. */
  canceled?: boolean;
  filePath?: string;
  error?: string;
  width?: number;
  height?: number;
  fps?: number;
  /** Encoder actually used, e.g. 'libx264' or 'h264_nvenc'. */
  encoder?: string;
};

export type ComposeProgressEvent = {
  sessionId: string;
  progress: number;
  outTimeSec: number;
};
