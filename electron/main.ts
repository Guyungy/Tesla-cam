import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

if (require('electron-squirrel-startup')) {
  app.quit();
}

app.commandLine.appendSwitch('remote-debugging-port', '5174');

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    frame: false, // Frameless window
    titleBarStyle: 'hidden', // Hidden title bar
    titleBarOverlay: {
      color: '#0a0a0a',
      symbolColor: '#ffffff',
      height: 30,
    },
    autoHideMenuBar: true, // Hide default menu bar
    backgroundColor: '#0a0a0a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true, // For now, might be needed for file access, but contextIsolation is safer.
      contextIsolation: true, // Recommended
    },
  });

  // Check if we are in development mode
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

  // Window Controls IPC
  ipcMain.on('window-minimize', (event) => {
    const webContents = event.sender;
    const win = BrowserWindow.fromWebContents(webContents);
    win?.minimize();
  });

  ipcMain.on('window-maximize', (event) => {
    const webContents = event.sender;
    const win = BrowserWindow.fromWebContents(webContents);
    if (win?.isMaximized()) {
      win.unmaximize();
    } else {
      win?.maximize();
    }
  });

  ipcMain.on('window-close', (event) => {
    const webContents = event.sender;
    const win = BrowserWindow.fromWebContents(webContents);
    win?.close();
  });

  ipcMain.handle(
    'save-file',
    async (event, { name, buffer }: { name: string; buffer: ArrayBuffer }) => {
      const webContents = event.sender;
      const win = BrowserWindow.fromWebContents(webContents);
      if (!win) return null;

      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        defaultPath: name,
        filters: [
          { name: 'Videos', extensions: ['mp4', 'webm'] },
          { name: 'Images', extensions: ['jpg', 'png'] },
        ],
      });

      if (canceled || !filePath) return null;

      const fs = await import('fs/promises');
      await fs.writeFile(filePath, Buffer.from(buffer));
      return filePath;
    },
  );

  ipcMain.handle('show-item-in-folder', async (event, filePath: string) => {
    shell.showItemInFolder(filePath);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
