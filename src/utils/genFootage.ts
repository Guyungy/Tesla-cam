import dayjs from 'dayjs';

import { getVideoDuration } from './getVideoDuration';
import { parseTime } from './parseTime';
import type { CamFootage, CamName, CamSegment } from './types';

export async function genFootage(files: File[]): Promise<CamFootage> {
  // 文件地址，收集起来便于释放内存
  const urls: string[] = [];

  const map: Record<string, CamSegment> = {};

  for (const file of files) {
    const name = file.name.slice(0, 19);
    if (!map[name]) {
      // 创建
      map[name] = {
        name: name,
        duration: 0,
        startSeconds: 0,
      };
    }

    const restName = file.name.slice(20);
    // 识别摄像头位置
    let camName: CamName | undefined;
    if (restName.startsWith('front')) {
      camName = 'front';
    } else if (restName.startsWith('back')) {
      camName = 'back';
    } else if (restName.startsWith('left_repeater')) {
      camName = 'left';
    } else if (restName.startsWith('right_repeater')) {
      camName = 'right';
    }
    if (camName) {
      const fileURL = URL.createObjectURL(file);
      urls.push(fileURL);
      map[name][camName] = fileURL;
      const duration = await getVideoDuration(fileURL);
      if (!map[name].duration || duration > map[name].duration) {
        map[name].duration = duration;
      }
    }
  }

  const segments = Object.values(map);
  segments.sort(
    (a, b) =>
      dayjs(parseTime(a.name)).valueOf() - dayjs(parseTime(b.name)).valueOf(),
  );

  // 提前统计片段时长，方便进度跳转
  let duration = 0;
  segments.forEach((i) => {
    i.startSeconds = duration;
    duration += i.duration;
  });

  return {
    segments,
    duration,
    urls,
  };
}

export function revokeFootage(footage?: CamFootage) {
  footage?.urls.forEach((i) => {
    URL.revokeObjectURL(i);
  });
}
