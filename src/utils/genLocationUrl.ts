import type { CamClipEvent } from './types';

export function genLocationUrl(event: CamClipEvent) {
  const params = new URLSearchParams();
  params.append('location', `${event.est_lat},${event.est_lon}`);
  params.append('coord_type', 'gcj02');
  params.append('title', '事件记录点位置');
  params.append('content', '仅供参考');
  params.append('output', 'html');
  params.append('src', 'webapp.baidu.openAPIdemo');

  const url = `http://api.map.baidu.com/marker?${params.toString()}`;

  return url;
}
