import type { CamClip } from './types';

/** Filename allowlist shared conceptually with the privileged deletion boundary. */
export function isCameraVideo(name: string): boolean {
  return /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-(front|back|left_repeater|right_repeater|left_pillar|right_pillar)\.mp4$/i.test(
    name,
  );
}

export function sourcePath(file: File): string | undefined {
  try {
    const api = typeof window === 'undefined' ? undefined : window.electronAPI;
    // In Electron this also authorizes the actual File in the isolated preload.
    return (
      api?.getPathForFile(file) ||
      (file as File & { path?: string }).path ||
      undefined
    );
  } catch {
    return undefined;
  }
}

export function normalizedSourcePath(value: string): string {
  const normalized = value.replace(/\\/g, '/');
  return /^[a-z]:\//i.test(normalized) ? normalized.toLowerCase() : normalized;
}

export function clipIdentity(
  clip: Pick<CamClip, 'id' | 'name' | 'videos'>,
): string {
  return (
    clip.id ||
    `${clip.name}|${clip.videos
      .map(
        (f) =>
          `${sourcePath(f) || f.webkitRelativePath || f.name}:${f.size}:${f.lastModified}`,
      )
      .sort()
      .join('|')}`
  );
}

/** Reconcile only acknowledged removals; failures must remain visible. */
export function reconcileDeletedClip(
  clip: CamClip,
  removedPaths: string[],
): CamClip | undefined {
  const removed = new Set(removedPaths.map(normalizedSourcePath));
  const remains = (file: File) => {
    const p = sourcePath(file);
    return !p || !removed.has(normalizedSourcePath(p));
  };
  const videos = clip.videos.filter(remains);
  if (videos.length === 0) return undefined;
  const hasEvent = !clip.eventFile || remains(clip.eventFile);
  return {
    ...clip,
    videos,
    sourceFiles: clip.sourceFiles?.filter(remains),
    sourcePaths: clip.sourcePaths?.filter(
      (p) => !removed.has(normalizedSourcePath(p)),
    ),
    thumb: clip.thumb && remains(clip.thumb) ? clip.thumb : undefined,
    event: hasEvent ? clip.event : undefined,
    eventFile: hasEvent ? clip.eventFile : undefined,
    saveType: hasEvent ? clip.saveType : undefined,
  };
}
