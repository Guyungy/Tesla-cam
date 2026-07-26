/**
 * Disk-backed `File` shim for running renderer code against a real TeslaCam
 * drive from Node.
 *
 * The production parsers (`probeMp4DurationFromFile`, `extractSEIFromFile`)
 * are deliberately written against `File.slice().arrayBuffer()` so they never
 * hold a whole MP4 in memory. Node's built-in `File` requires the bytes up
 * front, which would mean loading tens of GB, so this shim implements just the
 * Blob/File surface those parsers touch and reads lazily via `fs`.
 */
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
};

class LazyBlob {
  constructor(
    protected readonly filePath: string,
    protected readonly start: number,
    protected readonly end: number,
  ) {}

  get size(): number {
    return Math.max(0, this.end - this.start);
  }

  slice(begin = 0, finish: number = this.size): LazyBlob {
    const s = this.start + Math.max(0, begin);
    const e = Math.min(this.end, this.start + Math.max(0, finish));
    return new LazyBlob(this.filePath, s, Math.max(s, e));
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    const len = this.size;
    if (len <= 0) return new ArrayBuffer(0);
    const handle = await fsp.open(this.filePath, 'r');
    try {
      const buf = Buffer.allocUnsafe(len);
      let read = 0;
      while (read < len) {
        const { bytesRead } = await handle.read(
          buf,
          read,
          len - read,
          this.start + read,
        );
        if (bytesRead <= 0) break;
        read += bytesRead;
      }
      // Copy out so the returned buffer is exactly the bytes read.
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + read);
    } finally {
      await handle.close();
    }
  }

  async text(): Promise<string> {
    return Buffer.from(await this.arrayBuffer()).toString('utf8');
  }
}

export class DiskFile extends LazyBlob {
  readonly name: string;
  readonly type: string;
  readonly lastModified: number;
  readonly webkitRelativePath: string;
  /** Electron exposes the real disk path on dropped files; genClips uses it. */
  readonly path: string;

  constructor(filePath: string, relativePath: string, size: number, mtime = 0) {
    super(filePath, 0, size);
    this.name = path.basename(filePath);
    this.type = MIME[path.extname(filePath).toLowerCase()] ?? '';
    this.lastModified = mtime;
    this.webkitRelativePath = relativePath;
    this.path = filePath;
  }
}

/** Build a `DiskFile` for one path, with `webkitRelativePath` rooted at `root`'s name. */
export function diskFile(root: string, filePath: string): DiskFile {
  const stat = fs.statSync(filePath);
  const rel = path
    .join(path.basename(root), path.relative(root, filePath))
    .split(path.sep)
    .join('/');
  return new DiskFile(filePath, rel, stat.size, stat.mtimeMs);
}

/** Recursively list a TeslaCam folder as browser-style `File`s (directory picker order). */
export function listAsFiles(root: string, subdir?: string): File[] {
  const base = subdir ? path.join(root, subdir) : root;
  const out: DiskFile[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push(diskFile(root, full));
    }
  };
  walk(base);
  return out as unknown as File[];
}

/**
 * Install the browser globals the renderer utilities expect.
 * `FileReader` (used by readEvent) does not exist in Node; object URLs are
 * browser plumbing with no bearing on the logic under test.
 */
export function installBrowserShims(): void {
  const g = globalThis as Record<string, unknown>;
  if (typeof g['FileReader'] === 'undefined') {
    g['FileReader'] = class {
      result: string | ArrayBuffer | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsText(file: { text(): Promise<string> }) {
        file
          .text()
          .then((t) => {
            this.result = t;
            this.onload?.();
          })
          .catch(() => this.onerror?.());
      }
    };
  }
  let counter = 0;
  URL.createObjectURL = () => `blob:teslacam-test/${counter++}`;
  URL.revokeObjectURL = () => {};
}
