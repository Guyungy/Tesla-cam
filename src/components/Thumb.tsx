import { useEffect, useState } from 'react';

type Props = {
  file?: File;
};

export function Thumb({ file }: Props) {
  const [src, setSrc] = useState<string>();

  useEffect(() => {
    if (file) {
      const url = URL.createObjectURL(file);
      setSrc(url);
      return () => URL.revokeObjectURL(url);
    } else {
      setSrc(undefined);
    }
  }, [file]);

  if (!src) {
    // Placeholder when no thumbnail
    return (
      <div className="flex h-full w-full items-center justify-center bg-neutral-800 text-neutral-600">
        <svg className="h-8 w-8" fill="currentColor" viewBox="0 0 24 24">
          <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
        </svg>
      </div>
    );
  }

  return (
    <img
      className="h-full w-full object-cover"
      src={src}
      alt=""
      loading="lazy"
    />
  );
}
