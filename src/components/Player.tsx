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
  onChangeState,
  onDoubleClick,
}: Props) {
  // 视频状态
  const state = useRef<PlayerState>({});

  const updateState = useCallback(
    (val: PlayerState) => {
      if (unique) {
        state.current = { ...state.current, ...val };
        onChangeState?.(unique, state.current);
      }
    },
    [onChangeState, unique],
  );

  // url 改变，更新状态
  useEffect(() => {
    updateState?.({
      index,
      ended: !url,
      currentTime: 0,
    });
  }, [index, updateState, url]);

  // 播放控制
  const syncPlaying = useCallback(() => {
    if (videoRef.current && videoRef.current.src && !state.current.ended) {
      if (playing) {
        videoRef.current.play();
      } else {
        videoRef.current.pause();
      }
    }
  }, [playing, videoRef]);
  useEffect(syncPlaying, [syncPlaying]);

  // 播放速度控制
  const syncPlaybackRate = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate, videoRef]);
  useEffect(syncPlaybackRate, [syncPlaybackRate]);

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
          onSeeking={() => {
            syncPlaying();
          }}
          onLoadStart={() => {
            syncPlaying();
            syncPlaybackRate();
          }}
          onTimeUpdate={() => {
            if (videoRef.current) {
              const { currentTime, duration } = videoRef.current;
              updateState({
                currentTime,
                ended: currentTime === duration,
              });
            }
          }}
          className="max-h-full max-w-full object-contain"
          // crossOrigin="anonymous" // Removed to prevent potential CORS issues with local files
        />
      ) : (
        <div className="h-full w-full bg-black"></div>
      )}
    </div>
  );
}

// ($.setSrc)
// (onEmptied)
// (onTimeUpdate 0)
// onLoadStart
// onDurationChange
// onLoadedMetadata
// onProgress
// onSuspend
// onLoadedData
// onCanPlay (onCanPlayThrough)
// onPlay
// onPlaying
// onTimeUpdate
// onPause
// onEnded
