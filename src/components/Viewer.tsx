import dayjs from 'dayjs';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IoPause, IoPlay, IoVolumeHigh, IoVolumeMute } from 'react-icons/io5';
import { MdReplay, MdPictureInPicture } from 'react-icons/md';
import { RiForward15Fill, RiReplay15Fill } from 'react-icons/ri';
import clsx from 'clsx';

import {
  calcEventSeconds,
  calcSeekInfo,
  type CamClip,
  type CamFootage,
  type CamName,
  extractFootageSEI,
  formatDuration,
  genAllMapLinks,
  parseTime,
  type PlayerState,
  type SeekInfo,
  type SEIDataPoint,
  type ViewType,
} from '../utils';
import { useI18n } from '../i18n';
import { Dashboard } from './Dashboard';
import { IconBtn } from './IconBtn';
import { Player } from './Player';
import { Progress } from './Progress';
import { Rate } from './Rate';
import { ExportModal } from './ExportModal';
import { Toast } from './Toast';
import { useExportSettings, type ExportSettings } from './useExportSettings';

type Props = {
  clip: CamClip;
  footage: CamFootage;
  /** Callback to update footage with SEI data once loaded */
  onFootageUpdate?: (footage: CamFootage) => void;
};

const MAX_EXPORT_SECONDS = 60;

/** All 6 camera names */
const ALL_CAMS: CamName[] = ['front', 'back', 'left', 'right', 'left_pillar', 'right_pillar'];

/** Display labels for camera names (UI) */
const CAM_LABELS: Record<CamName, string> = {
  front: 'Front',
  back: 'Back',
  left: 'Left',
  right: 'Right',
  left_pillar: 'L-Pillar',
  right_pillar: 'R-Pillar',
};

/** i18n keys for camera name overlays on export canvas */
const CAM_I18N_KEYS: Record<CamName, string> = {
  front: 'cam.front',
  back: 'cam.back',
  left: 'cam.left',
  right: 'cam.right',
  left_pillar: 'cam.left_pillar',
  right_pillar: 'cam.right_pillar',
};

/** Layout definitions for view switcher */
const LAYOUT_OPTIONS: { id: ViewType; label: string }[] = [
  { id: 'grid6', label: '6 Grid' },
  { id: 'grid4', label: '4 Grid' },
  { id: 'grid4old', label: '4 Classic' },
  { id: 'front', label: 'Front' },
  { id: 'back', label: 'Back' },
  { id: 'left', label: 'Left' },
  { id: 'right', label: 'Right' },
  { id: 'left_pillar', label: 'L-Pillar' },
  { id: 'right_pillar', label: 'R-Pillar' },
];

