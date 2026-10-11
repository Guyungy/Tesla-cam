import { contextBridge, ipcRenderer, webUtils } from 'electron';

import type {
  ComposeExportRequest,
  ComposeProgressEvent,
} from './composeTypes.js';
import type {
  VisionScanProgress,
  VisionScanRequest,
  VisionScanResult,
} from './visionTypes.js';

// Only disk-backed File objects can grant a deletion capability.
const selectedFiles = new Map<string, string>();
function getSelectedPath(file: File): string {
  const resolved = webUtils.getPathForFile(file);
  if (resolved) {
    const version = `${file.size}:${file.lastModified}`;
    if (selectedFiles.get(resolved) !== version) {
      selectedFiles.set(resolved, version);
      ipcRenderer.send('authorize-source-file', { path: resolved, size: file.size, lastModified: file.lastModified });
    }
  }
  return resolved;
}

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),

  // File save (screenshots, CSV, etc.)
  saveFile: (name: string, buffer: ArrayBuffer) =>
    ipcRenderer.invoke('save-file', { name, buffer }),
  showItemInFolder: (path: string) =>
    ipcRenderer.invoke('show-item-in-folder', path),
  getPathForFile: getSelectedPath,
  trashFiles: (paths: string[], clipName: string, locale?: string) => {
    if (!Array.isArray(paths) || !paths.length || paths.some((p) => !selectedFiles.has(p))) {
      return Promise.resolve({ ok: false, error: 'Files were not selected in this window' });
    }
    return ipcRenderer.invoke('trash-files', { paths, clipName, locale });
  },
  autoLoadTeslaDrive: () => ipcRenderer.invoke('auto-load-tesla-drive'),

  // SEI telemetry cache (renderer extracts, main process persists)
  seiCacheRead: (key: string): Promise<unknown> =>
    ipcRenderer.invoke('sei-cache-read', { key }),
  seiCacheWrite: (key: string, points: unknown): Promise<unknown> =>
    ipcRenderer.invoke('sei-cache-write', { key, points }),
  seiCacheDelete: (key: string): Promise<unknown> =>
    ipcRenderer.invoke('sei-cache-delete', { key }),
  seiCacheClear: (): Promise<unknown> => ipcRenderer.invoke('sei-cache-clear'),

  // Offline left-wheel visual candidate scan
  visionScanStart: (payload: VisionScanRequest): Promise<VisionScanResult> =>
    ipcRenderer.invoke('vision-scan-start', payload),
  visionScanCancel: (sessionId: string) =>
    ipcRenderer.send('vision-scan-cancel', { sessionId }),
  visionThumbnail: (
    filePath: string,
    seconds: number,
  ): Promise<string | null> =>
    ipcRenderer.invoke('vision-thumbnail', { filePath, seconds }),
  onVisionScanProgress: (callback: (data: VisionScanProgress) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      data: VisionScanProgress,
    ) => callback(data);
    ipcRenderer.on('vision-scan-progress', listener);
    return () => ipcRenderer.removeListener('vision-scan-progress', listener);
  },

  // Fast compose export (source files → FFmpeg filter_complex)
  exportCompose: (payload: ComposeExportRequest) =>
    ipcRenderer.invoke('export-compose', payload),
  exportComposeCancel: (sessionId: string) =>
    ipcRenderer.send('export-compose-cancel', { sessionId }),
  onExportComposeProgress: (callback: (data: ComposeProgressEvent) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      data: ComposeProgressEvent,
    ) => callback(data);
    ipcRenderer.on('export-compose-progress', listener);
    return () =>
      ipcRenderer.removeListener('export-compose-progress', listener);
  },

  // Legacy FFmpeg video export (canvas RGBA pipe — fallback)
  exportStart: (opts: {
    sessionId: string;
    fileName: string;
    width: number;
    height: number;
    fps: number;
  }) => ipcRenderer.invoke('export-start', opts),

  exportFrame: (sessionId: string, frameData: Uint8Array) =>
    ipcRenderer.invoke('export-frame', { sessionId, frameData }),

  exportFinish: (sessionId: string) =>
    ipcRenderer.invoke('export-finish', { sessionId }),

  exportCancel: (sessionId: string) =>
    ipcRenderer.send('export-cancel', { sessionId }),
});
