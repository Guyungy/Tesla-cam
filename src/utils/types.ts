export type ClipType = 'recent' | 'saved' | 'sentry';

export type CamClip = {
  name: string;
  type?: ClipType;
  saveType?: 'aeb' | 'manual';
  thumb?: File;
  event?: CamClipEvent;
  videos: File[];
};

export type CamClipEvent = {
  timestamp: string;
  city: string;
  street?: string;
  est_lat: string;
  est_lon: string;
  reason: string;
  camera: string;
};

export type CamName = 'front' | 'back' | 'left' | 'right';
export type ViewType = CamName | 'grid';

export type CamFootage = {
  segments: CamSegment[];
  duration: number;
  urls: string[];
};

export type CamSegment = {
  name: string;
  duration: number;
  startSeconds: number; // 方便进度相关计算
} & {
  [T in CamName]?: string;
};

export type PlayerState = {
  index?: number;
  currentTime?: number;
  ended?: boolean;
};

export type SeekInfo = {
  index: number;
  seconds: number;
};
