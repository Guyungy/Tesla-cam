import dayjs from 'dayjs';

import {
  isCameraVideo,
  normalizedSourcePath,
  sourcePath,
} from './clipIdentity';
import { parseClipType, parseSaveType } from './parseFileType';
import { parseTime } from './parseTime';
import { readEvent } from './readEvent';
import type { CamClip } from './types';

/** Group by the complete source directory, never by its display basename. */
export async function genClips(files: FileList | File[]): Promise<CamClip[]> {
  const map = new Map<string, CamClip>();
  for (const file of files) {
    const video = isCameraVideo(file.name);
    if (!video && file.name !== 'thumb.png' && file.name !== 'event.json')
      continue;
    const paths = file.webkitRelativePath.split('/');
    const parentDir = paths.at(-2);
    if (!parentDir) continue;
    const filePath = sourcePath(file);
    const directory = filePath
      ? normalizedSourcePath(filePath).replace(/\/[^/]+$/, '')
      : paths.slice(0, -1).join('/');
    let clip = map.get(directory);
    if (!clip) {
      clip = {
        id: directory,
        name: parentDir,
        type:
          parentDir === 'RecentClips' ? 'recent' : parseClipType(paths.at(-3)),
        videos: [],
        sourceFiles: [],
        sourcePaths: [],
      };
      map.set(directory, clip);
    }
    clip.sourceFiles!.push(file);
    if (filePath) clip.sourcePaths!.push(filePath);
    if (video) clip.videos.push(file);
    else if (file.name === 'thumb.png') clip.thumb = file;
    else {
      clip.eventFile = file;
      clip.event = await readEvent(file);
      clip.saveType = parseSaveType(clip.event);
    }
  }
  const clips = [...map.values()].filter((clip) => clip.videos.length > 0);
  for (const clip of clips) {
    clip.videos.sort((a, b) => a.name.localeCompare(b.name));
    if (clip.type === 'recent') clip.name = clip.videos[0].name.slice(0, 19);
    clip.sourcePaths = [...new Set(clip.sourcePaths)];
  }
  clips.sort(
    (a, b) =>
      dayjs(parseTime(b.name)).valueOf() - dayjs(parseTime(a.name)).valueOf(),
  );
  return clips;
}
