import { useCallback, useEffect, useRef, useState } from 'react';

import { type CamClip, genClips } from '../utils';
import { useI18n } from '../i18n';
import { Home } from './Home';

const LAST_FOLDER_KEY = 'tesla-cam-last-folder';

/** Recursively read all files from a FileSystemDirectoryEntry */
async function readDirectoryFiles(entry: FileSystemDirectoryEntry): Promise<File[]> {
  const files: File[] = [];

  const readEntries = (dirReader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> =>
    new Promise((resolve, reject) => dirReader.readEntries(resolve, reject));

  const processEntry = async (e: FileSystemEntry): Promise<void> => {
    if (e.isFile) {
      const file = await new Promise<File>((resolve, reject) =>
        (e as FileSystemFileEntry).file(resolve, reject),
      );
      // Reconstruct webkitRelativePath from fullPath
      const relativePath = e.fullPath.replace(/^\//, '');
      Object.defineProperty(file, 'webkitRelativePath', { value: relativePath, writable: false });
      files.push(file);
    } else if (e.isDirectory) {
      const reader = (e as FileSystemDirectoryEntry).createReader();
      let entries: FileSystemEntry[];
      // readEntries may return partial results, keep reading until empty
      do {
        entries = await readEntries(reader);
        for (const child of entries) {
          await processEntry(child);
        }
      } while (entries.length > 0);
    }
  };

  await processEntry(entry);
  return files;
}

export function App() {
  const { t } = useI18n();
  const [clips, setClips] = useState<CamClip[]>([]);
  const [dragging, setDragging] = useState(false);
  const [lastFolder, setLastFolder] = useState<string | null>(() => {
    try { return localStorage.getItem(LAST_FOLDER_KEY); } catch { return null; }
  });
  const inputEl = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputEl.current) {
      inputEl.current.setAttribute('webkitdirectory', '');
      inputEl.current.setAttribute('directory', '');
    }
  }, []);

  const loadClips = useCallback(async (files: FileList | File[], folderName?: string) => {
    if (!files || (Array.isArray(files) ? files.length === 0 : files.length === 0)) return;

    const name = folderName
      || (Array.isArray(files) ? files[0]?.webkitRelativePath?.split('/')[0] : files[0]?.webkitRelativePath?.split('/')[0])
      || 'Unknown';

    const newClips = await genClips(files);
    if (newClips.length) {
      setClips(newClips);
      setLastFolder(name);
      try { localStorage.setItem(LAST_FOLDER_KEY, name); } catch {}
    } else {
      console.warn('No clips found');
    }
  }, []);

  // ── Drag & Drop ──
  const dragCountRef = useRef(0);

  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    dragCountRef.current++;
    if (dragCountRef.current === 1) setDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    dragCountRef.current--;
    if (dragCountRef.current === 0) setDragging(false);
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDrop = useCallback(async (e: DragEvent) => {
    e.preventDefault();
    dragCountRef.current = 0;
    setDragging(false);

    const items = e.dataTransfer?.items;
    if (!items || items.length === 0) return;

    // Try to get a directory entry
    for (let i = 0; i < items.length; i++) {
      const entry = items[i].webkitGetAsEntry?.();
      if (entry?.isDirectory) {
        const files = await readDirectoryFiles(entry as FileSystemDirectoryEntry);
        if (files.length > 0) {
          await loadClips(files, entry.name);
          return;
        }
      }
    }

    // Fallback: treat dropped files directly
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      await loadClips(files);
    }
  }, [loadClips]);

  useEffect(() => {
    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDrop);
    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDrop);
    };
  }, [handleDragEnter, handleDragLeave, handleDragOver, handleDrop]);

  return (
    <>
      <Home
        items={clips}
        lastFolder={lastFolder}
        onOpenFolder={() => inputEl.current?.click()}
      />

      {/* Hidden File Input */}
      <input
        className="hidden"
        style={{ display: 'none' }}
        ref={inputEl}
        type="file"
        multiple
        onChange={(event) => loadClips(event.target.files as FileList)}
      />

      {/* Drag overlay */}
      {dragging && (
        <div className="animate-fade-in fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="border-brand-primary flex flex-col items-center gap-4 rounded-2xl border-2 border-dashed p-16">
            <svg className="text-brand-primary h-16 w-16" fill="currentColor" viewBox="0 0 24 24">
              <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z"/>
            </svg>
            <span className="text-lg font-medium tracking-wider text-white">
              {t('drop.hint')}
            </span>
          </div>
        </div>
      )}
    </>
  );
}
