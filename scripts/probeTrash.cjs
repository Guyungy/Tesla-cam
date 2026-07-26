/**
 * Verify the Recycle Bin probe used by the delete flow, against real volumes.
 *   npx electron scripts/probeTrash.cjs [dir...]
 * Only ever creates and removes its own throwaway probe file.
 */
const { app, shell } = require('electron');
const fs = require('fs/promises');
const path = require('path');

async function recycleBinWorksFor(samplePath) {
  const probe = path.join(
    path.dirname(samplePath),
    `.teslacam-trash-probe-${process.pid}-${Date.now()}`,
  );
  try {
    await fs.writeFile(probe, '');
  } catch {
    return { ok: false, why: 'not writable' };
  }
  try {
    await shell.trashItem(probe);
    return { ok: true, why: 'trashItem succeeded' };
  } catch (e) {
    await fs.rm(probe, { force: true }).catch(() => {});
    return { ok: false, why: e.message };
  }
}

app.whenReady().then(async () => {
  const dirs = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  for (const dir of dirs) {
    const sample = path.join(dir, 'x.mp4');
    const r = await recycleBinWorksFor(sample);
    console.log(
      `${dir.padEnd(34)} recycleBin=${String(r.ok).padEnd(5)}  (${r.why})`,
    );
  }
  app.quit();
});
