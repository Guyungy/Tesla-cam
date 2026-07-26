import { contextBridge, ipcRenderer, webUtils } from 'electron';

import type {
  ComposeExportRequest,
  ComposeProgressEvent,
} from './composeTypes.js';

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),

  // File save (screenshots, CSV, etc.)
  saveFile: (name: string, buffer: ArrayBuffer) =>
    ipcRenderer.invoke('save-file', { name, buffer }),
  showItemInFolder: (path: string) =>
    ipcRenderer.invoke('show-item-in-folder', path),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  trashFiles: (paths: string[], clipName: string) =>
    ipcRenderer.invoke('trash-files', { paths, clipName }),

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
