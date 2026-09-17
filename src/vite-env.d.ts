/// <reference types="vite/client" />

// Compose export IPC types are shared with the main process — single source
// of truth in electron/composeTypes.ts (type-only, no Node imports).
import type {
  ComposeExportRequest,
  ComposeExportResult,
  ComposeProgressEvent,
} from '../electron/composeTypes';
import type {
  VisionScanProgress,
  VisionScanRequest,
  VisionScanResult,
} from '../electron/visionTypes';
import type { SEIDataPoint } from './utils/types';

declare global {
  interface Window {
    electronAPI?: {
      minimize: () => void;
      maximize: () => void;
      close: () => void;
      saveFile: (name: string, buffer: ArrayBuffer) => Promise<string | null>;
      showItemInFolder: (path: string) => void;
      getPathForFile: (file: File) => string;
      trashFiles: (
        paths: string[],
        clipName: string,
      ) => Promise<{
        ok: boolean;
        canceled?: boolean;
        error?: string;
        trashedCount?: number;
        /** Files that could not be removed (partial delete). */
        failedCount?: number;
        /** True when the drive has no Recycle Bin and files were erased. */
        permanent?: boolean;
      }>;
      autoLoadTeslaDrive: () => Promise<{
        ok: boolean;
        found: boolean;
        directory?: string;
        error?: string;
      }>;

      // SEI telemetry cache — extraction results persisted across restarts
      seiCacheRead: (key: string) => Promise<unknown>;
      seiCacheWrite: (key: string, points: SEIDataPoint[]) => Promise<unknown>;
      seiCacheDelete: (key: string) => Promise<unknown>;
      seiCacheClear: () => Promise<unknown>;

      visionScanStart: (
        payload: VisionScanRequest,
      ) => Promise<VisionScanResult>;
      visionScanCancel: (sessionId: string) => void;
      visionThumbnail: (
        filePath: string,
        seconds: number,
      ) => Promise<string | null>;
      onVisionScanProgress: (
        callback: (data: VisionScanProgress) => void,
      ) => () => void;

      // Fast compose export
      exportCompose: (
        payload: ComposeExportRequest,
      ) => Promise<ComposeExportResult>;
      exportComposeCancel: (sessionId: string) => void;
      onExportComposeProgress?: (
        callback: (data: ComposeProgressEvent) => void,
      ) => () => void;

      // Legacy FFmpeg video export (canvas RGBA)
      exportStart: (opts: {
        sessionId: string;
        fileName: string;
        width: number;
        height: number;
        fps: number;
      }) => Promise<{
        ok: boolean;
        canceled?: boolean;
        filePath?: string;
        error?: string;
      }>;
      exportFrame: (
        sessionId: string,
        frameData: Uint8Array,
      ) => Promise<{
        ok: boolean;
        frameNum?: number;
        error?: string;
      }>;
      exportFinish: (sessionId: string) => Promise<{
        ok: boolean;
        filePath?: string;
        error?: string;
        frameCount?: number;
      }>;
      exportCancel: (sessionId: string) => void;
    };
  }
}

export {};
