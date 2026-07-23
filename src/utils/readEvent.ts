import type { CamClip } from './types';

export function readEvent(file: File): Promise<CamClip['event']> {
  return new Promise((resolve) => {
    const reader = new FileReader();

    reader.onload = () => {
      const jsonStr = reader.result as string;
      try {
        const info = JSON.parse(jsonStr);
        resolve(info);
      } catch {
        resolve(undefined);
      }
    };

    reader.onerror = () => {
      resolve(undefined);
    };

    reader.readAsText(file);
  });
}
