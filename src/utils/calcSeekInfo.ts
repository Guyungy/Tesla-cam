import type { CamFootage, SeekInfo } from './types';

/** 计算要跳转的片段与时间 */
export function calcSeekInfo(
  footage: CamFootage,
  seconds: number,
): SeekInfo | null {
  if (seconds <= 0) {
    return { index: 0, seconds: 0 };
  }

  const lastSegmentIndex = footage.segments.length - 1;
  if (seconds >= footage.duration) {
    return {
      index: lastSegmentIndex,
      seconds: footage.segments[lastSegmentIndex].duration,
    };
  }

  for (let i = lastSegmentIndex; i >= 0; i--) {
    const { startSeconds } = footage.segments[i];
    if (seconds >= startSeconds) {
      return {
        index: i,
        seconds: seconds - startSeconds,
      };
    }
  }

  return null;
}
