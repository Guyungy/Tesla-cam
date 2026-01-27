import type { CamClip } from '../utils';

export function ClipType({ clip }: { clip: CamClip }) {
  if (clip.saveType === 'manual') {
    return <div className="bg-green-900 px-2 text-sm">手动</div>;
  }
  if (clip.saveType === 'aeb') {
    return <div className="bg-rose-900 px-2 text-sm">AEB</div>;
  }

  if (clip.type === 'recent') {
    return <div className="bg-blue-900 px-2 text-sm">最近</div>;
  }
  if (clip.type === 'saved') {
    return <div className="bg-green-900 px-2 text-sm">保存</div>;
  }
  if (clip.type === 'sentry') {
    return <div className="bg-red-900 px-2 text-sm">哨兵</div>;
  }
}
