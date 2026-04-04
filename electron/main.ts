import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'path';
import fsPromises from 'fs/promises';
import os from 'os';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { execFile } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

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
const exportSessions = new Map<string, {
  tempDir: string;
  outputPath: string;
  frameCount: number;
  width: number;
  height: number;
  fps: number;
  canceled: boolean;
}>();

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

  // ── FFmpeg Video Export (temp-files approach) ──

  /**
   * Start export: show save dialog, create temp directory.
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

      // Create temp directory for frames
      const tempDir = path.join(os.tmpdir(), `teslacam-export-${sessionId}`);
      await fsPromises.mkdir(tempDir, { recursive: true });

      // Ensure even dimensions for H.264
      const w = width % 2 === 0 ? width : width + 1;
      const h = height % 2 === 0 ? height : height + 1;

      exportSessions.set(sessionId, {
        tempDir,
        outputPath: filePath,
        frameCount: 0,
        width: w,
        height: h,
        fps,
        canceled: false,
      });

      console.log(`[Export] Session ${sessionId}: ${w}x${h} @ ${fps}fps → ${filePath}`);
      return { ok: true, filePath };
    },
  );

  /**
   * Write a single frame as a JPEG file in the temp directory.
   * frameData is a Uint8Array (serialized from renderer).
   */
  ipcMain.handle(
    'export-frame',
    async (_event, { sessionId, frameData }: { sessionId: string; frameData: Uint8Array }) => {
      const session = exportSessions.get(sessionId);
      if (!session || session.canceled) return { ok: false };

      const frameNum = session.frameCount;
      // Zero-padded filename: frame_000001.jpg
      const frameName = `frame_${String(frameNum).padStart(6, '0')}.jpg`;
      const framePath = path.join(session.tempDir, frameName);

      try {
        await fsPromises.writeFile(framePath, Buffer.from(frameData));
        session.frameCount++;
        return { ok: true, frameNum };
      } catch (e: any) {
        console.error(`[Export] Failed to write frame ${frameNum}:`, e.message);
        return { ok: false, error: e.message };
      }
    },
  );

  /**
   * Finish: run FFmpeg to encode all frames into H.264 MP4, then clean up temp.
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
        const ffmpegPath = getFFmpegPath();
        console.log(`[Export] Encoding ${session.frameCount} frames with FFmpeg...`);
        console.log(`[Export] FFmpeg path: ${ffmpegPath}`);

        const inputPattern = path.join(session.tempDir, 'frame_%06d.jpg');

        const args = [
          '-y',                                     // Overwrite
          '-framerate', String(session.fps),         // Input FPS
          '-i', inputPattern,                        // Input pattern
          '-c:v', 'libx264',                         // H.264
          '-preset', 'medium',                       // Quality/speed balance
          '-crf', '18',                              // High quality
          '-pix_fmt', 'yuv420p',                     // Universal compatibility
          '-vf', `scale=${session.width}:${session.height}`, // Ensure dimensions
          '-movflags', '+faststart',                 // Web-optimized
          session.outputPath,
        ];

        console.log(`[Export] FFmpeg args:`, args.join(' '));

        await new Promise<void>((resolve, reject) => {
          execFile(ffmpegPath, args, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (stderr) console.log('[FFmpeg]', stderr.slice(-500));
            if (error) {
              console.error('[FFmpeg] Error:', error.message);
              reject(error);
            } else {
              resolve();
            }
          });
        });

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
    await fsPromises.rm(session.tempDir, { recursive: true, force: true });
    console.log(`[Export] Cleaned up temp dir: ${session.tempDir}`);
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
