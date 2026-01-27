/// <reference types="vite/client" />

interface Window {
  electronAPI?: {
    minimize: () => void;
    maximize: () => void;
    close: () => void;
    saveFile: (name: string, buffer: ArrayBuffer) => Promise<string | null>;
    showItemInFolder: (path: string) => Promise<void>;
  };
}
