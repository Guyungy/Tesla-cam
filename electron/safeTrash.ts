import fs from 'fs';
import path from 'path';

export type SourceSnapshot = {
  path: string;
  size: number;
  mtimeMs: number;
  ino: number;
  dev: number;
};
export type TrashResult = {
  ok: boolean;
  canceled?: boolean;
  error?: string;
  permanent: false;
  trashedCount: number;
  failedCount: number;
  removedPaths: string[];
  failedPaths: string[];
};

export function pathKey(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function allowedSourceName(name: string): boolean {
  return (
    name === 'event.json' ||
    name === 'thumb.png' ||
    /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-(front|back|left_repeater|right_repeater|left_pillar|right_pillar)\.mp4$/i.test(
      name,
    )
  );
}

/** Refuse directories, links/junctions at any level and unsupported sidecars. */
export function snapshotSource(value: unknown): SourceSnapshot {
  if (
    typeof value !== 'string' ||
    !path.isAbsolute(value) ||
    value.includes('\0')
  )
    throw new Error('Invalid source path');
  if (!allowedSourceName(path.basename(value)))
    throw new Error('Unsupported source file');
  const resolved = path.resolve(value);
  let component = resolved;
  while (true) {
    if (fs.lstatSync(component).isSymbolicLink())
      throw new Error('Symbolic links and junctions are not allowed');
    const parent = path.dirname(component);
    if (parent === component) break;
    component = parent;
  }
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile()) throw new Error('Only regular files can be recycled');
  const canonical = fs.realpathSync.native(resolved);
  if (pathKey(canonical) !== pathKey(resolved))
    throw new Error('Source path changed');
  return {
    path: resolved,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ino: stat.ino,
    dev: stat.dev,
  };
}

export function sameSource(a: SourceSnapshot, b: SourceSnapshot): boolean {
  return (
    pathKey(a.path) === pathKey(b.path) &&
    a.size === b.size &&
    a.mtimeMs === b.mtimeMs &&
    a.ino === b.ino &&
    a.dev === b.dev
  );
}

/** The registry is populated only from File objects resolved by the isolated preload. */
export function validateTrashManifest(
  paths: unknown,
  authorized: ReadonlyMap<string, SourceSnapshot>,
  inspect = snapshotSource,
): SourceSnapshot[] {
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > 10000)
    throw new Error('Invalid file list');
  const unique = new Map<string, SourceSnapshot>();
  for (const p of paths) {
    if (typeof p !== 'string' || !path.isAbsolute(p))
      throw new Error('Invalid source path');
    const key = pathKey(p);
    const approved = authorized.get(key);
    if (!approved)
      throw new Error(
        'File was not selected for this window; re-import the folder',
      );
    const current = inspect(p);
    if (!sameSource(approved, current))
      throw new Error('Source file changed; re-import the folder');
    unique.set(key, current);
  }
  const files = [...unique.values()];
  const directory = pathKey(path.dirname(files[0].path));
  if (files.some((f) => pathKey(path.dirname(f.path)) !== directory))
    throw new Error('A clip cannot delete files from multiple directories');
  if (!files.some((f) => /\.mp4$/i.test(f.path)))
    throw new Error('No recording in the deletion manifest');
  return files;
}

/** OS recycle only. Never fall back to permanent deletion; stop on first error. */
export async function recycleManifest(
  files: SourceSnapshot[],
  recycle: (file: string) => Promise<void>,
  inspect = snapshotSource,
): Promise<TrashResult> {
  const removedPaths: string[] = [];
  let error: string | undefined;
  for (const file of files) {
    try {
      if (!sameSource(file, inspect(file.path)))
        throw new Error('Source changed after confirmation');
      await recycle(file.path);
      removedPaths.push(file.path);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      break;
    }
  }
  const failedPaths = files.slice(removedPaths.length).map((f) => f.path);
  return {
    ok: removedPaths.length > 0,
    permanent: false,
    removedPaths,
    failedPaths,
    trashedCount: removedPaths.length,
    failedCount: failedPaths.length,
    error,
  };
}
