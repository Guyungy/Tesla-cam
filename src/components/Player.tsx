import clsx from 'clsx';
import { type RefObject, useCallback, useEffect, useRef } from 'react';

import type { CamName, PlayerState } from '../utils';

type Props = {
  videoRef: RefObject<HTMLVideoElement | null>;
  index?: number;
  unique?: CamName;
  url?: string;
  playing: boolean;
  playbackRate: number;
  full?: boolean;
  className?: string;
  label?: string;
  onChangeState?: (name: CamName, state: PlayerState) => void;
  onDoubleClick?: () => void;
};

export function Player({
  videoRef,
  index,
  unique,
  url,
  playing,
  playbackRate,
  full,
  className,
  label,
  onChangeState,
  onDoubleClick,
}: Props) {
  const state = useRef<PlayerState>({});
  const lastUpdateRef = useRef(0);

  const updateState = useCallback(
    (val: PlayerState) => {
      if (unique) {
        state.current = { ...state.current, ...val };
        onChangeState?.(unique, state.current);
      }
    },
    [onChangeState, unique],
  );

  useEffect(() => {
    updateState?.({
      index,
      ended: !url,
      currentTime: 0,
    });
  }, [index, updateState, url]);

  // Bumped whenever we pause or a new source loads, so a play() promise that
  // resolves late can tell it has been superseded.
  const playTokenRef = useRef(0);

  const syncPlaying = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.src || state.current.ended) return;

    if (!playing) {
      playTokenRef.current++;
      video.pause();
      return;
    }
    // play() flips `paused` synchronously, so this also collapses the repeated
    // calls coming from the loadstart / seeking / effect paths.
    if (!video.paused) return;

    const token = ++playTokenRef.current;
    void video.play().catch((error: unknown) => {
      // Switching segment or clip swaps all six sources at once, which aborts
      // every pending play(). That is expected — only surface a real failure.
      if (token !== playTokenRef.current) return;
      const name = (error as Error)?.name;
      if (name === 'AbortError' || name === 'NotAllowedError') return;
      console.warn('[Player] play() failed', error);
    });
  }, [playing, videoRef]);
  useEffect(syncPlaying, [syncPlaying]);

  // Release the previous source before the next one is attached. Six
  // 2896x1876 streams re-sourced while still decoding is what makes the
  // media stack thrash on segment changes.
  useEffect(() => {
    const video = videoRef.current;
    const playToken = playTokenRef;
    return () => {
      playToken.current++;
      if (video && !video.paused) video.pause();
    };
  }, [url, videoRef]);

  const syncPlaybackRate = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate, videoRef]);
  useEffect(syncPlaybackRate, [syncPlaybackRate]);

  // Throttled time update — max ~8 updates/sec instead of 15-60
  const handleTimeUpdate = useCallback(() => {
    const now = performance.now();
    if (now - lastUpdateRef.current < 120) return; // 120ms throttle
    lastUpdateRef.current = now;

    if (videoRef.current) {
      const { currentTime, duration } = videoRef.current;
      updateState({
        currentTime,
        ended: duration > 0 && duration - currentTime < 0.1,
      });
    }
  }, [videoRef, updateState]);

  return (
    <div
      className={clsx(
        'flex h-full w-full items-center justify-center overflow-hidden bg-black',
        full ? 'absolute top-0 left-0 z-10' : 'relative',
        className,
      )}
      onDoubleClick={onDoubleClick}
    >
      {url ? (
        <video
          ref={videoRef}
          src={url}
          muted
          onSeeking={syncPlaying}
          onLoadStart={() => {
            syncPlaying();
            syncPlaybackRate();
          }}
          onTimeUpdate={handleTimeUpdate}
          onEnded={() => updateState({ ended: true })}
          className="max-h-full max-w-full object-contain"
        />
      ) : (
        <div className="h-full w-full bg-black" />
      )}

      {label && (
        <div className="pointer-events-none absolute top-1.5 left-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium tracking-wider text-white/70 uppercase">
          {label}
        </div>
      )}
    </div>
  );
}