export function Viewer({ clip, footage, onFootageUpdate }: Props) {
  const { t } = useI18n();

  // ── Video Refs (6 cameras) ──
  const frontRef = useRef<HTMLVideoElement>(null);
  const backRef = useRef<HTMLVideoElement>(null);
  const leftRef = useRef<HTMLVideoElement>(null);
  const rightRef = useRef<HTMLVideoElement>(null);
  const leftPillarRef = useRef<HTMLVideoElement>(null);
  const rightPillarRef = useRef<HTMLVideoElement>(null);

  const refMap: Record<CamName, React.RefObject<HTMLVideoElement | null>> = useMemo(() => ({
    front: frontRef,
    back: backRef,
    left: leftRef,
    right: rightRef,
    left_pillar: leftPillarRef,
    right_pillar: rightPillarRef,
  }), []);

  const players = useMemo(() => Object.values(refMap), [refMap]);

  // ── Playing State ──
  const [statesMap, setStateMap] = useState<Record<CamName, PlayerState>>(() => ({
    back: {}, front: {}, left: {}, right: {}, left_pillar: {}, right_pillar: {},
  }));
  const handleChangeState = useCallback((key: CamName, val: PlayerState) => {
    setStateMap((s) => ({ ...s, [key]: val }));
  }, []);
  const states = useMemo(() => Object.values(statesMap), [statesMap]);

  // ── Segment Control ──
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

  // Check if B-pillar cameras exist
  const hasPillarCams = useMemo(() => {
    return footage.segments.some((s) => s.left_pillar || s.right_pillar);
  }, [footage.segments]);

  // ── Playback Info ──
  const segmentPlayedSeconds = Math.max(
    0,
    ...states
      .filter((i) => i.index === segmentIndex)
      .map((i) => i.currentTime || 0),
  );
  const timestampFmt = t('format.timestamp');
  const formatTime = dayjs(parseTime(segment.name))
    .add(segmentPlayedSeconds, 'second')
    .format(timestampFmt);

  const locationText = useMemo(() => {
    if (!clip.event) return t('viewer.noLocation');
    const { city, street, est_lat, est_lon } = clip.event;
    const locationName = [city, street].filter(Boolean).join(' ');
    const coord = [est_lat, est_lon].filter(Boolean).join(', ');
    if (locationName && coord) return `${locationName}（${coord}）`;
    return locationName || coord || t('viewer.noLocation');
  }, [clip.event, t]);

  const clipPlayedSeconds = segment.startSeconds + segmentPlayedSeconds;
  const eventSeconds = calcEventSeconds(clip, footage);
  const overlayRef = useRef({ time: formatTime, location: locationText });
  useEffect(() => {
    overlayRef.current = { time: formatTime, location: locationText };
  }, [formatTime, locationText]);

  // ── Lazy SEI Metadata Extraction ──
  const seiLoadingRef = useRef(false);
  useEffect(() => {
    if (footage.seiData) return; // Already loaded
    if (seiLoadingRef.current) return; // Already in progress
    seiLoadingRef.current = true;

    let cancelled = false;
    console.log('[SEI] Starting metadata extraction for', clip.videos.length, 'video files...');
    extractFootageSEI(clip.videos, footage).then((seiData) => {
      if (cancelled) return;
      seiLoadingRef.current = false;
      if (seiData) {
        console.log('[SEI] Found', seiData.length, 'data points');
        if (onFootageUpdate) {
          onFootageUpdate({ ...footage, seiData });
        }
      } else {
        console.log('[SEI] No metadata found (video may be from firmware < 2025.44.25)');
      }
    }).catch((e) => {
      if (cancelled) return;
      seiLoadingRef.current = false;
      console.warn('[SEI] Extraction failed:', e);
    });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip.name]); // Only run once per clip

  // ── SEI Metadata ──
  const hasMetadata = !!footage.seiData && footage.seiData.length > 0;

  const currentSEI: SEIDataPoint | null = useMemo(() => {
    if (!footage.seiData || footage.seiData.length === 0) return null;
    // Binary search for the closest data point
    const target = clipPlayedSeconds;
    const data = footage.seiData;
    let lo = 0, hi = data.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (data[mid].offsetSeconds <= target) lo = mid;
      else hi = mid - 1;
    }
    return data[lo] ?? null;
  }, [footage.seiData, clipPlayedSeconds]);

  // ── Controls ──
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

  // ── PiP ──
  const togglePiP = useCallback(async () => {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (frontRef.current) {
        await frontRef.current.requestPictureInPicture();
      }
    } catch (e) {
      console.warn('PiP failed:', e);
    }
  }, []);

  const [seekTask, setSeekTask] = useState<SeekInfo>();
  useEffect(() => {
    if (!seekTask) return;
    players.forEach((i) => {
      if (i.current) i.current.currentTime = seekTask.seconds;
    });
    setSeekTask(undefined);
  }, [players, seekTask, states]);

  // ── View Type ──
  const defaultView: ViewType = hasPillarCams ? 'grid6' : 'grid4';
  const [viewType, setViewType] = useState<ViewType>(defaultView);

  // Determine which cameras are visible in current layout
  const visibleCams: CamName[] = useMemo(() => {
    switch (viewType) {
      case 'grid6': return ALL_CAMS;
      case 'grid4': return ['front', 'back', 'left', 'right'];
      case 'grid4old': return ['front', 'back', 'left', 'right'];
      default: return [viewType as CamName];
    }
  }, [viewType]);

  const isSingleView = !viewType.startsWith('grid');

  // Filter layout options based on available cameras
  const availableLayouts = useMemo(() => {
    return LAYOUT_OPTIONS.filter((opt) => {
      if (opt.id === 'grid6' && !hasPillarCams) return false;
      if (opt.id === 'left_pillar' && !hasPillarCams) return false;
      if (opt.id === 'right_pillar' && !hasPillarCams) return false;
      return true;
    });
  }, [hasPillarCams]);

  // ── Volume Control ──
  const [muted, setMuted] = useState(true);
  useEffect(() => {
    players.forEach((p) => {
      if (p.current) p.current.muted = muted;
    });
  }, [muted, players]);

  // ── Export Logic ──
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportFrameCount, setExportFrameCount] = useState(0);
  const [exportEta, setExportEta] = useState<string>();
  const [exportEncoding, setExportEncoding] = useState(false);
  const [exportIn, setExportIn] = useState<number>();
  const [exportOut, setExportOut] = useState<number>();
  const isCancelingRef = useRef(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

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

  // ── Keyboard Shortcuts (must be after markExportIn/Out) ──
  const handleKeyboardControl = useCallback(
    (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

      switch (event.code) {
        case 'Space':
          event.preventDefault();
          setPlaying((p) => !p);
          break;
        case 'ArrowLeft':
          event.preventDefault();
          jump(-5);
          break;
        case 'ArrowRight':
          event.preventDefault();
          jump(5);
          break;
        case 'KeyF':
          event.preventDefault();
          if (document.fullscreenElement) {
            document.exitFullscreen();
          } else {
            document.documentElement.requestFullscreen?.();
          }
          break;
        case 'KeyP':
          event.preventDefault();
          togglePiP();
          break;
        case 'KeyI':
          event.preventDefault();
          markExportIn();
          break;
        case 'KeyO':
          event.preventDefault();
          markExportOut();
          break;
        case 'KeyM':
          event.preventDefault();
          setMuted((m) => !m);
          break;
      }
    },
    [jump, togglePiP, markExportIn, markExportOut],
  );
  useEffect(() => {
    window.addEventListener('keydown', handleKeyboardControl);
    return () => window.removeEventListener('keydown', handleKeyboardControl);
  }, [handleKeyboardControl]);

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

  // ── drawFrame (supports all layouts) ──
  const drawFrame = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      width: number,
      height: number,
      layout: ViewType,
      videoHeight?: number,
    ) => {
      // videoHeight = area for video grid; remaining = bottom info bar
      const vH = videoHeight ?? height;

      /**
       * Draw a video into a cell while preserving its native aspect ratio
       * (like CSS object-contain). The cell background is already black.
       */
      const drawVideo = (
        video: HTMLVideoElement | null,
        cx: number, cy: number, cw: number, ch: number,
      ) => {
        if (!video || video.readyState < 2) return;
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        if (!vw || !vh) return;

        const videoAR = vw / vh;
        const cellAR = cw / ch;

        let dw: number, dh: number;
        if (videoAR > cellAR) {
          // Video is wider than cell → fit to width, letterbox top/bottom
          dw = cw;
          dh = cw / videoAR;
        } else {
          // Video is taller than cell → fit to height, pillarbox left/right
          dh = ch;
          dw = ch * videoAR;
        }

        const dx = cx + (cw - dw) / 2;
        const dy = cy + (ch - dh) / 2;
        ctx.drawImage(video, dx, dy, dw, dh);
      };

      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, width, height);

      switch (layout) {
        case 'grid6': {
          const cellW = width / 3;
          const cellH = vH / 2;
          // Row 1: left, front, right
          drawVideo(leftRef.current, 0, 0, cellW, cellH);
          drawVideo(frontRef.current, cellW, 0, cellW, cellH);
          drawVideo(rightRef.current, cellW * 2, 0, cellW, cellH);
          // Row 2: left_pillar, back, right_pillar
          drawVideo(leftPillarRef.current, 0, cellH, cellW, cellH);
          drawVideo(backRef.current, cellW, cellH, cellW, cellH);
          drawVideo(rightPillarRef.current, cellW * 2, cellH, cellW, cellH);
          break;
        }
        case 'grid4': {
          const halfW = width / 2;
          const halfH = vH / 2;
          drawVideo(frontRef.current, 0, 0, halfW, halfH);
          drawVideo(backRef.current, halfW, 0, halfW, halfH);
          drawVideo(leftRef.current, 0, halfH, halfW, halfH);
          drawVideo(rightRef.current, halfW, halfH, halfW, halfH);
          break;
        }
        case 'grid4old': {
          // Legacy: front on top (full width), 3 below
          const topH = vH * 0.6;
          const botH = vH - topH;
          const thirdW = width / 3;
          drawVideo(frontRef.current, 0, 0, width, topH);
          drawVideo(leftRef.current, 0, topH, thirdW, botH);
          drawVideo(backRef.current, thirdW, topH, thirdW, botH);
          drawVideo(rightRef.current, thirdW * 2, topH, thirdW, botH);
          break;
        }
        default: {
          // Single camera
          const singleRef = refMap[layout as CamName];
          drawVideo(singleRef?.current ?? null, 0, 0, width, vH);
        }
      }

      // ── Bottom info bar (below the video area, never covers video) ──
      const barHeight = height - vH;
      if (barHeight > 0) {
        const { time, location } = overlayRef.current;
        const barY = vH;

        // Bar background is already black from the initial fillRect
        const scale = width / 1280;
        const hPad = Math.round(16 * scale);
        const titleSize = Math.max(14, Math.round(24 * scale));
        const subtitleSize = Math.max(11, Math.round(16 * scale));

        // Time text — left side, vertically centred in bar
        ctx.fillStyle = '#f5f5f5';
        ctx.font = `bold ${titleSize}px "Inter", "SF Pro Display", "Segoe UI", sans-serif`;
        const textBaseY = barY + (barHeight + titleSize * 0.7) / 2;
        ctx.fillText(time, hPad, textBaseY);

        // Location text — right-aligned, same baseline
        ctx.fillStyle = '#a3a3a3';
        ctx.font = `${subtitleSize}px "Inter", "SF Pro Display", "Segoe UI", sans-serif`;
        const locBaseY = barY + (barHeight + subtitleSize * 0.7) / 2;
        const locWidth = ctx.measureText(location).width;
        ctx.fillText(location, width - hPad - locWidth, locBaseY);
      }
    },
    [refMap, overlayRef],
  );

  /**
   * Resolve export canvas size.
   * Multi-grid layouts are capped at 1920×1080 (1080p) to keep file sizes reasonable.
   * Single camera exports use the native video resolution.
   * Adds a bottom bar for time/location info (60-80px).
   */
  const resolveCanvasSize = useCallback(() => {
    const baseVideo = frontRef.current || backRef.current;
    const fallbackWidth = 1280;
    const fallbackHeight = 720;
    const baseWidth = baseVideo?.videoWidth || fallbackWidth;
    const baseHeight = baseVideo?.videoHeight || fallbackHeight;
    
    // Bottom bar height for time/location overlay
    const bottomBarHeight = 60;

    switch (viewType) {
      case 'grid6': {
        // 3×2 grid → 1920×1080 + bottom bar
        const w = 1920;
        const h = 1080 + bottomBarHeight;
        return { width: w, height: h, videoHeight: 1080 };
      }
      case 'grid4': {
        // 2×2 grid → 1920×1080 + bottom bar
        const w = 1920;
        const h = 1080 + bottomBarHeight;
        return { width: w, height: h, videoHeight: 1080 };
      }
      case 'grid4old': {
        // Classic layout (front top + 3 bottom) → 1920×1080 + bottom bar
        const w = 1920;
        const h = 1080 + bottomBarHeight;
        return { width: w, height: h, videoHeight: 1080 };
      }
      default: {
        // Single camera: use native resolution, capped at 1920 wide
        let w = baseWidth;
        let h = baseHeight;
        if (w > 1920) {
          const scale = 1920 / w;
          w = 1920;
          h = Math.round(baseHeight * scale);
        }
        // H.264 requires even dimensions
        w = w % 2 === 0 ? w : w + 1;
        h = h % 2 === 0 ? h : h + 1;
        return { width: w, height: h + bottomBarHeight, videoHeight: h };
      }
    }
  }, [viewType]);

  // ── Screenshots ──
  const exportScreenshot = useCallback(async () => {
    try {
      const { width, height, videoHeight } = resolveCanvasSize();
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Failed to get canvas context');
      drawFrame(ctx, width, height, viewType, videoHeight);

      canvas.toBlob(
        async (blob) => {
          if (!blob) return;
          try {
            const arrayBuffer = await blob.arrayBuffer();
            const fileName = `${clip.name}-${viewType}.jpg`;
            const path = await window.electronAPI?.saveFile(fileName, arrayBuffer);
            if (path) {
              setToastMsg(t('toast.screenshotSaved'));
              window.electronAPI?.showItemInFolder(path);
            }
          } catch (e: any) {
            console.error('Save screenshot failed', e);
            setToastMsg(t('toast.saveFailed', { error: e.message }));
          }
        },
        'image/jpeg',
        0.92,
      );
    } catch (error: any) {
      console.error('Screenshot failed', error);
      setToastMsg(t('toast.screenshotFailed', { error: error.message }));
    }
  }, [clip.name, drawFrame, resolveCanvasSize, viewType]);

  const cancelExport = useCallback(() => {
    isCancelingRef.current = true;
  }, []);

  // ── CSV Export ──
  const exportCSV = useCallback(async () => {
    if (!footage.seiData || footage.seiData.length === 0) {
      setToastMsg(t('toast.noMetadata'));
      return;
    }
    try {
      const header = 'offset_s,speed_kph,gear,steering_deg,brake_pct,throttle_pct,ap_status,latitude,longitude';
      const lines = footage.seiData.map((d) =>
        [
          d.offsetSeconds.toFixed(3),
          d.speedKph.toFixed(2),
          d.gear,
          d.steeringAngleDeg.toFixed(2),
          d.brakePct.toFixed(0),
          d.throttlePct.toFixed(2),
          d.apStatus,
          d.latitude.toFixed(8),
          d.longitude.toFixed(8),
        ].join(',')
      );
      const csv = [header, ...lines].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const arrayBuffer = await blob.arrayBuffer();
      const fileName = `${clip.name}-metadata.csv`;
      const path = await window.electronAPI?.saveFile(fileName, arrayBuffer);
      if (path) {
        setToastMsg(t('toast.csvExported'));
        window.electronAPI?.showItemInFolder(path);
      }
    } catch (e: any) {
      console.error('CSV export failed', e);
      setToastMsg(t('toast.csvFailed', { error: e.message }));
    }
  }, [clip.name, footage.seiData]);

  /** Wait for a video element to have renderable frame data after seeking */
  const waitForVideoReady = (video: HTMLVideoElement, timeoutMs = 5000): Promise<void> => {
    return new Promise((resolve) => {
      if (video.readyState >= 2) { resolve(); return; }
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

  /** Convert canvas to JPEG Uint8Array for IPC transfer */
  const canvasToJpegBytes = (canvas: HTMLCanvasElement): Promise<Uint8Array> => {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) { reject(new Error('toBlob failed')); return; }
          blob.arrayBuffer().then((ab) => resolve(new Uint8Array(ab))).catch(reject);
        },
        'image/jpeg',
        0.92,
      );
    });
  };

  // ── Video Export (FFmpeg H.264) ──
  const exportCurrentView = useCallback(async () => {
    if (exporting) return;
    if (exportableSeconds <= 0) {
      setToastMsg(t('toast.noContent'));
      return;
    }
    if (!window.electronAPI?.exportStart) {
      setToastMsg(t('toast.exportFailed'));
      return;
    }

    const sessionId = `export-${Date.now()}`;
    const prevPlaybackRate = playbackRate;

    try {
      const exportStartSeconds =
        exportSelectionSeconds > 0 && exportIn !== undefined
          ? exportIn
          : clipPlayedSeconds;
      const seekInfo = calcSeekInfo(footage, exportStartSeconds);
      if (!seekInfo) throw new Error('Could not seek to export start time');

      // 1. Pause and set rate to 1x
      setPlaying(false);
      setPlaybackRate(1);

      // 2. Set segment, wait for React
      setSegmentIndex(seekInfo.index);
      await new Promise((r) => setTimeout(r, 150));

      // 3. Seek all videos and wait for frame data
      const activeVideos: HTMLVideoElement[] = [];
      for (const p of players) {
        if (p.current && p.current.src) {
          p.current.playbackRate = 1;
          p.current.currentTime = seekInfo.seconds;
          activeVideos.push(p.current);
        }
      }
      await Promise.all(activeVideos.map((v) => waitForVideoReady(v)));

      // 4. Start playback
      for (const v of activeVideos) {
        try { await v.play(); } catch (_) { /* ignore */ }
      }
      setPlaying(true);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

      // 5. Canvas setup
      const { width, height, videoHeight } = resolveCanvasSize();
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Failed to create canvas context');

      overlayRef.current = {
        time: dayjs(parseTime(footage.segments[seekInfo.index].name))
          .add(seekInfo.seconds, 'second')
          .format(timestampFmt),
        location: locationText,
      };

      const fps = 30;
      const fileName = `${clip.name}-${viewType}.mp4`;

      // 6. Start FFmpeg session (shows save dialog)
      const startResult = await window.electronAPI.exportStart({
        sessionId, fileName, width, height, fps,
      });
      if (!startResult.ok) {
        setPlaybackRate(prevPlaybackRate);
        if (startResult.error !== 'canceled') {
          setToastMsg(t('toast.exportFailedStart', { error: startResult.error || 'unknown' }));
        }
        return;
      }

      setExporting(true);
      setExportProgress(0);
      setExportFrameCount(0);
      setExportEta(undefined);
      setExportEncoding(false);
      isCancelingRef.current = false;

      // 7. Capture frames at target FPS using requestAnimationFrame
      const exportSegmentStartName = footage.segments[seekInfo.index].name;
      const exportSeekSeconds = seekInfo.seconds;
      const frameDurationMs = 1000 / fps;
      const totalFrames = Math.ceil(exportableSeconds * fps);

      const start = performance.now();
      let frameIndex = 0;

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

          const elapsed = (performance.now() - start) / 1000;
          const pct = Math.min(99, (frameIndex / totalFrames) * 100);
          setExportProgress(pct);
          setExportFrameCount(frameIndex);

          // Compute ETA
          if (frameIndex > 5 && elapsed > 0) {
            const framesPerSec = frameIndex / elapsed;
            const remaining = (totalFrames - frameIndex) / framesPerSec;
            if (remaining > 60) {
              setExportEta(`${Math.floor(remaining / 60)}m ${Math.round(remaining % 60)}s`);
            } else {
              setExportEta(`${Math.round(remaining)}s`);
            }
          }

          // Update overlay time
          const currentExportTime = dayjs(parseTime(exportSegmentStartName))
            .add(exportSeekSeconds + elapsed, 'second')
            .format(timestampFmt);
          overlayRef.current = { time: currentExportTime, location: locationText };

          // Draw and capture frame
          drawFrame(ctx, width, height, viewType, videoHeight);
          const jpegBytes = await canvasToJpegBytes(canvas);
          await window.electronAPI!.exportFrame(sessionId, jpegBytes);

          frameIndex++;

          // Wait for next frame timing
          const nextFrameTime = start + frameIndex * frameDurationMs;
          const waitMs = nextFrameTime - performance.now();
          if (waitMs > 0) {
            await new Promise((r) => setTimeout(r, waitMs));
          } else {
            // Yield to browser to keep UI responsive
            await new Promise((r) => requestAnimationFrame(r));
          }
        }

        // 8. Finish encoding
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

      captureLoop().catch((err) => {
        console.error('Export loop failed:', err);
        window.electronAPI?.exportCancel(sessionId);
        setExporting(false);
        setPlaying(false);
        setPlaybackRate(prevPlaybackRate);
        setToastMsg(t('toast.exportError', { error: err.message }));
      });
    } catch (e: any) {
      console.error('Export start failed', e);
      setExporting(false);
      setPlaybackRate(prevPlaybackRate);
      setToastMsg(t('toast.exportFailedStart', { error: e.message }));
    }
  }, [
    clip.name, footage, clipPlayedSeconds, exportIn, exportSelectionSeconds,
    exportableSeconds, exporting, playbackRate, drawFrame, locationText,
    resolveCanvasSize, viewType, players, t, timestampFmt,
  ]);

  // ── Map Links ──
  const mapLinks = useMemo(() => {
    if (!clip.event) return [];
    return genAllMapLinks(clip.event);
  }, [clip.event]);

  // ── Grid CSS class ──
  const gridClass = useMemo(() => {
    switch (viewType) {
      case 'grid6': return 'grid grid-cols-3 grid-rows-2';
      case 'grid4': return 'grid grid-cols-2 grid-rows-2';
      case 'grid4old': return 'flex flex-col';
      default: return 'flex items-center justify-center';
    }
  }, [viewType]);

  // ── Render helpers for each layout ──
  const renderPlayer = useCallback((cam: CamName, extraClass?: string) => (
    <Player
      key={cam}
      videoRef={refMap[cam]}
      url={segment[cam]}
      playing={playing}
      playbackRate={playbackRate}
      full={isSingleView && viewType === cam}
      className={extraClass}
      label={isSingleView ? undefined : CAM_LABELS[cam]}
      onChangeState={handleChangeState}
      unique={cam}
      index={segmentIndex}
      onDoubleClick={() =>
        setViewType(isSingleView ? (hasPillarCams ? 'grid6' : 'grid4') : cam)
      }
    />
  ), [segment, playing, playbackRate, isSingleView, viewType, handleChangeState, segmentIndex, refMap, hasPillarCams]);

  return (
    <div className="animate-fade-in flex h-full min-h-0 flex-col gap-3">
      <Toast message={toastMsg} onClose={() => setToastMsg(null)} />
      <ExportModal
        open={exporting}
        progress={exportProgress}
        frameCount={exportFrameCount}
        eta={exportEta}
        encoding={exportEncoding}
        onCancel={cancelExport}
      />

      {/* Header Overlays */}
      <div className="pointer-events-none absolute top-6 left-6 z-20 flex flex-col gap-1 drop-shadow-lg">
        <div className="text-2xl font-bold tracking-wide text-white">{formatTime}</div>
        <div className="text-base font-medium text-neutral-300">{locationText}</div>
      </div>

      <div className="absolute top-6 right-6 z-20 flex items-center gap-2">
        {mapLinks.map((link) => (
          <a
            key={link.provider}
            href={link.url}
            target="_blank"
            rel="noreferrer"
            className="glass-panel rounded-md px-3 py-1.5 text-xs font-medium text-neutral-300 transition-colors hover:bg-white/10 hover:text-white"
          >
            {link.label}
          </a>
        ))}
        <button
          onClick={togglePiP}
          className="glass-panel rounded-md px-2 py-1.5 text-neutral-300 transition-colors hover:bg-white/10 hover:text-white"
          title="Picture in Picture (P)"
        >
          <MdPictureInPicture size={16} />
        </button>
        <button
          onClick={exportScreenshot}
          className="glass-panel rounded-md px-3 py-1.5 text-xs font-medium text-neutral-300 transition-colors hover:bg-white/10 hover:text-white"
        >
          {t('viewer.snapshot')}
        </button>
        {hasMetadata && (
          <button
            onClick={exportCSV}
            className="glass-panel rounded-md px-3 py-1.5 text-xs font-medium text-neutral-300 transition-colors hover:bg-white/10 hover:text-white"
          >
            {t('viewer.exportCsv')}
          </button>
        )}
      </div>

      {/* Main Stage */}
      <div className="relative flex-1 overflow-hidden rounded-xl bg-black shadow-2xl ring-1 ring-white/10">
        {/* Dashboard overlay (right side) */}
        <Dashboard data={currentSEI} hasMetadata={hasMetadata} />

        {/* Video Grid */}
        <div className={clsx('h-full w-full', gridClass)}>
          {viewType === 'grid6' && (
            <>
              {renderPlayer('left', 'border-r border-b border-white/5')}
              {renderPlayer('front', 'border-r border-b border-white/5')}
              {renderPlayer('right', 'border-b border-white/5')}
              {renderPlayer('left_pillar', 'border-r border-white/5')}
              {renderPlayer('back', 'border-r border-white/5')}
              {renderPlayer('right_pillar')}
            </>
          )}

          {viewType === 'grid4' && (
            <>
              {renderPlayer('front', 'border-r border-b border-white/5')}
              {renderPlayer('back', 'border-b border-white/5')}
              {renderPlayer('left', 'border-r border-white/5')}
              {renderPlayer('right')}
            </>
          )}

          {viewType === 'grid4old' && (
            <>
              {/* Top: front camera — takes 60% height, full width */}
              <div className="relative h-[60%] w-full border-b border-white/5">
                {renderPlayer('front')}
              </div>
              {/* Bottom: 3 cameras side by side — takes 40% height */}
              <div className="flex h-[40%] w-full">
                <div className="relative h-full w-1/3 border-r border-white/5">
                  {renderPlayer('left')}
                </div>
                <div className="relative h-full w-1/3 border-r border-white/5">
                  {renderPlayer('back')}
                </div>
                <div className="relative h-full w-1/3">
                  {renderPlayer('right')}
                </div>
              </div>
            </>
          )}

          {isSingleView && renderPlayer(viewType as CamName)}
        </div>

        {/* Hidden players for cameras not in current layout (keep them mounted for sync) */}
        <div className="hidden">
          {ALL_CAMS.filter((c) => !visibleCams.includes(c)).map((cam) => (
            <Player
              key={`hidden-${cam}`}
              videoRef={refMap[cam]}
              url={segment[cam]}
              playing={playing}
              playbackRate={playbackRate}
              onChangeState={handleChangeState}
              unique={cam}
              index={segmentIndex}
            />
          ))}
        </div>
      </div>

      {/* View Switcher */}
      <div className="flex justify-center gap-1.5 flex-wrap">
        {availableLayouts.map((opt) => (
          <button
            key={opt.id}
            onClick={() => setViewType(opt.id)}
            className={clsx(
              'rounded-full border px-3 py-1 text-[11px] font-medium tracking-wider uppercase transition-all',
              viewType === opt.id
                ? 'border-white bg-white text-black'
                : 'bg-surface-panel border-white/5 text-neutral-500 hover:border-white/20 hover:text-neutral-300',
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Control Bar */}
      <div className="glass-panel mx-auto flex w-full max-w-4xl flex-col gap-3 rounded-2xl p-4">
        {/* Timeline */}
        <div className="flex items-center gap-3 text-xs font-medium text-neutral-500">
          <span>{formatDuration(clipPlayedSeconds)}</span>
          <div className="flex-1">
            <Progress
              value={clipPlayedSeconds}
              max={footage.duration}
              mark={eventSeconds}
              exportIn={exportIn}
              exportOut={exportOut}
              speedData={footage.seiData}
              onChange={seek}
            />
          </div>
          <span>{formatDuration(footage.duration)}</span>
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
                title="Set In point (I)"
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
                title="Set Out point (O)"
              >
                OUT {formatExportPoint(exportOut)}
              </button>
              {(exportIn !== undefined || exportOut !== undefined) && (
                <button
                  onClick={() => { setExportIn(undefined); setExportOut(undefined); }}
                  className="rounded px-1.5 py-1 text-[10px] text-neutral-600 hover:text-neutral-300"
                  title={t('viewer.clearInOut')}
                >
                  ✕
                </button>
              )}
            </div>
            <button
              onClick={exportCurrentView}
              disabled={exporting || exportableSeconds <= 0}
              className="bg-brand-primary disabled:hover:bg-brand-primary flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs text-white transition-colors hover:bg-red-600 disabled:opacity-50"
            >
              {exporting ? t('viewer.exporting') : t('viewer.exportClip')}
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
                title="Play/Pause (Space)"
              >
                {playing ? <IoPause size={24} /> : <IoPlay size={24} />}
              </button>
            )}
            <IconBtn onClick={() => jump(15)}>
              <RiForward15Fill size={20} />
            </IconBtn>
          </div>

          {/* Right: Event Jump & Speed & Shortcuts */}
          <div className="flex items-center gap-3">
            {eventSeconds !== undefined && (
              <button
                onClick={() => seek(eventSeconds)}
                className="text-brand-primary text-xs font-medium tracking-wider uppercase hover:text-red-400"
              >
                {t('viewer.jumpToEvent')}
              </button>
            )}
            <Rate value={playbackRate} onChange={setPlaybackRate} />
            <button
              onClick={() => setMuted((m) => !m)}
              className="rounded-lg p-2 text-neutral-400 transition-colors hover:bg-white/10 hover:text-white"
              title={muted ? t('viewer.unmute') : t('viewer.mute')}
            >
              {muted ? <IoVolumeMute size={18} /> : <IoVolumeHigh size={18} />}
            </button>
          </div>
        </div>

        {/* Keyboard shortcuts — hover tooltip */}
        <div className="group/kb relative flex justify-center">
          <span className="cursor-default text-[10px] text-neutral-600 transition-colors group-hover/kb:text-neutral-400">
            ⌨
          </span>
          <div className="pointer-events-none absolute bottom-full left-1/2 z-40 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-neutral-900 px-4 py-2 shadow-xl ring-1 ring-white/10 group-hover/kb:block">
            <div className="flex gap-4 text-[10px] text-neutral-400">
              <span>{t('viewer.hint.playPause')}</span>
              <span>{t('viewer.hint.seek')}</span>
              <span>M: {t('viewer.mute')}</span>
              <span>{t('viewer.hint.fullscreen')}</span>
              <span>{t('viewer.hint.pip')}</span>
              <span>{t('viewer.hint.inOut')}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
