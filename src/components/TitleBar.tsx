import {
  VscChromeClose,
  VscChromeMaximize,
  VscChromeMinimize,
  VscGear,
} from 'react-icons/vsc';
import { useState } from 'react';
import { useI18n } from '../i18n';
import { Settings } from './Settings';
import { TslMark } from './TslMark';

export function TitleBar() {
  const { t } = useI18n();
  const [showSettings, setShowSettings] = useState(false);

  const handleMinimize = () => {
    window.electronAPI?.minimize();
  };

  const handleMaximize = () => {
    window.electronAPI?.maximize();
  };

  const handleClose = () => {
    window.electronAPI?.close();
  };

  if (!window.electronAPI) {
    return null; // Don't show in browser mode if API missing
  }

  return (
    <div className="z-50 flex h-8 shrink-0 items-center justify-between bg-black select-none">
      {/* Drag Region */}
      <div className="flex flex-1 items-center gap-2 px-3 text-xs font-medium text-neutral-500 [-webkit-app-region:drag]">
        <TslMark size="sm" />
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold tracking-[0.28em] text-white/85">TSL</span>
          <span className="text-neutral-500/80">{t('titleBar.title')}</span>
        </div>
      </div>

      {/* Window Controls (No Drag) */}
      <div className="flex h-full [-webkit-app-region:no-drag]">
        <button
          onClick={() => setShowSettings(true)}
          className="flex w-10 items-center justify-center text-neutral-400 hover:bg-neutral-800 hover:text-white focus:outline-none"
        >
          <VscGear size={16} />
        </button>
        <button
          onClick={handleMinimize}
          className="flex w-10 items-center justify-center text-neutral-400 hover:bg-neutral-800 hover:text-white focus:outline-none"
        >
          <VscChromeMinimize size={16} />
        </button>
        <button
          onClick={handleMaximize}
          className="flex w-10 items-center justify-center text-neutral-400 hover:bg-neutral-800 hover:text-white focus:outline-none"
        >
          <VscChromeMaximize size={16} />
        </button>
        <button
          onClick={handleClose}
          className="flex w-10 items-center justify-center text-neutral-400 transition-colors hover:bg-red-600 hover:text-white focus:outline-none"
        >
          <VscChromeClose size={16} />
        </button>
      </div>
      <Settings open={showSettings} onClose={() => setShowSettings(false)} />
    </div>
  );
}
