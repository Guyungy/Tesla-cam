import { useEffect, useRef, useState } from 'react';

import { useI18n } from '../i18n';
import { type CamClip, genClips } from '../utils';

type Props = {
  onChange?: (clips: CamClip[]) => void;
};

export function Start({ onChange }: Props) {
  const { t } = useI18n();

  const [supported, setSupported] = useState(false);
  useEffect(() => {
    const input = document.createElement('input');
    const apiSupported =
      'webkitdirectory' in input ||
      'directory' in input ||
      'mozdirectory' in input ||
      'odirectory' in input;
    setSupported(apiSupported);
  }, []);

  const inputEl = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (supported) {
      inputEl.current?.setAttribute('webkitdirectory', '');
      inputEl.current?.setAttribute('directory', '');
      inputEl.current?.setAttribute('mozdirectory', '');
      inputEl.current?.setAttribute('odirectory', '');
    }
  }, [supported]);

  const [errMsg, setErrMsg] = useState('');
  const handleFiles = async (files: FileList | null) => {
    if (!files) return;
    const clips = await genClips(files);
    if (clips.length) {
      onChange?.(clips);
    } else {
      setErrMsg(t('start.noClips'));
    }
  };

  return (
    <div className="flex flex-col gap-8 p-10">
      <h2 className="text-2xl">{t('start.title')}</h2>

      {supported ? (
        <>
          <div>
            <p className="text-neutral-400">{t('start.selectHint')}</p>

            <input
              className="sr-only"
              ref={inputEl}
              type="file"
              multiple
              onChange={(event) => {
                setErrMsg('');
                handleFiles(event.target.files);
              }}
            />

            <button
              type="button"
              className="cursor-pointer underline"
              onClick={() => inputEl.current?.click()}
            >
              {t('start.selectFolder')}
            </button>

            <p className="text-cyan-400">{errMsg}</p>
          </div>

          <div className="text-sm text-neutral-400">
            <p>{t('start.localNote')}</p>
          </div>
        </>
      ) : (
        <p className="text-neutral-400">{t('start.notSupported')}</p>
      )}
    </div>
  );
}
