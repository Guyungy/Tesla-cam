import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'path';
import fsPromises from 'fs/promises';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

type ExportSession = {
  outputPath: string;
  frameCount: number;
  width: number;
  height: number;
  fps: number;
  canceled: boolean;
  process: ChildProcessWithoutNullStreams;
  completion: Promise<void>;
};

if (require('electron-squirrel-startup')) {
  app.quit();
}

app.commandLine.appendSwitch('remote-debugging-port', '9222');

function getFFmpegPath(): string {
  const ffmpegStatic = require('ffmpeg-static') as string;
  if (app.isPackaged && ffmpegStatic.includes('app.asar')) {
    return ffmpegStatic.replace('app.asar', 'app.asar.unpacked');
  }
  return ffmpegStatic;
}

// Track active export sessions
const exportSessions = new Map<string, ExportSession>();

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0a0a0a',
      symbolColor: '#ffffff',
      height: 30,
    },
    autoHideMenuBar: true,
    backgroundColor: '#0a0a0a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: true,
    },
  });

  const isDev = !app.isPackaged && process.env['ELECTRON_RENDERER_URL'];

  if (isDev) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] as string);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
};

app.on('ready', () => {
  createWindow();

  // ── Window Controls ──
  ipcMain.on('window-minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.on('window-maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.isMaximized() ? win.unmaximize() : win?.maximize();
  });

  ipcMain.on('window-close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  // ── File Save ──
  ipcMain.handle(
    'save-file',
    async (event, { name, buffer }: { name: string; buffer: ArrayBuffer }) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return null;

      const ext = path.extname(name).toLowerCase();
      let filters: Electron.FileFilter[];
      if (ext === '.csv') {
        filters = [{ name: 'CSV', extensions: ['csv'] }, { name: 'All', extensions: ['*'] }];
      } else if (ext === '.jpg' || ext === '.png') {
        filters = [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png'] }, { name: 'All', extensions: ['*'] }];
      } else {
        filters = [{ name: 'Videos', extensions: ['mp4'] }, { name: 'All', extensions: ['*'] }];
      }

      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        defaultPath: name,
        filters,
      });
      if (canceled || !filePath) return null;

      await fsPromises.writeFile(filePath, Buffer.from(buffer));
      return filePath;
    },
  );

  ipcMain.handle('show-item-in-folder', async (_event, filePath: string) => {
    shell.showItemInFolder(filePath);
  });

  ipcMain.handle(
    'trash-files',
    async (event, { paths, clipName }: { paths: string[]; clipName: string }) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return { ok: false, error: 'No window' };

      const uniquePaths = Array.from(new Set(paths.filter(Boolean)));
      if (uniquePaths.length === 0) {
        return { ok: false, error: 'No files to delete' };
      }

      const { response } = await dialog.showMessageBox(win, {
        type: 'warning',
        buttons: ['Delete', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        title: 'Delete clip?',
        message: `Move "${clipName}" to the Recycle Bin?`,
        detail: `This will remove ${uniquePaths.length} file(s) from the current clip. You can restore them from the Recycle Bin if needed.`,
      });

      if (response !== 0) {
        return { ok: false, canceled: true };
      }

      let trashedCount = 0;
      const errors: string[] = [];
      for (const filePath of uniquePaths) {
        try {
          await fsPromises.access(filePath);
          await shell.trashItem(filePath);
          trashedCount++;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          errors.push(`${filePath}: ${message}`);
          console.warn(`[Delete] Skipped ${filePath}:`, error);
        }
      }

      if (trashedCount > 0) {
        return { ok: true, trashedCount };
      }

      const { response: permanentDeleteResponse } = await dialog.showMessageBox(win, {
        type: 'warning',
        buttons: ['Delete Permanently', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        title: 'Recycle Bin unavailable',
        message: `Could not move "${clipName}" to the Recycle Bin.`,
        detail:
          'The files may still be locked, or this drive may not support the Recycle Bin.\n\n' +
          'Do you want to permanently delete the clip instead?',
      });

      if (permanentDeleteResponse !== 0) {
        return {
          ok: false,
          canceled: true,
          error: errors.at(0) || 'No files were moved to trash',
        };
      }

      let deletedCount = 0;
      for (const filePath of uniquePaths) {
        try {
          await fsPromises.rm(filePath, { recursive: true, force: true });
          deletedCount++;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          errors.push(`${filePath}: ${message}`);
          console.warn(`[Delete] Permanent delete failed for ${filePath}:`, error);
        }
      }

      if (deletedCount === 0) {
        return {
          ok: false,
          error: errors.at(0) || 'No files were deleted',
        };
      }

      return { ok: true, trashedCount: deletedCount };
    },
  );

  // ── FFmpeg Video Export (stream raw RGBA frames to FFmpeg) ──

  /**
   * Start export: show save dialog and spawn FFmpeg process that accepts raw RGBA frames on stdin.
   */
  ipcMain.handle(
    'export-start',
    async (event, { sessionId, fileName, width, height, fps }: {
      sessionId: string;
      fileName: string;
      width: number;
      height: number;
      fps: number;
    }) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return { ok: false, error: 'No window' };

      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        defaultPath: fileName,
        filters: [
          { name: 'MP4 Video', extensions: ['mp4'] },
          { name: 'All', extensions: ['*'] },
        ],
      });
      if (canceled || !filePath) return { ok: false, error: 'canceled' };

      // Ensure even dimensions for H.264
      const w = width % 2 === 0 ? width : width + 1;
      const h = height % 2 === 0 ? height : height + 1;
      const ffmpegPath = getFFmpegPath();
      const args = [
        '-y',
        '-f', 'rawvideo',
        '-pix_fmt', 'rgba',
        '-s:v', `${w}x${h}`,
        '-r', String(fps),
        '-i', 'pipe:0',
        '-an',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '18',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        '-threads', '0',
        filePath,
      ];

      console.log(`[Export] Spawning FFmpeg: ${ffmpegPath} ${args.join(' ')}`);
      const ffmpeg = spawn(ffmpegPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });

      const completion = new Promise<void>((resolve, reject) => {
        let stderr = '';
        ffmpeg.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString();
          if (stderr.length > 4000) {
            stderr = stderr.slice(-4000);
          }
        });

        ffmpeg.on('error', (error) => {
          reject(error);
        });

        ffmpeg.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(stderr || `FFmpeg exited with code ${code}`));
          }
        });
      });

      exportSessions.set(sessionId, {
        outputPath: filePath,
        frameCount: 0,
        width: w,
        height: h,
        fps,
        canceled: false,
        process: ffmpeg,
        completion,
      });

      console.log(`[Export] Session ${sessionId}: ${w}x${h} @ ${fps}fps → ${filePath}`);
      return { ok: true, filePath };
    },
  );

  /**
   * Write a single raw RGBA frame into FFmpeg stdin.
   */
  ipcMain.handle(
    'export-frame',
    async (_event, { sessionId, frameData }: { sessionId: string; frameData: Uint8Array }) => {
      const session = exportSessions.get(sessionId);
      if (!session || session.canceled) return { ok: false };

      const frameNum = session.frameCount;

      try {
        const chunk = Buffer.from(frameData);
        await new Promise<void>((resolve, reject) => {
          const stdin = session.process.stdin;
          if (stdin.destroyed || !stdin.writable) {
            reject(new Error('FFmpeg input is closed'));
            return;
          }

          const cleanup = () => {
            stdin.off('error', onError);
            stdin.off('drain', onDrain);
          };
          const onError = (error: Error) => {
            cleanup();
            reject(error);
          };
          const onDrain = () => {
            cleanup();
            resolve();
          };

          stdin.once('error', onError);
          const canContinue = stdin.write(chunk, (error) => {
            if (error) {
              cleanup();
              reject(error);
              return;
            }
            if (canContinue) {
              cleanup();
              resolve();
            }
          });

          if (!canContinue) {
            stdin.once('drain', onDrain);
          }
        });
        session.frameCount++;
        return { ok: true, frameNum };
      } catch (e: any) {
        console.error(`[Export] Failed to write frame ${frameNum}:`, e.message);
        return { ok: false, error: e.message };
      }
    },
  );

  /**
   * Finish: close FFmpeg stdin, wait for encoding to complete, then verify output.
   */
  ipcMain.handle(
    'export-finish',
    async (_event, { sessionId }: { sessionId: string }) => {
      const session = exportSessions.get(sessionId);
      if (!session) return { ok: false, error: 'No session found' };

      if (session.canceled) {
        await cleanupSession(sessionId);
        return { ok: false, error: 'Canceled' };
      }

      if (session.frameCount === 0) {
        await cleanupSession(sessionId);
        return { ok: false, error: 'No frames captured' };
      }

      try {
        console.log(`[Export] Finalizing ${session.frameCount} streamed frames with FFmpeg...`);
        session.process.stdin.end();
        await session.completion;

        // Verify output file exists and has content
        const stat = await fsPromises.stat(session.outputPath);
        console.log(`[Export] Output file: ${stat.size} bytes`);

        if (stat.size < 1000) {
          await cleanupSession(sessionId);
          return { ok: false, error: 'Output file too small', frameCount: session.frameCount };
        }

        await cleanupSession(sessionId);
        return { ok: true, filePath: session.outputPath, frameCount: session.frameCount };
      } catch (e: any) {
        console.error('[Export] FFmpeg encoding failed:', e.message);
        await cleanupSession(sessionId);
        return { ok: false, error: e.message, frameCount: session.frameCount };
      }
    },
  );

  /**
   * Cancel export.
   */
  ipcMain.on('export-cancel', async (_event, { sessionId }: { sessionId: string }) => {
    const session = exportSessions.get(sessionId);
    if (session) {
      session.canceled = true;
      await cleanupSession(sessionId);
    }
  });
});

/** Remove temp directory and session record */
async function cleanupSession(sessionId: string) {
  const session = exportSessions.get(sessionId);
  if (!session) return;
  exportSessions.delete(sessionId);
  try {
    if (!session.process.killed) {
      session.process.kill('SIGKILL');
    }
  } catch (e: any) {
    console.warn(`[Export] Cleanup failed:`, e.message);
  }
}

app.on('window-all-closed', () => {
  // Clean up all temp dirs
  for (const [id] of exportSessions) {
    cleanupSession(id);
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
