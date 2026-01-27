import dayjs from 'dayjs';

import { parseClipType, parseSaveType } from './parseFileType';
import { parseTime } from './parseTime';
import { readEvent } from './readEvent';
import type { CamClip } from './types';

const recentDirName = 'RecentClips';

export async function genClips(files: FileList): Promise<CamClip[]> {
  const map: Record<string, CamClip> = {};

  for (const file of files) {
    const paths = file.webkitRelativePath.split('/');
    const parentDir = paths.at(-2);
    if (!parentDir) {
      continue;
    }
    if (parentDir === recentDirName) {
      // 最近视频的文件夹 只有一层
      if (!map[recentDirName]) {
        // 创建
        map[recentDirName] = {
          name: recentDirName,
          type: 'recent',
          videos: [],
        };
      }
      // 识别文件
      if (file.name === 'thumb.png') {
        map[recentDirName].thumb = file;
      } else if (file.type === 'video/mp4') {
        map[recentDirName].videos.push(file);
      }
    } else {
      if (!map[parentDir]) {
        // 创建
        map[parentDir] = {
          name: parentDir,
          type: parseClipType(paths.at(-3)),
          videos: [],
        };
      }
      // 识别文件
      if (file.name === 'thumb.png') {
        map[parentDir].thumb = file;
      } else if (file.type === 'video/mp4') {
        map[parentDir].videos.push(file);
      } else if (file.name === 'event.json') {
        const eventInfo = await readEvent(file);
        map[parentDir].event = eventInfo;
        const saveType = parseSaveType(eventInfo);
        map[parentDir].saveType = saveType;
      }
    }
  }

  // 修改 Recent 的时间
  if (map['RecentClips']) {
    const time = map['RecentClips'].videos.at(0)?.name.slice(0, 19);
    if (time) {
      map['RecentClips'].name = time;
    }
  }

  // 过滤无视频的项目
  const clips = Object.values(map).filter((i) => i.videos.length > 0);
  // 按时间排序
  clips.sort(
    (a, b) =>
      dayjs(parseTime(b.name)).valueOf() - dayjs(parseTime(a.name)).valueOf(),
  );

  return clips;
}
