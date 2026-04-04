import { useState } from 'react';

import { Sidebar } from '../components/Sidebar';
import { Viewer } from '../components';
import { TitleBar } from '../components/TitleBar';
import {
  type CamClip,
  type CamFootage,
  genFootage,
  revokeFootage,
} from '../utils';
import { useI18n } from '../i18n';

type Props = {
  items: CamClip[];
  lastFolder?: string | null;
  onOpenFolder: () => void;
};

export function Home({ items, lastFolder, onOpenFolder }: Props) {
  const { t } = useI18n();
  const [clip, setClip] = useState<CamClip>();
  const [footage, setFootage] = useState<CamFootage>();

  const loadClip = async (item: CamClip) => {
    if (item === clip) {
      return;
    }
    setClip(item);
    revokeFootage(footage);
    setFootage(undefined);
    const res = await genFootage(item.videos);
    console.log('genFootage', res);
    setFootage(res);
  };

  return (
    <div className="bg-surface-base flex h-screen w-screen flex-col overflow-hidden text-gray-200">
      <TitleBar />
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <Sidebar
          items={items}
          activeClip={clip}
          onSelect={loadClip}
          onOpenFolder={onOpenFolder}
        />

        {/* Main Content Area */}
        <div className="from-surface-base relative flex flex-1 flex-col overflow-hidden bg-gradient-to-br to-[#111]">
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-24 bg-gradient-to-b from-black/50 to-transparent" />

          {clip ? (
            footage ? (
              <div className="flex h-full min-h-0 w-full flex-col">
                <div className="animate-fade-in flex min-h-0 flex-1 flex-col justify-center p-4 delay-100">
                  <Viewer key={clip.name} clip={clip} footage={footage} onFootageUpdate={setFootage} />
                </div>
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center">
                <div className="flex animate-pulse flex-col items-center gap-4">
                  <div className="border-brand-primary h-12 w-12 animate-spin rounded-full border-2 border-t-transparent" />
                  <span className="text-sm font-medium tracking-wider text-neutral-400">
                    {t('home.loading')}
                  </span>
                </div>
              </div>
            )
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-6 text-neutral-600 select-none">
              <svg className="h-24 w-24 text-neutral-800" fill="currentColor" viewBox="0 0 24 24">
                <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
              </svg>
              <div className="text-lg font-light tracking-widest uppercase opacity-50">
                {t('home.selectClip')}
              </div>
              {lastFolder && items.length === 0 && (
                <button
                  onClick={onOpenFolder}
                  className="mt-2 flex flex-col items-center gap-1 rounded-lg border border-white/10 px-6 py-3 text-neutral-500 transition-colors hover:border-white/20 hover:text-neutral-300"
                >
                  <span className="text-xs uppercase tracking-wider">{t('sidebar.selectFolder')}</span>
                  <span className="text-[10px] text-neutral-600">{lastFolder}</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
