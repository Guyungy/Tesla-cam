/**
 * Generate the app's icon set from the Tesla mark, so the window, the favicon,
 * the installer and the export overlay all use the same glyph.
 *
 *   npx electron scripts/makeIcon.cjs
 *
 * Outputs:
 *   public/tesla-icon.png  256px, transparent — overlaid by the FFmpeg export
 *   build/icon.png         512px on the app's dark plate — electron-builder
 *   public/favicon.ico     multi-size ICO built from the same render
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 50"><path d="M40 2L10 2C9.445 2 9 2.449 9 3L9 47C9 47.551 9.445 48 10 48L40 48C40.555 48 41 47.551 41 47L41 3C41 2.449 40.555 2 40 2ZM23.137 10.094C24.375 10.063 25.625 10.063 26.867 10.094C30.074 10.176 33.285 10.515 36.309 11.539L35.633 12.531C33.074 11.633 30.035 11.199 26.828 11.105C25.617 11.066 24.383 11.066 23.172 11.105C19.965 11.199 16.93 11.633 14.367 12.531L13.695 11.539C16.719 10.515 19.926 10.176 23.137 10.094ZM17.086 37.078C17.02 37.359 16.793 37.594 16.484 37.715L15.547 37.715L15.492 37.738L15.492 40.27L14.906 40.27L14.906 37.738L14.859 37.715L13.922 37.715C13.613 37.594 13.387 37.359 13.32 37.078L13.32 37.074L17.086 37.074ZM21.34 40.266L19.113 40.266C18.801 40.141 18.57 39.906 18.508 39.625L21.941 39.625C21.879 39.906 21.652 40.141 21.34 40.266ZM21.34 38.965L19.113 38.965C18.801 38.844 18.57 38.605 18.508 38.328L21.941 38.328C21.879 38.605 21.652 38.844 21.34 38.965ZM21.34 37.727L19.113 37.727C18.801 37.602 18.57 37.367 18.508 37.086L21.941 37.086C21.879 37.367 21.652 37.602 21.34 37.727ZM26.867 40.27L23.617 40.27L23.629 40.246C23.691 39.965 23.918 39.75 24.223 39.625L26.289 39.625L26.289 38.965L23.617 38.965L23.617 37.078L26.852 37.078C26.785 37.359 26.559 37.609 26.25 37.703L24.191 37.703L24.191 38.336L26.867 38.336ZM31.16 40.246L28.523 40.238L28.523 37.078L29.102 37.074L29.098 39.617L31.668 39.617C31.605 39.883 31.449 40.113 31.16 40.246ZM28.453 13.633L25 32.164L21.547 13.633C19.699 13.633 17.781 13.918 17.73 15.277C16.863 15.059 15.281 14.074 14.918 13.383C17.555 12.316 21.902 12.176 23.789 12.246L25 13.8L26.211 12.246C28.098 12.176 32.449 12.316 35.086 13.383C34.719 14.074 33.137 15.059 32.266 15.277C32.219 13.918 30.297 13.633 28.453 13.633ZM36.602 40.258L36.027 40.258L36.027 38.969L33.934 38.969L33.934 40.258L33.355 40.258L33.355 38.32L36.602 38.324ZM36.086 37.711L33.859 37.711C33.547 37.586 33.305 37.363 33.246 37.082L36.68 37.082C36.617 37.363 36.398 37.586 36.086 37.711Z" fill="white"/></svg>`;

/** Bare mark on transparency — what the video overlay composites. */
function overlayHtml(size) {
  return `<body style="margin:0;background:transparent">
    <div style="width:${size}px;height:${size}px">${MARK.replace('<svg', `<svg width="${size}" height="${size}"`)}</div>
  </body>`;
}

/**
 * App icon: the mark on the product's dark plate. The bare mark is a white
 * card, which would disappear against a light desktop.
 */
function appIconHtml(size) {
  const inset = Math.round(size * 0.17);
  const markSize = size - inset * 2;
  return `<body style="margin:0;background:transparent">
    <div style="width:${size}px;height:${size}px;border-radius:${Math.round(size * 0.22)}px;
                background:linear-gradient(145deg,#1c1c1e 0%,#0a0a0a 100%);
                display:flex;align-items:center;justify-content:center;
                box-shadow:inset 0 0 0 ${Math.max(1, Math.round(size / 128))}px rgba(255,255,255,0.08)">
      <div style="width:${markSize}px;height:${markSize}px">${MARK.replace('<svg', `<svg width="${markSize}" height="${markSize}"`)}</div>
    </div>
  </body>`;
}

/** Wrap PNG frames in an ICO container (PNG-in-ICO, supported since Vista). */
function buildIco(frames) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(frames.length, 4);

  let offset = 6 + frames.length * 16;
  const entries = [];
  for (const { size, png } of frames) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2); // palette
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...frames.map((f) => f.png)]);
}

app.disableHardwareAcceleration();

const os = require('os');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teslacam-icon-'));

// One long-lived offscreen window, navigated per icon and captured by rect.
// Creating and destroying a window per render made every load after the first
// fail with ERR_FAILED.
const CANVAS = 512;
let sharedWin = null;

async function render(html, size) {
  if (!sharedWin) {
    sharedWin = new BrowserWindow({
      width: CANVAS,
      height: CANVAS,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      webPreferences: { offscreen: true },
    });
  }
  const file = path.join(tmpDir, `r${size}.html`);
  fs.writeFileSync(file, html, 'utf8');
  await sharedWin.loadFile(file);
  await new Promise((r) => setTimeout(r, 400));
  const image = await sharedWin.webContents.capturePage({
    x: 0,
    y: 0,
    width: size,
    height: size,
  });
  return image.toPNG();
}

app.whenReady().then(async () => {
  const write = (p, buf) => {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, buf);
    console.log(`  ${p} (${buf.length} bytes)`);
  };

  write(
    path.join(process.cwd(), 'public', 'tesla-icon.png'),
    await render(overlayHtml(256), 256),
  );
  write(
    path.join(process.cwd(), 'build', 'icon.png'),
    await render(appIconHtml(512), 512),
  );

  const frames = [];
  for (const size of [16, 32, 48, 64, 128, 256]) {
    frames.push({ size, png: await render(appIconHtml(size), size) });
  }
  write(path.join(process.cwd(), 'public', 'favicon.ico'), buildIco(frames));

  fs.rmSync(tmpDir, { recursive: true, force: true });
  app.quit();
});
