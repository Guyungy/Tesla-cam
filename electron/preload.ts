import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  saveFile: (name: string, buffer: ArrayBuffer) =>
    ipcRenderer.invoke('save-file', { name, buffer }),
  showItemInFolder: (path: string) =>
    ipcRenderer.invoke('show-item-in-folder', path),
});
