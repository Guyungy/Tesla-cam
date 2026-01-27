import { useEffect, useState } from 'react';

type Props = {
  file?: File;
};

export function Thumb({ file }: Props) {
  const [src, setSrc] = useState<string>();

  useEffect(() => {
    if (!file) {
      return;
    }

    const url = URL.createObjectURL(file);
    setSrc(url);

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [file]);

  return <img src={src} className="w-20" />;
}
