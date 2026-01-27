import dayjs from 'dayjs';

import { parseTime } from './parseTime';
import type { CamClip, CamFootage } from './types';

/** 计算事件时间 */
export function calcEventSeconds(clip: CamClip, footage: CamFootage) {
  if (!clip.event?.timestamp) {
    return;
  }

  if (clip.saveType === 'manual') {
    // 手动保存时间点在最后一秒，没必要标记
    return;
  }

  const eventTimeStr = parseTime(clip.event.timestamp);
  const eventTime = dayjs(eventTimeStr);

  let eventSeconds = 0;
  for (let i = footage.segments.length - 1; i >= 0; i--) {
    const segment = footage.segments[i];
    const segmentTimeStr = parseTime(segment.name);
    if (eventTime.isAfter(segmentTimeStr)) {
      const segmentSeconds = eventTime.diff(segmentTimeStr, 'second');
      eventSeconds = segment.startSeconds + segmentSeconds;
      break;
    }
  }

  // 标记点按情况提前一点
  if (clip.saveType === 'aeb') {
    eventSeconds -= 3;
  } else {
    eventSeconds -= 5;
  }

  if (eventSeconds > footage.duration) {
    return;
  }

  return eventSeconds;
}
