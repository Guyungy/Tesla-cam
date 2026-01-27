import {
  VscChromeClose,
  VscChromeMaximize,
  VscChromeMinimize,
} from 'react-icons/vsc';

export function TitleBar() {
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
      <div className="flex flex-1 items-center px-3 text-xs font-medium text-neutral-500 [-webkit-app-region:drag]">
        TeslaCam Viewer
      </div>

      {/* Window Controls (No Drag) */}
      <div className="flex h-full [-webkit-app-region:no-drag]">
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
    </div>
  );
}
