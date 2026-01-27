import dayjs from 'dayjs';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IoPause, IoPlay } from 'react-icons/io5';
import { MdReplay } from 'react-icons/md';
import { RiForward15Fill, RiReplay15Fill } from 'react-icons/ri';
import clsx from 'clsx'; // Import clsx

import {
  calcEventSeconds,
  calcSeekInfo,
  type CamClip,
  type CamFootage,
  type CamName,
  genLocationUrl,
  parseTime,
  type PlayerState,
  type SeekInfo,
  type ViewType,
} from '../utils';
import { IconBtn } from './IconBtn';
import { Player } from './Player';
import { Progress } from './Progress';
import { Rate } from './Rate';
import { ExportModal } from './ExportModal';
import { Toast } from './Toast';

type Props = {
  clip: CamClip;
  footage: CamFootage;
};

const MAX_EXPORT_SECONDS = 60;

export function Viewer({ clip, footage }: Props) {
  const backPreviewRef = useRef<HTMLVideoElement>(null);
  const frontPreviewRef = useRef<HTMLVideoElement>(null);
  const leftPreviewRef = useRef<HTMLVideoElement>(null);
  const rightPreviewRef = useRef<HTMLVideoElement>(null);
  const players = useMemo(
    () => [backPreviewRef, frontPreviewRef, leftPreviewRef, rightPreviewRef],
    [],
  );

  // Playing State
  const [statesMap, setStateMap] = useState<Record<CamName, PlayerState>>({
    back: {},
    front: {},
    left: {},
    right: {},
  });
  const handleChangeState = useCallback((key: CamName, val: PlayerState) => {
    setStateMap((s) => ({ ...s, [key]: val }));
  }, []);
  const states = useMemo(() => Object.values(statesMap), [statesMap]);

  // Segment Control
  const [segmentIndex, setSegmentIndex] = useState(0);
  const segment = footage.segments[segmentIndex];
  const isLastSegment = segmentIndex === footage.segments.length - 1;
  const isSegmentsEnded = states.every(
    (i) => i.index === segmentIndex && i.ended,
  );

  useEffect(() => {
    if (isSegmentsEnded && !isLastSegment) {
      setSegmentIndex((i) => i + 1);
    }
  }, [isLastSegment, isSegmentsEnded]);

  // Playback Info
  const segmentPlayedSeconds = Math.max(
    0,
    ...states
      .filter((i) => i.index === segmentIndex)
      .map((i) => i.currentTime || 0),
  );
  const formatTime = dayjs(parseTime(segment.name))
    .add(segmentPlayedSeconds, 'second')
    .format('YYYY年MM月DD日 ddd HH:mm:ss');

  const locationText = useMemo(() => {
    if (!clip.event) {
      return '无位置信息';
    }
    const { city, street, est_lat, est_lon } = clip.event;
    const locationName = [city, street].filter(Boolean).join(' ');
    // Keep coordinates separate for clean layout if needed, but combining for now
    const coord = [est_lat, est_lon].filter(Boolean).join(', ');

    if (locationName && coord) return `${locationName}（${coord}）`;
    return locationName || coord || '无位置信息';
  }, [clip.event]);

  const clipPlayedSeconds = segment.startSeconds + segmentPlayedSeconds;
  const eventSeconds = calcEventSeconds(clip, footage);
  const overlayRef = useRef({ time: formatTime, location: locationText });
  useEffect(() => {
    overlayRef.current = { time: formatTime, location: locationText };
  }, [formatTime, locationText]);

  // Controls
  const [playing, setPlaying] = useState(true);
  const [playbackRate, setPlaybackRate] = useState(1);
  const isClipEnded = isSegmentsEnded && isLastSegment;

  const replay = () => {
    setSegmentIndex(0);
    setPlaying(true);
  };
  const seek = useCallback(
    (seconds: number) => {
      const res = calcSeekInfo(footage, seconds);
      if (res) {
        setSegmentIndex(res.index);
        setSeekTask(res);
      }
    },
    [footage],
  );

  const jump = useCallback(
    (seconds: number) => {
      if (isClipEnded && seconds > 0) return;
      seek(clipPlayedSeconds + seconds);
    },
    [isClipEnded, clipPlayedSeconds, seek],
  );

  const handleKeyboardControl = useCallback(
    (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return;

      if (event.code === 'Space') {
        event.preventDefault();
        setPlaying((p) => !p);
        return;
      }
      if (event.code === 'ArrowLeft') {
        event.preventDefault();
        jump(-5);
        return;
      }
      if (event.code === 'ArrowRight') {
        event.preventDefault();
        jump(5);
      }
    },
    [jump],
  );
  useEffect(() => {
    window.addEventListener('keydown', handleKeyboardControl);
    return () => window.removeEventListener('keydown', handleKeyboardControl);
  }, [handleKeyboardControl]);

  const [seekTask, setSeekTask] = useState<SeekInfo>();
  useEffect(() => {
    if (!seekTask) return;
    players.forEach((i) => {
      if (i.current) i.current.currentTime = seekTask.seconds;
    });
    setSeekTask(undefined);
  }, [players, seekTask, states]);

  const [viewType, setviewType] = useState<ViewType>('grid');

  // Export Logic
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportIn, setExportIn] = useState<number>();
  const [exportOut, setExportOut] = useState<number>();

  const isCancelingRef = useRef(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // ... (keep selection logic same) ...
  const exportSelectionSeconds = useMemo(() => {
    if (exportIn === undefined || exportOut === undefined) return 0;
    if (exportOut <= exportIn) return 0;
    return Math.min(exportOut - exportIn, footage.duration);
  }, [exportIn, exportOut, footage.duration]);

  const markExportIn = useCallback(() => {
    setExportIn(Math.min(clipPlayedSeconds, footage.duration));
  }, [clipPlayedSeconds, footage.duration]);

  const markExportOut = useCallback(() => {
    setExportOut(Math.min(clipPlayedSeconds, footage.duration));
  }, [clipPlayedSeconds, footage.duration]);

  const formatExportPoint = useCallback(
    (seconds?: number) =>
      seconds === undefined
        ? '--:--'
        : dayjs('1970-01-01T00:00:00')
            .add(seconds, 'second')
            .format('HH:mm:ss'),
    [],
  );

  const exportableSeconds = useMemo(() => {
    if (exportSelectionSeconds > 0)
      return Math.min(MAX_EXPORT_SECONDS, exportSelectionSeconds);
    return Math.min(
      MAX_EXPORT_SECONDS,
      Math.max(0, footage.duration - clipPlayedSeconds),
    );
  }, [clipPlayedSeconds, exportSelectionSeconds, footage.duration]);

  // ... (keep drawFrame) ...
  const drawFrame = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      width: number,
      height: number,
      isGrid: boolean,
    ) => {
      const drawVideo = (
        video: HTMLVideoElement | null,
        x: number,
        y: number,
        w: number,
        h: number,
      ) => {
        if (!video || video.readyState < 2) return;
        ctx.drawImage(video, x, y, w, h);
      };
      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, width, height);

      if (isGrid) {
        const halfW = width / 2;
        const halfH = height / 2;
        drawVideo(frontPreviewRef.current, 0, 0, halfW, halfH);
        drawVideo(leftPreviewRef.current, 0, halfH, halfW, halfH);
        drawVideo(backPreviewRef.current, halfW, 0, halfW, halfH);
        drawVideo(rightPreviewRef.current, halfW, halfH, halfW, halfH);
      } else {
        const map: Record<ViewType, HTMLVideoElement | null> = {
          grid: null,
          front: frontPreviewRef.current,
          back: backPreviewRef.current,
          left: leftPreviewRef.current,
          right: rightPreviewRef.current,
        };
        drawVideo(map[viewType], 0, 0, width, height);
      }

      const { time, location } = overlayRef.current;
      const padding = 40;
      const boxWidth = width - padding * 2;
      const boxHeight = 120;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(padding, padding, boxWidth, boxHeight);
      ctx.fillStyle = '#e5e5e5';
      ctx.font = 'bold 36px Inter, sans-serif';
      ctx.fillText(time, padding + 24, padding + 56);
      ctx.font = '28px Inter, sans-serif';
      ctx.fillStyle = '#a3a3a3';
      ctx.fillText(location, padding + 24, padding + 100);
    },
    [backPreviewRef, overlayRef, rightPreviewRef, viewType],
  );

  const resolveCanvasSize = useCallback(() => {
    const baseMap: Record<ViewType, HTMLVideoElement | null> = {
      grid: frontPreviewRef.current || backPreviewRef.current,
      front: frontPreviewRef.current,
      back: backPreviewRef.current,
      left: leftPreviewRef.current,
      right: rightPreviewRef.current,
    };
    const baseVideo = baseMap[viewType];
    const fallbackWidth = 1280;
    const fallbackHeight = 720;
    const baseWidth = baseVideo?.videoWidth || fallbackWidth;
    const baseHeight = baseVideo?.videoHeight || fallbackHeight;
    const isGrid = viewType === 'grid';
    return {
      isGrid,
      width: isGrid ? baseWidth * 2 : baseWidth,
      height: isGrid ? baseHeight * 2 : baseHeight,
    };
  }, [
    backPreviewRef,
    frontPreviewRef,
    leftPreviewRef,
    rightPreviewRef,
    viewType,
  ]);

  const exportScreenshot = useCallback(async () => {
    try {
      const { isGrid, width, height } = resolveCanvasSize();
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Failed to get canvas context');
      drawFrame(ctx, width, height, isGrid);

      canvas.toBlob(
        async (blob) => {
          if (!blob) return;
          try {
            const arrayBuffer = await blob.arrayBuffer();
            const fileName = `${clip.name}-${viewType}.jpg`;
            const path = await window.electronAPI?.saveFile(
              fileName,
              arrayBuffer,
            );
            if (path) {
              setToastMsg(`Screenshot saved to ${path}`);
              window.electronAPI?.showItemInFolder(path);
            }
          } catch (e: any) {
            console.error('Save screenshot failed', e);
            setToastMsg(`Error saving: ${e.message}`);
          }
        },
        'image/jpeg',
        0.92,
      );
    } catch (error: any) {
      console.error('Screenshot failed', error);
      setToastMsg(`Screenshot failed: ${error.message}`);
    }
  }, [clip.name, drawFrame, resolveCanvasSize, viewType]);

  const cancelExport = useCallback(() => {
    isCancelingRef.current = true;
  }, []);

  const exportCurrentView = useCallback(async () => {
    if (exporting) return;
    if (exportableSeconds <= 0) {
      setToastMsg('No video content to export');
      return;
    }

    try {
      const exportStartSeconds =
        exportSelectionSeconds > 0 && exportIn !== undefined
          ? exportIn
          : clipPlayedSeconds;
      const seekInfo = calcSeekInfo(footage, exportStartSeconds);
      if (!seekInfo) throw new Error('Could not seek to export start time');

      setSegmentIndex(seekInfo.index);
      players.forEach((i) => {
        if (i.current) i.current.currentTime = seekInfo.seconds;
      });

      const exportStartTimeText = dayjs(
        parseTime(footage.segments[seekInfo.index].name),
      )
        .add(seekInfo.seconds, 'second')
        .format('YYYY年MM月DD日 ddd HH:mm:ss');
      overlayRef.current = {
        time: exportStartTimeText,
        location: locationText,
      };

      const { isGrid, width, height } = resolveCanvasSize();
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Failed to create canvas context');

      const captureFps = 60;
      const stream = canvas.captureStream(captureFps);
      stream
        .getVideoTracks()
        .forEach((track) => track.applyConstraints({ frameRate: captureFps }));

      const mimeCandidates = [
        'video/mp4;codecs=H264',
        'video/mp4',
        'video/webm;codecs=vp9',
        'video/webm',
      ];
      const mimeType = mimeCandidates.find((m) =>
        MediaRecorder.isTypeSupported(m),
      );
      if (!mimeType) console.warn('No preferred mimeType found, using default');

      const recorder = new MediaRecorder(
        stream,
        mimeType
          ? { mimeType, videoBitsPerSecond: 8_000_000 }
          : { videoBitsPerSecond: 8_000_000 },
      );

      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onerror = (e) => {
        console.error('Recorder error', e);
        setExporting(false);
        setToastMsg('Export failed during recording');
      };
      recorder.onstop = async () => {
        if (isCancelingRef.current) {
          setExporting(false);
          setExportProgress(0);
          return;
        }
        try {
          const blob = new Blob(chunks, { type: mimeType || 'video/mp4' });
          if (blob.size <= 0) {
            setExporting(false);
            setToastMsg('Export failed: Empty video file');
            return;
          }

          const ext = mimeType?.includes('mp4') || !mimeType ? 'mp4' : 'webm';
          const fileName = `${clip.name}-${viewType}.${ext}`;
          const arrayBuffer = await blob.arrayBuffer();
          const path = await window.electronAPI?.saveFile(
            fileName,
            arrayBuffer,
          );

          setExporting(false);
          setExportProgress(0);

          if (path) {
            setToastMsg(`Video saved`);
            window.electronAPI?.showItemInFolder(path);
          }
        } catch (e: any) {
          console.error('Save failed', e);
          setExporting(false);
          setToastMsg(`Save failed: ${e.message}`);
        }
      };

      setExporting(true);
      setExportProgress(0);
      isCancelingRef.current = false;
      recorder.start(1000);

      const start = performance.now();
      const step = () => {
        if (isCancelingRef.current) {
          if (recorder.state === 'recording') recorder.stop();
          return;
        }
        if (recorder.state !== 'recording') {
          // Recorder stopped unexpectedly (e.g. via onerror), exit loop without erroring
          return;
        }
        try {
          const elapsed = (performance.now() - start) / 1000;
          setExportProgress(Math.min(100, (elapsed / exportableSeconds) * 100)); // Update progress

          drawFrame(ctx, width, height, isGrid);
          if (elapsed < exportableSeconds) {
            requestAnimationFrame(step);
          } else {
            if (recorder.state === 'recording') {
              recorder.requestData();
              recorder.stop();
            }
          }
        } catch (err: any) {
          console.error('Drawing error', err);
          if (recorder.state === 'recording') recorder.stop();
          setToastMsg(`Export error: ${err.message}`);
        }
      };
      step();
    } catch (e: any) {
      console.error('Export start failed', e);
      setExporting(false);
      setToastMsg(`Export failed to start: ${e.message}`);
    }
  }, [
    clip.name,
    footage,
    clipPlayedSeconds,
    exportIn,
    exportSelectionSeconds,
    exportableSeconds,
    exporting,
    drawFrame,
    resolveCanvasSize,
    viewType,
  ]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <Toast message={toastMsg} onClose={() => setToastMsg(null)} />
      <ExportModal
        open={exporting}
        progress={exportProgress}
        onCancel={cancelExport}
      />
      {/* Visual Header Overlays */}
      <div className="pointer-events-none absolute top-6 left-6 z-20 flex flex-col gap-1 drop-shadow-lg">
        <div className="text-2xl font-bold tracking-wide text-white">
          {formatTime}
        </div>
        <div className="text-base font-medium text-neutral-300">
          {locationText}
        </div>
      </div>

      <div className="absolute top-6 right-6 z-20 flex items-center gap-3">
        {clip.event && (
          <a
            href={genLocationUrl(clip.event)}
            target="_blank"
            rel="noreferrer"
            className="glass-panel rounded-md px-3 py-1.5 text-xs font-medium text-neutral-300 transition-colors hover:bg-white/10 hover:text-white"
          >
            Open Map
          </a>
        )}
        <button
          onClick={exportScreenshot}
          className="glass-panel rounded-md px-3 py-1.5 text-xs font-medium text-neutral-300 transition-colors hover:bg-white/10 hover:text-white"
        >
          Snapshot
        </button>
      </div>

      {/* Main Stage (Video Grid) */}
      <div className="relative flex-1 overflow-hidden rounded-xl bg-black shadow-2xl ring-1 ring-white/10">
        {/* Actual Video Players (Hidden/Visible handled by layout) */}
        <div
          className={clsx(
            'h-full w-full',
            viewType === 'grid'
              ? 'grid grid-cols-2 grid-rows-2'
              : 'flex items-center justify-center',
          )}
        >
          {/* Note: In grid mode we map specific players to quadrants. In full mode we show one. 
                 The original logic used 'full' prop on Player. We keep that logic but restyle the container. 
             */}
          <Player
            videoRef={frontPreviewRef}
            url={segment.front}
            playing={playing}
            playbackRate={playbackRate}
            full={viewType === 'front'}
            className={clsx(
              viewType === 'grid' && 'border-r border-b border-white/5',
            )}
            onChangeState={handleChangeState}
            unique="front"
            index={segmentIndex}
            onDoubleClick={() =>
              setviewType(viewType === 'grid' ? 'front' : 'grid')
            }
          />
          <Player
            videoRef={leftPreviewRef}
            url={segment.left}
            playing={playing}
            playbackRate={playbackRate}
            full={viewType === 'left'}
            className={clsx(
              viewType === 'grid' && 'border-r border-b border-white/5',
            )}
            onChangeState={handleChangeState}
            unique="left"
            index={segmentIndex}
            onDoubleClick={() =>
              setviewType(viewType === 'grid' ? 'left' : 'grid')
            }
          />
          <Player
            videoRef={backPreviewRef}
            url={segment.back}
            playing={playing}
            playbackRate={playbackRate}
            full={viewType === 'back'}
            className={clsx(
              viewType === 'grid' && 'border-t border-r border-white/5',
            )}
            onChangeState={handleChangeState}
            unique="back"
            index={segmentIndex}
            onDoubleClick={() =>
              setviewType(viewType === 'grid' ? 'back' : 'grid')
            }
          />
          <Player
            videoRef={rightPreviewRef}
            url={segment.right}
            playing={playing}
            playbackRate={playbackRate}
            full={viewType === 'right'}
            className={clsx(
              viewType === 'grid' && 'border-t border-l border-white/5',
            )}
            onChangeState={handleChangeState}
            unique="right"
            index={segmentIndex}
            onDoubleClick={() =>
              setviewType(viewType === 'grid' ? 'right' : 'grid')
            }
          />
        </div>
      </div>

      {/* View Switcher (Mini Thumbs) */}
      <div className="flex justify-center gap-2">
        {['grid', 'front', 'back', 'left', 'right'].map((v) => (
          <button
            key={v}
            onClick={() => setviewType(v as ViewType)}
            className={clsx(
              'rounded-full border px-4 py-1.5 text-xs font-medium tracking-wider uppercase transition-all',
              viewType === v
                ? 'border-white bg-white text-black'
                : 'bg-surface-panel border-white/5 text-neutral-500 hover:border-white/20 hover:text-neutral-300',
            )}
          >
            {v}
          </button>
        ))}
      </div>

      {/* Control Bar (Floating Glass) */}
      <div className="glass-panel mx-auto flex w-full max-w-4xl flex-col gap-3 rounded-2xl p-4">
        {/* Timeline */}
        <div className="flex items-center gap-3 text-xs font-medium text-neutral-500">
          <span>
            {dayjs().startOf('day').add(clipPlayedSeconds, 's').format('mm:ss')}
          </span>
          <div className="flex-1">
            <Progress
              value={clipPlayedSeconds}
              max={footage.duration}
              mark={eventSeconds}
              onChange={seek}
            />
          </div>
          <span>
            {dayjs().startOf('day').add(footage.duration, 's').format('mm:ss')}
          </span>
        </div>

        {/* Buttons */}
        <div className="flex items-center justify-between">
          {/* Left: Export Tools */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg bg-white/5 p-1">
              <button
                onClick={markExportIn}
                className={clsx(
                  'rounded px-2 py-1 text-[10px]',
                  exportIn !== undefined
                    ? 'bg-brand-primary/20 text-brand-primary'
                    : 'text-neutral-500 hover:text-neutral-300',
                )}
              >
                IN {formatExportPoint(exportIn)}
              </button>
              <button
                onClick={markExportOut}
                className={clsx(
                  'rounded px-2 py-1 text-[10px]',
                  exportOut !== undefined
                    ? 'bg-brand-primary/20 text-brand-primary'
                    : 'text-neutral-500 hover:text-neutral-300',
                )}
              >
                OUT {formatExportPoint(exportOut)}
              </button>
            </div>
            <button
              onClick={exportCurrentView}
              disabled={exporting || exportableSeconds <= 0}
              className="bg-brand-primary disabled:hover:bg-brand-primary flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs text-white transition-colors hover:bg-red-600 disabled:opacity-50"
            >
              {exporting ? 'EXPORTING...' : 'EXPORT CLIP'}
            </button>
          </div>

          {/* Center: Playback */}
          <div className="flex items-center gap-6">
            <IconBtn onClick={() => jump(-15)}>
              <RiReplay15Fill size={20} />
            </IconBtn>
            {isClipEnded ? (
              <button
                onClick={replay}
                className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-black transition-transform hover:scale-105"
              >
                <MdReplay size={24} />
              </button>
            ) : (
              <button
                onClick={() => setPlaying(!playing)}
                className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-black transition-transform hover:scale-105"
              >
                {playing ? <IoPause size={24} /> : <IoPlay size={24} ml-1 />}
              </button>
            )}
            <IconBtn onClick={() => jump(15)}>
              <RiForward15Fill size={20} />
            </IconBtn>
          </div>

          {/* Right: Event Jump & Speed */}
          <div className="flex items-center gap-4">
            {eventSeconds && (
              <button
                onClick={() => seek(eventSeconds)}
                className="text-brand-primary text-xs font-medium tracking-wider uppercase hover:text-red-400"
              >
                Jump to Event
              </button>
            )}
            <Rate value={playbackRate} onChange={setPlaybackRate} />
          </div>
        </div>
      </div>
    </div>
  );
}
