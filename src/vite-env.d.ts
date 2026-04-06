/// <reference types="vite/client" />

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
    ) => Promise<{ ok: boolean; canceled?: boolean; error?: string; trashedCount?: number }>;

    // FFmpeg video export
    exportStart: (opts: {
      sessionId: string;
      fileName: string;
      width: number;
      height: number;
      fps: number;
    }) => Promise<{ ok: boolean; filePath?: string; error?: string }>;
    exportFrame: (sessionId: string, frameData: Uint8Array) => Promise<{
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
