import {
  type ChildProcess,
  type ChildProcessWithoutNullStreams,
  spawn,
} from 'child_process';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import fs from 'fs';
import fsPromises from 'fs/promises';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

import { prepareComposeExport } from './composeExport.js';
import type {
  ComposeExportRequest,
  ComposeExportResult,
} from './composeTypes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

/** Extract a human-readable message from an unknown thrown value. */
function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

/**
 * Validate a compose request coming over IPC. The renderer is trusted code,
 * but with contextIsolation on we still refuse obviously bad input at the
 * process boundary: every source path must be an absolute path to an existing
 * .mp4 file, and numeric fields must be sane.
 */
function validateComposeRequest(req: ComposeExportRequest): string | null {
  if (!req || typeof req !== 'object') return 'Invalid request';
  if (
    typeof req.sessionId !== 'string' ||
    !/^[\w.-]{1,64}$/.test(req.sessionId)
  ) {
    return 'Invalid session id';
  }
  if (!Number.isFinite(req.durationSeconds) || req.durationSeconds <= 0) {
    return 'Invalid duration';
  }
  if (req.durationSeconds > 3600) return 'Export duration too long';
  if (!Number.isFinite(req.startSeconds) || req.startSeconds < 0) {
    return 'Invalid start time';
  }
  if (!Array.isArray(req.segments) || req.segments.length === 0) {
    return 'No segments';
  }
  for (const seg of req.segments) {
    if (!seg || typeof seg !== 'object' || !seg.paths) return 'Invalid segment';
    for (const p of Object.values(seg.paths)) {
      if (p === undefined) continue;
      if (typeof p !== 'string' || !path.isAbsolute(p))
        return 'Invalid source path';
      if (path.extname(p).toLowerCase() !== '.mp4')
        return 'Invalid source path';
      try {
        if (!fs.statSync(p).isFile()) return 'Source file not found';
      } catch {
        return 'Source file not found';
      }
    }
  }
  return null;
}

/**
 * Whether the Recycle Bin actually works at a given location.
 *
 * Removable / exFAT volumes — i.e. every real TeslaCam USB drive — have no
 * Recycle Bin, and `shell.trashItem` fails for every single file there. The
 * only way to know is to try it, so probe once with a throwaway file in the
 * same directory and let the confirmation dialog say what will really happen.
 */
async function recycleBinWorksFor(samplePath: string): Promise<boolean> {
  const probe = path.join(
    path.dirname(samplePath),
    `.teslacam-trash-probe-${process.pid}-${Date.now()}`,
  );
  try {
    await fsPromises.writeFile(probe, '');
  } catch {
    return false; // not writable — trashing cannot work either
  }
  try {
    await shell.trashItem(probe);
    return true;
  } catch {
    await fsPromises.rm(probe, { force: true }).catch(() => {});
    return false;
  }
}

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

type ComposeSession = {
  outputPath: string;
  canceled: boolean;
  process: ChildProcess;
  durationSeconds: number;
  fps: number;
};

if (require('electron-squirrel-startup')) {
  app.quit();
}

// ── File logging: mirror console output to userData/logs/main.log ──
// Keeps a diagnosable trail for packaged builds where stdout is invisible.
function setupFileLogging() {
  try {
    const logDir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, 'main.log');
    try {
      // Simple rotation: start fresh once the log passes 1MB
      if (fs.statSync(logFile).size > 1024 * 1024) fs.rmSync(logFile);
    } catch {
      /* no log yet */
    }
    const write = (level: string, args: unknown[]) => {
      try {
        const line = args
          .map((a) => (a instanceof Error ? (a.stack ?? a.message) : String(a)))
          .join(' ');
        fs.appendFileSync(
          logFile,
          `[${new Date().toISOString()}] [${level}] ${line}\n`,
        );
      } catch {
        /* disk full / permission — never crash on logging */
      }
    };
    for (const level of ['log', 'warn', 'error'] as const) {
      const original = console[level].bind(console);
      console[level] = (...args: unknown[]) => {
        original(...args);
        write(level, args);
      };
    }
  } catch {
    /* logging is best-effort */
  }
}
setupFileLogging();

