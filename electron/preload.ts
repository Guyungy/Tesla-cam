import { contextBridge, ipcRenderer, webUtils } from 'electron';

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

  // FFmpeg video export
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
