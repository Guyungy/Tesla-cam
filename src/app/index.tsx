import { useEffect, useRef, useState } from 'react';

import { type CamClip, genClips } from '../utils';
import { Home } from './Home';

export function App() {
  const [clips, setClips] = useState<CamClip[]>([]);
  const inputEl = useRef<HTMLInputElement>(null);

  // Use webkitdirectory logic from Start.tsx
  useEffect(() => {
    if (inputEl.current) {
      inputEl.current.setAttribute('webkitdirectory', '');
      inputEl.current.setAttribute('directory', '');
    }
  }, []);

  const handleFiles = async (files: FileList | null) => {
    if (!files) return;
    const newClips = await genClips(files);
    console.log('genClips', newClips);
    if (newClips.length) {
      setClips(newClips);
    } else {
      // Could show a toast/alert here if needed
      console.warn('No clips found');
    }
  };

  return (
    <>
      <Home items={clips} onOpenFolder={() => inputEl.current?.click()} />

      {/* Hidden File Input */}
      <input
        className="hidden"
        style={{ display: 'none' }}
        ref={inputEl}
        type="file"
        multiple
        onChange={(event) => handleFiles(event.target.files)}
      />
    </>
  );
}