// Remote debugging: always on in development; in packaged builds only when
// explicitly requested via env var (used by automated packaged-app checks).
if (!app.isPackaged) {
  app.commandLine.appendSwitch('remote-debugging-port', '9222');
} else if (/^\d{4,5}$/.test(process.env['TESLA_CAM_DEBUG_PORT'] ?? '')) {
  app.commandLine.appendSwitch(
    'remote-debugging-port',
    process.env['TESLA_CAM_DEBUG_PORT'] as string,
  );
}

/**
 * The Tesla mark the compose overlay draws in its info bar. Shipped in the
 * renderer bundle (`dist/`) so it exists in both dev and packaged builds;
 * returns undefined when missing so the export just omits the glyph.
 */
function resolveOverlayIcon(): string | undefined {
  let candidate = path.join(__dirname, '../dist/tesla-icon.png');
  // FFmpeg is a separate process and cannot read inside app.asar, while
  // fs.statSync can — so the archived path looks valid here and then fails at
  // encode time. The asset is unpacked (see build.asarUnpack) and resolved the
  // same way as the ffmpeg binary itself.
  if (candidate.includes('app.asar')) {
    candidate = candidate.replace('app.asar', 'app.asar.unpacked');
  }
  try {
    return fs.statSync(candidate).isFile() ? candidate : undefined;
  } catch {
    return undefined;
  }
}

/** Window/taskbar icon. Packaged Windows builds use the executable's icon. */
function resolveWindowIcon(): string | undefined {
  for (const candidate of [
    path.join(__dirname, '../dist/favicon.ico'),
    path.join(__dirname, '../build/icon.png'),
  ]) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      /* try the next one */
    }
  }
  return undefined;
}

function getFFmpegPath(): string {
  const ffmpegStatic = require('ffmpeg-static') as string;
  if (app.isPackaged && ffmpegStatic.includes('app.asar')) {
    return ffmpegStatic.replace('app.asar', 'app.asar.unpacked');
  }
  return ffmpegStatic;
}

// ── Hardware H.264 encoder detection (probed once, cached) ──
// A listed encoder is not necessarily usable (driver/GPU dependent), so each
// candidate is verified with a tiny real encode.
let hwEncoderPromise: Promise<string | null> | null = null;

function testEncoder(encoder: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn(
      getFFmpegPath(),
      [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'color=c=black:s=320x240:d=0.2:r=10',
        '-c:v',
        encoder,
        '-f',
        'null',
        '-',
      ],
      { stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true },
    );
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      resolve(false);
    }, 10000);
    proc.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}

/**
 * Frame rate of a source file, read from ffmpeg's stream line.
 *
 * Tesla footage is not 30 fps: current firmware records ~36 fps and older
 * clips ~24. Encoding either at a hardcoded 30 resamples every frame —
 * dropping ~1 frame in 6 from 36 fps footage, which matters when the export is
 * being used as evidence. Returns null when it cannot be determined.
 */
function detectSourceFps(filePath: string): Promise<number | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v: number | null) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    const proc = spawn(getFFmpegPath(), ['-hide_banner', '-i', filePath], {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });
    let err = '';
    proc.stderr?.on('data', (c: Buffer) => {
      err += c.toString();
      if (err.length > 8000) err = err.slice(-8000);
    });
    const timer = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {
        /* ignore */
      }
      finish(null);
    }, 8000);
    proc.on('error', () => {
      clearTimeout(timer);
      finish(null);
    });
    proc.on('close', () => {
      clearTimeout(timer);
      const m = err.match(/([\d.]+)\s*fps/);
      const v = m ? Number(m[1]) : NaN;
      finish(Number.isFinite(v) && v >= 1 && v <= 240 ? v : null);
    });
  });
}

