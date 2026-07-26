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

/**
 * Export geometry, computed once in the renderer so the composed video and the
 * canvas screenshot are laid out from exactly the same numbers. Without this
 * the two drifted badly: 16:9 cells letterboxed Tesla's 1.54:1 cameras, and the
 * bar metrics were a separate set of constants.
 */
export type ComposeLayout = {
  width: number;
  height: number;
  /** Height of the camera grid; the info bar occupies the remainder. */
  videoHeight: number;
  barHeight: number;
  /** Overlay scale (width / 1280) that all type sizes derive from. */
  scale: number;
  padding: number;
  brandSize: number;
  titleSize: number;
  subSize: number;
  gap: number;
  iconSize: number;
  /** Horizontal padding at the bar edges. */
  hPad: number;
  /** Left edge of the text column, i.e. past the icon. */
  leftTextX: number;
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
  /**
   * Per-second localized timestamps. FFmpeg's `%{pts:localtime:…}` can only
   * emit `YYYY-MM-DD HH:MM:SS` — its format argument renders nothing on this
   * build, and `%{…}` is never expanded from a textfile — so matching the
   * app's localized timestamp means pre-rendering one gated window per second.
   */
  timeWindows?: ComposeDriveWindow[];
  /** Small brand line above the timestamp, matching the canvas overlay. */
  brandText?: string;
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
  /** Geometry from the renderer; falls back to legacy constants when absent. */
  layout?: ComposeLayout;
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
