import dayjs from 'dayjs';
import { useCallback, useMemo, useRef, useState } from 'react';

import type { ComposeLayout } from '../../../electron/composeTypes';
import type { TranslationKey } from '../../i18n';
import type {
  CamClip,
  CamFootage,
  CamName,
  ExportCanvasSize,
  SeekInfo,
  ViewType,
} from '../../utils';
import {
  calcSeekInfo,
  parseTime,
  resolveOverlayBarLayout,
  selectSegmentsInRange,
} from '../../utils';
import type { ExportSettings } from '../useExportSettings';

/** Canvas RGBA pipe is heavy — keep a cap. Compose export can go longer. */
const MAX_EXPORT_SECONDS = 60;
const MAX_COMPOSE_EXPORT_SECONDS = 600;

/** Extract a human-readable message from an unknown thrown value. */
function errText(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

type Params = {
  clip: CamClip;
  footage: CamFootage;
  viewType: ViewType;
  players: React.RefObject<HTMLVideoElement | null>[];
  clipPlayedSeconds: number;
  playbackRate: number;
  setPlaying: (playing: boolean) => void;
  setPlaybackRate: (rate: number) => void;
  segmentIndexRef: React.RefObject<number>;
  setSegmentIndex: (index: number) => void;
  /** Draw the current composed frame onto a canvas (canvas export path) */
  drawFrame: (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    layout: ViewType,
    videoHeight: number,
  ) => void;
  resolveCanvasSize: (maxWidth?: number) => ExportCanvasSize;
  /** Update the time/location shown by drawFrame's overlay */
  setOverlayTimeLocation: (time: string, location: string) => void;
  locationText: string;
  formatTime: string;
  timestampFmt: string;
  /** Localized camera labels for the export overlay */
  camLabels: Record<CamName, string>;
  buildDriveWindows: (
    rangeStart: number,
    rangeDuration: number,
  ) => { start: number; end: number; text: string }[];
  exportSettings: ExportSettings;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  setToastMsg: (msg: string | null) => void;
};

/**
 * Video export state machine. Two pipelines:
 * - Compose (preferred): source files → FFmpeg filter_complex in the main
 *   process. Fast, supports long ranges, hardware encoding.
 * - Canvas (fallback): per-frame canvas capture piped as raw RGBA. Used when
 *   disk paths can't be resolved.
 */
export function useVideoExport({
  clip,
  footage,
  viewType,
  players,
  clipPlayedSeconds,
  playbackRate,
  setPlaying,
  setPlaybackRate,
  segmentIndexRef,
  setSegmentIndex,
  drawFrame,
  resolveCanvasSize,
  setOverlayTimeLocation,
  locationText,
  formatTime,
  timestampFmt,
  camLabels,
  buildDriveWindows,
  exportSettings,
  t,
  setToastMsg,
}: Params) {
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportFrameCount, setExportFrameCount] = useState(0);
  const [exportEta, setExportEta] = useState<string>();
  const [exportEncoding, setExportEncoding] = useState(false);
  const [exportIn, setExportIn] = useState<number>();
  const [exportOut, setExportOut] = useState<number>();
  const isCancelingRef = useRef(false);
  const activeExportSessionRef = useRef<string | null>(null);

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

  const canUseComposeExport = useMemo(() => {
    if (!window.electronAPI?.exportCompose) return false;
    if (clip.videos.length === 0) return false;
    // Compose reads source files from disk directly, so EVERY video must
    // resolve to a real path — otherwise fall back to the canvas pipeline
    // instead of silently exporting black cells for unresolvable cameras.
    return clip.videos.every((f) => {
      try {
        return !!window.electronAPI?.getPathForFile(f);
      } catch {
        return false;
      }
    });
  }, [clip.videos]);

  const maxExportSeconds = canUseComposeExport
    ? MAX_COMPOSE_EXPORT_SECONDS
    : MAX_EXPORT_SECONDS;

  const exportableSeconds = useMemo(() => {
    if (exportSelectionSeconds > 0)
      return Math.min(maxExportSeconds, exportSelectionSeconds);
    return Math.min(
      maxExportSeconds,
      Math.max(0, footage.duration - clipPlayedSeconds),
    );
  }, [
    clipPlayedSeconds,
    exportSelectionSeconds,
    footage.duration,
    maxExportSeconds,
  ]);

  const cancelExport = useCallback(() => {
    isCancelingRef.current = true;
    const sessionId = activeExportSessionRef.current;
    if (!sessionId) return;
    window.electronAPI?.exportComposeCancel?.(sessionId);
    window.electronAPI?.exportCancel?.(sessionId);
  }, []);

  // ── Canvas-path helpers ──

  /** Wait for a video element to have renderable frame data after seeking */
  const waitForVideoReady = (
    video: HTMLVideoElement,
    timeoutMs = 5000,
  ): Promise<void> => {
    return new Promise((resolve) => {
      if (video.readyState >= 2) {
        resolve();
        return;
      }
      const timer = setTimeout(resolve, timeoutMs);
      const onReady = () => {
        clearTimeout(timer);
        video.removeEventListener('canplay', onReady);
        video.removeEventListener('seeked', onReady);
        resolve();
      };
      video.addEventListener('canplay', onReady);
      video.addEventListener('seeked', onReady);
    });
  };

  /**
   * Read raw RGBA bytes from canvas for FFmpeg piping.
   * The ImageData buffer is freshly allocated by getImageData and not reused,
   * so it can be viewed directly — the previous `.slice(0)` doubled peak
   * memory for every frame (another 28 MB per frame at 4K).
   */
  const canvasToRgbaBytes = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
  ): Uint8Array => {
    const imageData = ctx.getImageData(0, 0, width, height);
    return new Uint8Array(imageData.data.buffer);
  };

  const waitForLayoutCommit = useCallback(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
    [],
  );

  const seekExportFrame = useCallback(
    async (clipSeconds: number): Promise<SeekInfo> => {
      const seekInfo = calcSeekInfo(footage, clipSeconds);
      if (!seekInfo) throw new Error('Could not resolve export frame position');

      if (segmentIndexRef.current !== seekInfo.index) {
        setSegmentIndex(seekInfo.index);
        await waitForLayoutCommit();
      }

      const activeVideos: HTMLVideoElement[] = [];
      for (const player of players) {
        if (player.current && player.current.src) {
          player.current.pause();
          player.current.playbackRate = 1;
          player.current.currentTime = seekInfo.seconds;
          activeVideos.push(player.current);
        }
      }

      await Promise.all(activeVideos.map((video) => waitForVideoReady(video)));
      return seekInfo;
    },
    [footage, players, waitForLayoutCommit, segmentIndexRef, setSegmentIndex],
  );

  /**
   * Resolve absolute disk paths per segment/camera, limited to the segments the
   * export window actually touches.
   *
   * Sending the whole clip made the main process stat every path it was given:
   * a RecentClips folder is 174 segments / 1044 files, all validated to encode
   * a window that overlaps one or two of them.
   */
  const buildComposeSegments = useCallback(
    (rangeStart: number, rangeDuration: number) => {
      const resolveCam = (fileName: string): CamName | undefined => {
        const restName = fileName.slice(20);
        if (restName.startsWith('front')) return 'front';
        if (restName.startsWith('back')) return 'back';
        if (restName.startsWith('left_repeater')) return 'left';
        if (restName.startsWith('right_repeater')) return 'right';
        if (restName.startsWith('left_pillar')) return 'left_pillar';
        if (restName.startsWith('right_pillar')) return 'right_pillar';
        return undefined;
      };

      const inRange = selectSegmentsInRange(
        footage.segments,
        rangeStart,
        rangeDuration,
      );
      const wanted = new Set(inRange.map((seg) => seg.name));

      // Index the needed files in one pass instead of scanning clip.videos
      // once per (segment × camera).
      const pathBySegCam = new Map<string, string>();
      for (const file of clip.videos) {
        const segName = file.name.slice(0, 19);
        if (!wanted.has(segName)) continue;
        const cam = resolveCam(file.name);
        if (!cam) continue;
        try {
          const p = window.electronAPI?.getPathForFile(file);
          if (p) pathBySegCam.set(`${segName}|${cam}`, p);
        } catch {
          /* unresolvable path — cell becomes a black placeholder */
        }
      }

      return inRange.map((seg) => {
        const paths: Record<string, string | undefined> = {};
        for (const cam of Object.keys(camLabels) as CamName[]) {
          const p = pathBySegCam.get(`${seg.name}|${cam}`);
          if (p) paths[cam] = p;
        }
        return {
          name: seg.name,
          startSeconds: seg.startSeconds,
          duration: seg.duration,
          paths,
        };
      });
    },
    [clip.videos, footage.segments, camLabels],
  );

  /**
   * Geometry for the compose export — the same numbers the screenshot canvas
   * uses, so the two outputs are laid out identically instead of each applying
   * its own constants.
   */
  const buildComposeLayout = useCallback((): ComposeLayout => {
    // Video honours the resolution setting; screenshots stay at full quality.
    const size = resolveCanvasSize(exportSettings.videoMaxWidth);
    const barLayout = resolveOverlayBarLayout(size.scale);
    const hPad = Math.round(22 * size.scale);
    const leftTextX = hPad + barLayout.iconSize + Math.round(16 * size.scale);

    return {
      width: size.width,
      height: size.height,
      videoHeight: size.videoHeight,
      barHeight: size.barHeight,
      scale: size.scale,
      padding: barLayout.padding,
      brandSize: barLayout.brandSize,
      titleSize: barLayout.titleSize,
      subSize: barLayout.subSize,
      gap: barLayout.gap,
      iconSize: barLayout.iconSize,
      hPad,
      leftTextX,
    };
  }, [resolveCanvasSize, exportSettings.videoMaxWidth]);

  /**
   * One localized timestamp per second of the export. FFmpeg's built-in clock
   * can only render `YYYY-MM-DD HH:MM:SS`, which does not match what the app
   * and the screenshot show.
   */
  const buildTimeWindows = useCallback(
    (rangeStart: number, rangeDuration: number) => {
      const windows: { start: number; end: number; text: string }[] = [];
      const total = Math.ceil(rangeDuration);
      for (let i = 0; i < total; i++) {
        const info = calcSeekInfo(footage, rangeStart + i);
        if (!info) continue;
        const text = dayjs(parseTime(footage.segments[info.index].name))
          .add(info.seconds, 'second')
          .format(timestampFmt);
        windows.push({
          start: i,
          end: Math.min(i + 1, rangeDuration),
          text,
        });
      }
      return windows;
    },
    [footage, timestampFmt],
  );

  // ── Export entry point ──
  const exportCurrentView = useCallback(async () => {
    if (exporting) return;
    if (exportableSeconds <= 0) {
      setToastMsg(t('toast.noContent'));
      return;
    }

    const exportStartSeconds =
      exportSelectionSeconds > 0 && exportIn !== undefined
        ? exportIn
        : clipPlayedSeconds;

    const sessionId = `export-${Date.now()}`;
    activeExportSessionRef.current = sessionId;
    const prevPlaybackRate = playbackRate;
    const fileName = `${clip.name}-${viewType}.mp4`;

    // ── Fast path: FFmpeg filter_complex from source files ──
    if (window.electronAPI?.exportCompose && canUseComposeExport) {
      setPlaying(false);
      setPlaybackRate(1);
      setExporting(true);
      setExportProgress(0);
      setExportFrameCount(0);
      setExportEta(undefined);
      setExportEncoding(true);
      isCancelingRef.current = false;

      const startMark = performance.now();
      const unsub = window.electronAPI.onExportComposeProgress?.((data) => {
        if (data.sessionId !== sessionId) return;
        setExportProgress(data.progress);
        setExportFrameCount(Math.round(data.outTimeSec * 30));
        if (data.progress > 2 && data.outTimeSec > 0.5) {
          const rate =
            data.outTimeSec / ((performance.now() - startMark) / 1000);
          if (rate > 0.01) {
            const etaSec = (exportableSeconds - data.outTimeSec) / rate;
            if (etaSec > 60) {
              setExportEta(
                `${Math.floor(etaSec / 60)}m ${Math.round(etaSec % 60)}s`,
              );
            } else {
              setExportEta(`${Math.round(Math.max(0, etaSec))}s`);
            }
          }
        }
      });

      try {
        // Export-start wall-clock moment: static label as fallback, unix
        // epoch for a live-updating drawtext clock in the output video.
        const exportStartMoment = (() => {
          const info = calcSeekInfo(footage, exportStartSeconds);
          if (!info) return null;
          return dayjs(parseTime(footage.segments[info.index].name)).add(
            info.seconds,
            'second',
          );
        })();

        const result = await window.electronAPI.exportCompose({
          sessionId,
          fileName,
          viewType,
          startSeconds: exportStartSeconds,
          durationSeconds: exportableSeconds,
          segments: buildComposeSegments(exportStartSeconds, exportableSeconds),
          labels: camLabels,
          layout: buildComposeLayout(),
          overlay: {
            showTime: exportSettings.showTime,
            showLocation: exportSettings.showLocation,
            showDriveData: exportSettings.showDriveData,
            locationText,
            baseTimestampLabel:
              exportStartMoment?.format(timestampFmt) ?? formatTime,
            baseTimestampEpoch: exportStartMoment?.unix(),
            brandText: 'TESLA CINEMA',
            timeWindows: exportSettings.showTime
              ? buildTimeWindows(exportStartSeconds, exportableSeconds)
              : undefined,
            driveWindows: exportSettings.showDriveData
              ? buildDriveWindows(exportStartSeconds, exportableSeconds)
              : undefined,
          },
          // Omitted on purpose: the main process reads the real source rate
          // (~36 fps on current firmware, ~24 on older clips) instead of
          // resampling everything to a fixed 30.
          useHardware: exportSettings.hwAccel,
        });

        unsub?.();
        activeExportSessionRef.current = null;
        setExporting(false);
        setExportProgress(0);
        setExportEncoding(false);
        setPlaybackRate(prevPlaybackRate);

        if (isCancelingRef.current || result.canceled) {
          return;
        }
        if (result.ok && result.filePath) {
          setToastMsg(t('toast.videoSaved'));
          window.electronAPI.showItemInFolder(result.filePath);
        } else {
          console.error('Compose export failed:', result.error);
          setToastMsg(
            t('toast.exportFailedStart', {
              error: result.error || 'unknown',
            }),
          );
        }
      } catch (e) {
        unsub?.();
        activeExportSessionRef.current = null;
        setExporting(false);
        setExportEncoding(false);
        setPlaybackRate(prevPlaybackRate);
        setToastMsg(t('toast.exportError', { error: errText(e) }));
      }
      return;
    }

    // ── Legacy path: canvas RGBA pipe ──
    if (!window.electronAPI?.exportStart) {
      setToastMsg(t('toast.exportFailed'));
      return;
    }

    try {
      setPlaying(false);
      setPlaybackRate(1);
      await waitForLayoutCommit();
      const initialSeekInfo = await seekExportFrame(exportStartSeconds);

      const { width, height, videoHeight } = resolveCanvasSize();
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Failed to create canvas context');

      const exportTime = dayjs(
        parseTime(footage.segments[initialSeekInfo.index].name),
      )
        .add(initialSeekInfo.seconds, 'second')
        .format(timestampFmt);
      setOverlayTimeLocation(exportTime, locationText);

      const fps = 30;

      const startResult = await window.electronAPI.exportStart({
        sessionId,
        fileName,
        width,
        height,
        fps,
      });
      if (!startResult.ok) {
        setPlaybackRate(prevPlaybackRate);
        if (!startResult.canceled) {
          setToastMsg(
            t('toast.exportFailedStart', {
              error: startResult.error || 'unknown',
            }),
          );
        }
        return;
      }

      setExporting(true);
      setExportProgress(0);
      setExportFrameCount(0);
      setExportEta(undefined);
      setExportEncoding(false);
      isCancelingRef.current = false;

      const frameDuration = 1 / fps;
      const totalFrames = Math.ceil(exportableSeconds * fps);

      const startRealTime = performance.now();
      let frameIndex = 0;
      let lastUiUpdate = 0;

      const captureLoop = async () => {
        while (frameIndex < totalFrames) {
          if (isCancelingRef.current) {
            window.electronAPI!.exportCancel(sessionId);
            setExporting(false);
            setExportProgress(0);
            setPlaying(false);
            setPlaybackRate(prevPlaybackRate);
            return;
          }

          const realElapsed = (performance.now() - startRealTime) / 1000;
          const now = performance.now();
          if (
            frameIndex === 0 ||
            frameIndex === totalFrames - 1 ||
            now - lastUiUpdate >= 120
          ) {
            const pct = Math.min(99, (frameIndex / totalFrames) * 100);
            setExportProgress(pct);
            setExportFrameCount(frameIndex);

            if (frameIndex > 5 && realElapsed > 0) {
              const framesPerSec = frameIndex / realElapsed;
              const remaining = (totalFrames - frameIndex) / framesPerSec;
              if (remaining > 60) {
                setExportEta(
                  `${Math.floor(remaining / 60)}m ${Math.round(remaining % 60)}s`,
                );
              } else {
                setExportEta(`${Math.round(remaining)}s`);
              }
            }
            lastUiUpdate = now;
          }

          const virtualElapsed = frameIndex * frameDuration;
          const targetClipSeconds = Math.min(
            exportStartSeconds + virtualElapsed,
            footage.duration,
          );
          const frameSeekInfo = await seekExportFrame(targetClipSeconds);
          const overlayTime = dayjs(
            parseTime(footage.segments[frameSeekInfo.index].name),
          )
            .add(frameSeekInfo.seconds, 'second')
            .format(timestampFmt);
          setOverlayTimeLocation(overlayTime, locationText);

          drawFrame(ctx, width, height, viewType, videoHeight);
          const frameBytes = canvasToRgbaBytes(ctx, width, height);
          await window.electronAPI!.exportFrame(sessionId, frameBytes);

          frameIndex++;

          if (frameIndex % 6 === 0) {
            await new Promise((r) => requestAnimationFrame(r));
          }
        }

        setExportProgress(100);
        setExportEta(undefined);
        setExportEncoding(true);
        const result = await window.electronAPI!.exportFinish(sessionId);

        setPlaying(false);
        setPlaybackRate(prevPlaybackRate);
        setExporting(false);
        setExportProgress(0);

        if (result.ok && result.filePath) {
          setToastMsg(t('toast.videoSaved'));
          window.electronAPI!.showItemInFolder(result.filePath);
        } else {
          setToastMsg(t('toast.exportFailedEmpty'));
          console.error('FFmpeg export failed:', result.error);
        }
      };

      captureLoop().catch((err: unknown) => {
        console.error('Export loop failed:', err);
        window.electronAPI?.exportCancel(sessionId);
        setExporting(false);
        setPlaying(false);
        setPlaybackRate(prevPlaybackRate);
        setToastMsg(t('toast.exportError', { error: errText(err) }));
      });
    } catch (e) {
      console.error('Export start failed', e);
      setExporting(false);
      setPlaybackRate(prevPlaybackRate);
      setToastMsg(t('toast.exportFailedStart', { error: errText(e) }));
    }
  }, [
    clip.name,
    footage,
    clipPlayedSeconds,
    exportIn,
    exportSelectionSeconds,
    exportableSeconds,
    exporting,
    playbackRate,
    drawFrame,
    locationText,
    resolveCanvasSize,
    viewType,
    t,
    timestampFmt,
    seekExportFrame,
    waitForLayoutCommit,
    canUseComposeExport,
    buildComposeSegments,
    buildComposeLayout,
    buildDriveWindows,
    buildTimeWindows,
    exportSettings,
    formatTime,
    camLabels,
    setOverlayTimeLocation,
    setPlaying,
    setPlaybackRate,
    setToastMsg,
  ]);

  return {
    exporting,
    exportProgress,
    exportFrameCount,
    exportEta,
    exportEncoding,
    exportIn,
    exportOut,
    setExportIn,
    setExportOut,
    markExportIn,
    markExportOut,
    formatExportPoint,
    exportSelectionSeconds,
    exportableSeconds,
    maxExportSeconds,
    canUseComposeExport,
    exportCurrentView,
    cancelExport,
  };
}
