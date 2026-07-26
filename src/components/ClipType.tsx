import { useI18n } from '../i18n';
import type { CamClip } from '../utils';

export function ClipType({ clip }: { clip: CamClip }) {
  const { t } = useI18n();

  if (clip.saveType === 'manual') {
    return (
      <div className="rounded bg-green-900/80 px-2 py-0.5 text-xs font-medium">
        {t('clipType.manual')}
      </div>
    );
  }
  if (clip.saveType === 'aeb') {
    return (
      <div className="rounded bg-rose-900/80 px-2 py-0.5 text-xs font-medium">
        {t('clipType.aeb')}
      </div>
    );
  }

  if (clip.type === 'recent') {
    return (
      <div className="rounded bg-blue-900/80 px-2 py-0.5 text-xs font-medium">
        {t('clipType.recent')}
      </div>
    );
  }
  if (clip.type === 'saved') {
    return (
      <div className="rounded bg-green-900/80 px-2 py-0.5 text-xs font-medium">
        {t('clipType.saved')}
      </div>
    );
  }
  if (clip.type === 'sentry') {
    return (
      <div className="rounded bg-red-900/80 px-2 py-0.5 text-xs font-medium">
        {t('clipType.sentry')}
      </div>
    );
  }

  return null;
}