function detectHwEncoder(): Promise<string | null> {
  if (!hwEncoderPromise) {
    hwEncoderPromise = (async () => {
      for (const encoder of ['h264_nvenc', 'h264_qsv', 'h264_amf']) {
        if (await testEncoder(encoder)) {
          console.log(`[ComposeExport] Hardware encoder available: ${encoder}`);
          return encoder;
        }
      }
      console.log('[ComposeExport] No hardware encoder — using libx264');
      return null;
    })();
  }
  return hwEncoderPromise;
}

// Track active export sessions
const exportSessions = new Map<string, ExportSession>();
const composeSessions = new Map<string, ComposeSession>();

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
    icon: resolveWindowIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // Security: renderer must not get Node integration.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false, // need webUtils.getPathForFile in preload
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
    if (!win) return;
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
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
        filters = [
          { name: 'CSV', extensions: ['csv'] },
          { name: 'All', extensions: ['*'] },
        ];
      } else if (ext === '.jpg' || ext === '.png') {
        filters = [
          { name: 'Images', extensions: ['jpg', 'jpeg', 'png'] },
          { name: 'All', extensions: ['*'] },
        ];
      } else {
        filters = [
          { name: 'Videos', extensions: ['mp4'] },
          { name: 'All', extensions: ['*'] },
        ];
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
    async (
      event,
      { paths, clipName }: { paths: string[]; clipName: string },
    ) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return { ok: false, error: 'No window' };

      const uniquePaths = Array.from(new Set(paths.filter(Boolean)));
      if (uniquePaths.length === 0) {
        return { ok: false, error: 'No files to delete' };
      }

      const recycleBin = await recycleBinWorksFor(uniquePaths[0]);
      const count = uniquePaths.length;

      // One dialog that states the real outcome. Asking "move to Recycle Bin?"
      // and only then revealing that permanent deletion is the sole option
      // turns the unrecoverable path into a default on removable drives.
      const { response } = await dialog.showMessageBox(win, {
        type: 'warning',
        buttons: [
          recycleBin ? 'Move to Recycle Bin' : 'Delete Permanently',
          'Cancel',
        ],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
        title: 'Delete clip?',
        message: recycleBin
          ? `Move "${clipName}" to the Recycle Bin?`
          : `Permanently delete "${clipName}"?`,
        detail: recycleBin
          ? `${count} file(s) will be moved to the Recycle Bin, and can be restored from there.`
          : `This drive has no Recycle Bin, so all ${count} file(s) will be erased immediately.\n\n` +
            'This cannot be undone.',
      });

      if (response !== 0) {
        return { ok: false, canceled: true };
      }

      let removed = 0;
      const errors: string[] = [];
      for (const filePath of uniquePaths) {
        try {
          if (recycleBin) {
            await fsPromises.access(filePath);
            await shell.trashItem(filePath);
          } else {
            await fsPromises.rm(filePath, { recursive: true, force: true });
          }
          removed++;
        } catch (error) {
          errors.push(`${path.basename(filePath)}: ${errMsg(error)}`);
          console.warn(`[Delete] Failed for ${filePath}:`, error);
        }
      }

      if (removed === 0) {
        return {
          ok: false,
          error: errors.at(0) || 'No files were deleted',
          failedCount: errors.length,
        };
      }

      // A partial delete still updates the sidebar, but must not be reported
      // as clean — leftover files would otherwise disappear silently.
      return {
        ok: true,
        trashedCount: removed,
        failedCount: errors.length,
        permanent: !recycleBin,
        error: errors.at(0),
      };
    },
  );

  // ── Fast compose export (source files → filter_complex → H.264) ──

  ipcMain.handle(
    'export-compose',
    async (event, req: ComposeExportRequest): Promise<ComposeExportResult> => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return { ok: false, error: 'No window' };

      const invalid = validateComposeRequest(req);
      if (invalid) return { ok: false, error: invalid };

      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        defaultPath: req.fileName,
        filters: [
          { name: 'MP4 Video', extensions: ['mp4'] },
          { name: 'All', extensions: ['*'] },
        ],
      });
      if (canceled || !filePath) return { ok: false, canceled: true };

      const ffmpegPath = getFFmpegPath();

      // Match the source frame rate unless the renderer pinned one.
      let effectiveReq = req;
      if (!(typeof req.fps === 'number' && req.fps > 0)) {
        const firstSource = req.segments
          .flatMap((seg) => Object.values(seg.paths))
          .find((p): p is string => !!p);
        const sourceFps = firstSource
          ? await detectSourceFps(firstSource)
          : null;
        effectiveReq = { ...req, fps: sourceFps ?? 30 };
        console.log(
          `[ComposeExport] source fps ${sourceFps ?? 'unknown'} → encoding at ${effectiveReq.fps}`,
        );
      }

      /** Run one encode attempt with the given encoder. */
      const runAttempt = async (
        encoder: string,
      ): Promise<ComposeExportResult> => {
        let prepared;
        try {
          prepared = prepareComposeExport(effectiveReq, filePath, {
            encoder,
            iconPath: resolveOverlayIcon(),
          });
        } catch (e) {
          return { ok: false, error: errMsg(e) || 'Failed to prepare export' };
        }

        console.log(
          `[ComposeExport] (${encoder}) ${ffmpegPath} ${prepared.args.join(' ')}`,
        );

        const ffmpeg = spawn(ffmpegPath, prepared.args, {
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        });

        let stderr = '';
        ffmpeg.stderr?.on('data', (chunk: Buffer) => {
          stderr += chunk.toString();
          if (stderr.length > 8000) stderr = stderr.slice(-8000);
        });

        // Parse -progress pipe:1 for out_time_ms (misleadingly named: microseconds)
        let lastOutMs = 0;
        ffmpeg.stdout?.on('data', (chunk: Buffer) => {
          const text = chunk.toString();
          for (const line of text.split(/\r?\n/)) {
            if (line.startsWith('out_time_ms=')) {
              const ms = Number(line.slice('out_time_ms='.length));
              if (Number.isFinite(ms)) lastOutMs = ms;
            }
          }
          const pct = Math.min(
            99,
            (lastOutMs / 1e6 / Math.max(req.durationSeconds, 0.001)) * 100,
          );
          if (!event.sender.isDestroyed()) {
            event.sender.send('export-compose-progress', {
              sessionId: req.sessionId,
              progress: pct,
              outTimeSec: lastOutMs / 1e6,
            });
          }
        });

        composeSessions.set(req.sessionId, {
          outputPath: filePath,
          canceled: false,
          process: ffmpeg,
          durationSeconds: req.durationSeconds,
          fps: prepared.fps,
        });

        try {
          const code = await new Promise<number | null>((resolve, reject) => {
            ffmpeg.on('error', reject);
            ffmpeg.on('close', (c) => resolve(c));
          });

          const session = composeSessions.get(req.sessionId);
          composeSessions.delete(req.sessionId);

          if (session?.canceled) {
            try {
              await fsPromises.rm(filePath, { force: true });
            } catch {
              /* ignore */
            }
            return { ok: false, canceled: true };
          }

          if (code !== 0) {
            return {
              ok: false,
              error: stderr || `FFmpeg exited with code ${code}`,
            };
          }

          const stat = await fsPromises.stat(filePath);
          if (stat.size < 1000) {
            return { ok: false, error: 'Output file too small' };
          }

          return {
            ok: true,
            filePath,
            width: prepared.width,
            height: prepared.height,
            fps: prepared.fps,
            encoder: prepared.encoder,
          };
        } catch (e) {
          composeSessions.delete(req.sessionId);
          return { ok: false, error: errMsg(e) };
        } finally {
          if (prepared.tmpDir) {
            try {
              await fsPromises.rm(prepared.tmpDir, {
                recursive: true,
                force: true,
              });
            } catch {
              /* ignore */
            }
          }
        }
      };

      const hwEncoder =
        req.useHardware !== false ? await detectHwEncoder() : null;

      let result = await runAttempt(hwEncoder ?? 'libx264');

      // The tiny probe can pass while a full-resolution encode fails
      // (driver/GPU limits) — retry once on software before reporting failure.
      if (!result.ok && !result.canceled && hwEncoder) {
        console.warn(
          `[ComposeExport] ${hwEncoder} failed, retrying with libx264:`,
          result.error?.slice(-300),
        );
        result = await runAttempt('libx264');
      }

      return result;
    },
  );

  ipcMain.on(
    'export-compose-cancel',
    (_event, { sessionId }: { sessionId: string }) => {
      const session = composeSessions.get(sessionId);
      if (!session) return;
      session.canceled = true;
      try {
        if (!session.process.killed) session.process.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    },
  );

  // ── Legacy FFmpeg Video Export (stream raw RGBA frames) ──

  ipcMain.handle(
    'export-start',
    async (
      event,
      {
        sessionId,
        fileName,
        width,
        height,
        fps,
      }: {
        sessionId: string;
        fileName: string;
        width: number;
        height: number;
        fps: number;
      },
    ) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return { ok: false, error: 'No window' };

      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        defaultPath: fileName,
        filters: [
          { name: 'MP4 Video', extensions: ['mp4'] },
          { name: 'All', extensions: ['*'] },
        ],
      });
      if (canceled || !filePath) return { ok: false, canceled: true };

      // Ensure even dimensions for H.264
      const w = width % 2 === 0 ? width : width + 1;
      const h = height % 2 === 0 ? height : height + 1;
      const ffmpegPath = getFFmpegPath();
      const args = [
        '-y',
        '-f',
        'rawvideo',
        '-pix_fmt',
        'rgba',
        '-s:v',
        `${w}x${h}`,
        '-r',
        String(fps),
        '-i',
        'pipe:0',
        '-an',
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '18',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        '-threads',
        '0',
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

      console.log(
        `[Export] Session ${sessionId}: ${w}x${h} @ ${fps}fps → ${filePath}`,
      );
      return { ok: true, filePath };
    },
  );

  ipcMain.handle(
    'export-frame',
    async (
      _event,
      { sessionId, frameData }: { sessionId: string; frameData: Uint8Array },
    ) => {
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
      } catch (e) {
        console.error(`[Export] Failed to write frame ${frameNum}:`, errMsg(e));
        return { ok: false, error: errMsg(e) };
      }
    },
  );

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
        console.log(
          `[Export] Finalizing ${session.frameCount} streamed frames with FFmpeg...`,
        );
        session.process.stdin.end();
        await session.completion;

        const stat = await fsPromises.stat(session.outputPath);
        console.log(`[Export] Output file: ${stat.size} bytes`);

        if (stat.size < 1000) {
          await cleanupSession(sessionId);
          return {
            ok: false,
            error: 'Output file too small',
            frameCount: session.frameCount,
          };
        }

        await cleanupSession(sessionId);
        return {
          ok: true,
          filePath: session.outputPath,
          frameCount: session.frameCount,
        };
      } catch (e) {
        console.error('[Export] FFmpeg encoding failed:', errMsg(e));
        await cleanupSession(sessionId);
        return { ok: false, error: errMsg(e), frameCount: session.frameCount };
      }
    },
  );

  ipcMain.on(
    'export-cancel',
    async (_event, { sessionId }: { sessionId: string }) => {
      const session = exportSessions.get(sessionId);
      if (session) {
        session.canceled = true;
        await cleanupSession(sessionId);
      }
    },
  );
});

async function cleanupSession(sessionId: string) {
  const session = exportSessions.get(sessionId);
  if (!session) return;
  exportSessions.delete(sessionId);
  try {
    if (!session.process.killed) {
      session.process.kill('SIGKILL');
    }
  } catch (e) {
    console.warn(`[Export] Cleanup failed:`, errMsg(e));
  }
}

app.on('window-all-closed', () => {
  for (const [id] of exportSessions) {
    cleanupSession(id);
  }
  for (const [id, session] of composeSessions) {
    session.canceled = true;
    try {
      if (!session.process.killed) session.process.kill('SIGKILL');
    } catch {
      /* ignore */
    }
    composeSessions.delete(id);
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
