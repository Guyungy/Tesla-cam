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

type Props = {
  items: CamClip[];
  onOpenFolder: () => void;
};

export function Home({ items, onOpenFolder }: Props) {
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
        {/* Sidebar with Glass Effect */}
        <Sidebar
          items={items}
          activeClip={clip}
          onSelect={loadClip}
          onOpenFolder={onOpenFolder}
        />

        {/* Main Content Area */}
        <div className="from-surface-base relative flex flex-1 flex-col overflow-hidden bg-gradient-to-br to-[#111]">
          {/* Top Gradient Overlay */}
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-24 bg-gradient-to-b from-black/50 to-transparent" />

          {clip ? (
            footage ? (
              <div className="flex h-full min-h-0 w-full flex-col">
                <div className="animate-fade-in flex min-h-0 flex-1 flex-col justify-center p-4 delay-100">
                  <Viewer key={clip.name} clip={clip} footage={footage} />
                </div>
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center">
                <div className="flex animate-pulse flex-col items-center gap-4">
                  <div className="border-brand-primary h-12 w-12 animate-spin rounded-full border-2 border-t-transparent" />
                  <span className="text-sm font-medium tracking-wider text-neutral-400">
                    LOADING FOOTAGE
                  </span>
                </div>
              </div>
            )
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 text-neutral-600 select-none">
              <div className="text-6xl text-neutral-800">
                <svg
                  className="h-24 w-24"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z" />
                </svg>
              </div>
              <div className="text-lg font-light tracking-widest uppercase opacity-50">
                Select a Clip to Begin
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
