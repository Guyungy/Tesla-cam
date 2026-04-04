import type { CamClipEvent } from './types';

export type MapProvider = 'google' | 'amap' | 'baidu';

/**
 * Auto-detect if coordinates are likely in China (rough bounding box).
 * If so, default to Amap; otherwise Google Maps.
 */
function detectProvider(lat: number, lon: number): MapProvider {
  // Rough China bounding box
  if (lat >= 18 && lat <= 54 && lon >= 73 && lon <= 135) {
    return 'amap';
  }
  return 'google';
}

/** Generate a map URL for the given event location */
export function genLocationUrl(event: CamClipEvent, provider?: MapProvider): string {
  const lat = parseFloat(event.est_lat);
  const lon = parseFloat(event.est_lon);

  if (isNaN(lat) || isNaN(lon)) return '';

  const resolvedProvider = provider ?? detectProvider(lat, lon);

  switch (resolvedProvider) {
    case 'google':
      return `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
    case 'amap':
      return `https://uri.amap.com/marker?position=${lon},${lat}&name=${encodeURIComponent('事件记录点')}&coordinate=gaode&callnative=0`;
    case 'baidu': {
      const params = new URLSearchParams();
      params.append('location', `${lat},${lon}`);
      params.append('coord_type', 'gcj02');
      params.append('title', '事件记录点位置');
      params.append('content', '仅供参考');
      params.append('output', 'html');
      params.append('src', 'webapp.baidu.openAPIdemo');
      return `https://api.map.baidu.com/marker?${params.toString()}`;
    }
  }
}

/** Generate all available map links for display */
export function genAllMapLinks(event: CamClipEvent): { label: string; url: string; provider: MapProvider }[] {
  const lat = parseFloat(event.est_lat);
  const lon = parseFloat(event.est_lon);
  if (isNaN(lat) || isNaN(lon)) return [];

  return [
    { label: 'Google Maps', url: genLocationUrl(event, 'google'), provider: 'google' },
    { label: '高德地图', url: genLocationUrl(event, 'amap'), provider: 'amap' },
  ];
}
