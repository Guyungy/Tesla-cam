import clsx from 'clsx';
import dayjs from 'dayjs';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  IoPause,
  IoPlay,
  IoTrashOutline,
  IoVolumeHigh,
  IoVolumeMute,
} from 'react-icons/io5';
import { MdPictureInPicture, MdReplay } from 'react-icons/md';

import { type TranslationKey, useI18n } from '../i18n';
import {
  calcEventSeconds,
  calcSeekInfo,
  type CamClip,
  type CamFootage,
  type CamName,
  type DeleteResult,
  deleteResultToast,
  formatDuration,
  genAllMapLinks,
  parseTime,
  type PlayerState,
  resolveExportCanvasSize,
  resolveOverlayBarLayout,
  type SeekInfo,
  type ViewType,
} from '../utils';
import { Dashboard } from './Dashboard';
import { ExportModal } from './ExportModal';
import { IconBtn } from './IconBtn';
import { Player } from './Player';
import { Progress } from './Progress';
import { Rate } from './Rate';
import { Toast } from './Toast';
import { TrackMap } from './TrackMap';
import { useAppSettings } from './useAppSettings';
import { useExportSettings } from './useExportSettings';
import { useSeiTelemetry } from './viewer/useSeiTelemetry';
import { useVideoExport } from './viewer/useVideoExport';

type Props = {
  clip: CamClip;
  footage: CamFootage;
  /** Callback to update footage with SEI data once loaded */
  onFootageUpdate?: (footage: CamFootage) => void;
  onDelete?: (clip: CamClip) => Promise<DeleteResult | undefined>;
  /** Fired once when playback reaches the end of the whole clip */
  onClipEnded?: () => void;
};

const TESLA_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 50"><path d="M40 2L10 2C9.445 2 9 2.449 9 3L9 47C9 47.551 9.445 48 10 48L40 48C40.555 48 41 47.551 41 47L41 3C41 2.449 40.555 2 40 2ZM23.137 10.094C24.375 10.063 25.625 10.063 26.867 10.094C30.074 10.176 33.285 10.515 36.309 11.539L35.633 12.531C33.074 11.633 30.035 11.199 26.828 11.105C25.617 11.066 24.383 11.066 23.172 11.105C19.965 11.199 16.93 11.633 14.367 12.531L13.695 11.539C16.719 10.515 19.926 10.176 23.137 10.094ZM17.086 37.078C17.02 37.359 16.793 37.594 16.484 37.715L15.547 37.715L15.492 37.738L15.492 40.27L14.906 40.27L14.906 37.738L14.859 37.715L13.922 37.715C13.613 37.594 13.387 37.359 13.32 37.078L13.32 37.074L17.086 37.074ZM21.34 40.266L19.113 40.266C18.801 40.141 18.57 39.906 18.508 39.625L21.941 39.625C21.879 39.906 21.652 40.141 21.34 40.266ZM21.34 38.965L19.113 38.965C18.801 38.844 18.57 38.605 18.508 38.328L21.941 38.328C21.879 38.605 21.652 38.844 21.34 38.965ZM21.34 37.727L19.113 37.727C18.801 37.602 18.57 37.367 18.508 37.086L21.941 37.086C21.879 37.367 21.652 37.602 21.34 37.727ZM26.867 40.27L23.617 40.27L23.629 40.246C23.691 39.965 23.918 39.75 24.223 39.625L26.289 39.625L26.289 38.965L23.617 38.965L23.617 37.078L26.852 37.078C26.785 37.359 26.559 37.609 26.25 37.703L24.191 37.703L24.191 38.336L26.867 38.336ZM31.16 40.246L28.523 40.238L28.523 37.078L29.102 37.074L29.098 39.617L31.668 39.617C31.605 39.883 31.449 40.113 31.16 40.246ZM28.453 13.633L25 32.164L21.547 13.633C19.699 13.633 17.781 13.918 17.73 15.277C16.863 15.059 15.281 14.074 14.918 13.383C17.555 12.316 21.902 12.176 23.789 12.246L25 13.8L26.211 12.246C28.098 12.176 32.449 12.316 35.086 13.383C34.719 14.074 33.137 15.059 32.266 15.277C32.219 13.918 30.297 13.633 28.453 13.633ZM36.602 40.258L36.027 40.258L36.027 38.969L33.934 38.969L33.934 40.258L33.355 40.258L33.355 38.32L36.602 38.324ZM36.086 37.711L33.859 37.711C33.547 37.586 33.305 37.363 33.246 37.082L36.68 37.082C36.617 37.363 36.398 37.586 36.086 37.711Z" fill="white"/></svg>`;
const TESLA_ICON_DATA_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(TESLA_ICON_SVG)}`;

/** All 6 camera names */
const ALL_CAMS: CamName[] = [
  'front',
  'back',
  'left',
  'right',
  'left_pillar',
  'right_pillar',
];

/** Extract a human-readable message from an unknown thrown value. */
function errText(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

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
const CAM_I18N_KEYS: Record<CamName, TranslationKey> = {
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

export function Viewer({
  clip,
  footage,
  onFootageUpdate,
  onDelete,
  onClipEnded,
}: Props) {
  const { t } = useI18n();
  const { exportSettings } = useExportSettings();
  const { appSettings, setAppSettings } = useAppSettings();

  // ── Video Refs (6 cameras) ──
  const frontRef = useRef<HTMLVideoElement>(null);
  const backRef = useRef<HTMLVideoElement>(null);
  const leftRef = useRef<HTMLVideoElement>(null);
  const rightRef = useRef<HTMLVideoElement>(null);
  const leftPillarRef = useRef<HTMLVideoElement>(null);
  const rightPillarRef = useRef<HTMLVideoElement>(null);

  const refMap: Record<
    CamName,
    React.RefObject<HTMLVideoElement | null>
  > = useMemo(
    () => ({
      front: frontRef,
      back: backRef,
      left: leftRef,
      right: rightRef,
      left_pillar: leftPillarRef,
      right_pillar: rightPillarRef,
    }),
    [],
  );

  const players = useMemo(() => Object.values(refMap), [refMap]);

  // ── Playing State ──
  const [statesMap, setStateMap] = useState<Record<CamName, PlayerState>>(
    () => ({
      back: {},
      front: {},
      left: {},
      right: {},
      left_pillar: {},
      right_pillar: {},
    }),
  );
  const handleChangeState = useCallback((key: CamName, val: PlayerState) => {
    setStateMap((s) => ({ ...s, [key]: val }));
  }, []);
  const states = useMemo(() => Object.values(statesMap), [statesMap]);

  // ── Segment Control ──
  const [segmentIndex, setSegmentIndex] = useState(0);
  const segmentIndexRef = useRef(0);
  const segment = footage.segments[segmentIndex];
  const isLastSegment = segmentIndex === footage.segments.length - 1;
  const isSegmentsEnded = states.every(
    (i) => i.index === segmentIndex && i.ended,
  );

  useEffect(() => {
    segmentIndexRef.current = segmentIndex;
  }, [segmentIndex]);

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

  // ── SEI telemetry (lazy extraction + playhead sample + drive windows) ──
  const {
    seiSeries,
    hasRealMetadata,
    currentSEI,
    buildDriveWindows,
    incidentMarks,
  } = useSeiTelemetry({ clip, footage, onFootageUpdate, clipPlayedSeconds });
  const hasMetadata = hasRealMetadata;

  // ── Overlay ref for drawFrame (avoids stale closure) ──
  const overlayRef = useRef({
    time: formatTime,
    location: locationText,
    sei: currentSEI,
    settings: exportSettings,
    t,
  });
  const teslaIconRef = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    overlayRef.current = {
      time: formatTime,
      location: locationText,
      sei: currentSEI,
      settings: exportSettings,
      t,
    };
  }, [formatTime, locationText, currentSEI, exportSettings, t]);
  useEffect(() => {
    const image = new Image();
    image.src = TESLA_ICON_DATA_URL;
    teslaIconRef.current = image;
  }, []);

  // ── Controls ──
  const [playing, setPlaying] = useState(true);
  const [playbackRate, setPlaybackRate] = useState(1);
  const isClipEnded = isSegmentsEnded && isLastSegment;

  const replay = () => {
    setSegmentIndex(0);
    setPlaying(true);
  };

  // Notify parent exactly once when the whole clip finishes (auto-advance)
  const clipEndedNotifiedRef = useRef(false);
  useEffect(() => {
    if (!isClipEnded) {
      clipEndedNotifiedRef.current = false;
      return;
    }
    if (clipEndedNotifiedRef.current) return;
    clipEndedNotifiedRef.current = true;
    onClipEnded?.();
  }, [isClipEnded, onClipEnded]);
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

  /**
   * Frame-accurate step (~1/30s). Reads the live element time — the throttled
   * state can lag up to 120ms, which would make steps land unpredictably.
   */
  const stepFrame = useCallback(
    (dir: 1 | -1) => {
      setPlaying(false);
      const video = players.find((p) => p.current)?.current;
      const segSeconds = video ? video.currentTime : segmentPlayedSeconds;
      seek(segment.startSeconds + segSeconds + dir / 30);
    },
    [players, segment.startSeconds, segmentPlayedSeconds, seek],
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
      const video = i.current;
      if (!video) return;
      if (video.readyState >= 1) {
        video.currentTime = seekTask.seconds;
      } else {
        // Not loaded yet (fresh mount / segment switch): setting currentTime
        // now can be silently lost — apply it once metadata arrives.
        const target = seekTask.seconds;
        video.addEventListener(
          'loadedmetadata',
          () => {
            video.currentTime = target;
          },
          { once: true },
        );
      }
    });
    setSeekTask(undefined);
  }, [players, seekTask, states]);

  // ── Auto-seek: open event clips just before the recorded moment ──
  // calcEventSeconds already includes the pre-roll (AEB −3s, others −5s).
  useEffect(() => {
    if (!appSettings.autoSeekEvent) return;
    if (eventSeconds === undefined || eventSeconds <= 0) return;
    seek(eventSeconds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Once per clip (Viewer remounts per clip via key)

  // ── Sentry focus: the event.json `camera` field says which camera fired ──
  // Mapping per community-documented TeslaCam values; unknown values fall
  // back to the normal grid so a wrong guess can never hide footage.
  const sentryCam = useMemo<CamName | undefined>(() => {
    if (clip.type !== 'sentry') return undefined;
    const map: Record<string, CamName> = {
      '0': 'front',
      '3': 'left',
      '4': 'right',
      '5': 'back',
    };
    const cam = map[clip.event?.camera ?? ''];
    if (cam && footage.segments.some((s) => s[cam])) return cam;
    return undefined;
  }, [clip.type, clip.event?.camera, footage.segments]);

  // ── View Type (sentry trigger camera > user preference > default) ──
  const defaultView: ViewType = hasPillarCams ? 'grid6' : 'grid4';
  const [viewType, setViewTypeState] = useState<ViewType>(() => {
    if (appSettings.sentryCameraFocus && sentryCam) return sentryCam;
    const preferred = appSettings.preferredView;
    if (!preferred) return defaultView;
    // Pillar-cam layouts fall back gracefully when the clip lacks those cams
    if (
      !hasPillarCams &&
      (preferred === 'grid6' || preferred.includes('pillar'))
    ) {
      return defaultView;
    }
    return preferred;
  });
  const setViewType = useCallback(
    (v: ViewType) => {
      setViewTypeState(v);
      setAppSettings({ preferredView: v });
    },
    [setAppSettings],
  );

  // Determine which cameras are visible in current layout
  const visibleCams: CamName[] = useMemo(() => {
    switch (viewType) {
      case 'grid6':
        return ALL_CAMS;
      case 'grid4':
        return ['front', 'back', 'left', 'right'];
      case 'grid4old':
        return ['front', 'back', 'left', 'right'];
      default:
        return [viewType as CamName];
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
  // Re-sync on segment/layout change too: newly-mounted or reloaded <video>
  // elements start muted (attribute), so an unmuted state must be re-applied.
  useEffect(() => {
    players.forEach((p) => {
      if (p.current) p.current.muted = muted;
    });
  }, [muted, players, segmentIndex, viewType]);

  // ── UI feedback state (export state itself lives in useVideoExport) ──
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

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
        cx: number,
        cy: number,
        cw: number,
        ch: number,
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

      // ── Camera labels overlay (on each cell) ──
      const { t: tFn } = overlayRef.current;
      const scale = width / 1280;
      const labelFontSize = Math.max(11, Math.round(14 * scale));
      const labelPad = Math.round(8 * scale);
      ctx.font = `500 ${labelFontSize}px "Inter", "SF Pro Display", "Segoe UI", sans-serif`;

      const drawCamLabel = (
        cam: CamName,
        x: number,
        y: number,
        w: number,
        h: number,
      ) => {
        const label = tFn(CAM_I18N_KEYS[cam]);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        const tw = ctx.measureText(label).width;
        const lx = x + w - tw - labelPad * 2;
        const ly = y + h - labelFontSize - labelPad * 1.5;
        ctx.fillRect(lx, ly, tw + labelPad * 2, labelFontSize + labelPad * 1.5);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.fillText(label, lx + labelPad, ly + labelFontSize + labelPad * 0.3);
      };

      // Draw camera labels based on layout
      switch (layout) {
        case 'grid6': {
          const cellW = width / 3,
            cellH = vH / 2;
          drawCamLabel('left', 0, 0, cellW, cellH);
          drawCamLabel('front', cellW, 0, cellW, cellH);
          drawCamLabel('right', cellW * 2, 0, cellW, cellH);
          drawCamLabel('left_pillar', 0, cellH, cellW, cellH);
          drawCamLabel('back', cellW, cellH, cellW, cellH);
          drawCamLabel('right_pillar', cellW * 2, cellH, cellW, cellH);
          break;
        }
        case 'grid4': {
          const halfW = width / 2,
            halfH = vH / 2;
          drawCamLabel('front', 0, 0, halfW, halfH);
          drawCamLabel('back', halfW, 0, halfW, halfH);
          drawCamLabel('left', 0, halfH, halfW, halfH);
          drawCamLabel('right', halfW, halfH, halfW, halfH);
          break;
        }
        case 'grid4old': {
          const topH = vH * 0.6,
            botH = vH - topH;
          const thirdW = width / 3;
          drawCamLabel('front', 0, 0, width, topH);
          drawCamLabel('left', 0, topH, thirdW, botH);
          drawCamLabel('back', thirdW, topH, thirdW, botH);
          drawCamLabel('right', thirdW * 2, topH, thirdW, botH);
          break;
        }
        default:
          drawCamLabel(layout as CamName, 0, 0, width, vH);
      }

      // ── Driving data overlay (top) ──
      const { settings, sei } = overlayRef.current;
      if (settings.showDriveData && sei) {
        const topBarH = Math.round(50 * scale);
        const tp = Math.round(12 * scale);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(0, 0, width, topBarH);

        // Speed (large, centered)
        const speedVal = sei.speedKph != null ? Math.round(sei.speedKph) : '--';
        const speedColor =
          sei.speedKph != null
            ? sei.speedKph > 120
              ? '#ef4444'
              : sei.speedKph > 80
                ? '#eab308'
                : '#22c55e'
            : '#a3a3a3';
        const speedSize = Math.max(24, Math.round(36 * scale));
        ctx.font = `bold ${speedSize}px "Inter", "SF Pro Display", "Segoe UI", sans-serif`;
        ctx.fillStyle = speedColor;
        const speedText = `${speedVal}`;
        const speedW = ctx.measureText(speedText).width;
        ctx.fillText(
          speedText,
          (width - speedW) / 2,
          topBarH / 2 + speedSize * 0.35,
        );

        // Unit
        const unitSize = Math.max(10, Math.round(12 * scale));
        ctx.font = `500 ${unitSize}px "Inter", "SF Pro Display", "Segoe UI", sans-serif`;
        ctx.fillStyle = '#737373';
        ctx.fillText(
          'km/h',
          (width - speedW) / 2 + speedW + tp,
          topBarH / 2 + unitSize * 0.3,
        );

        // Gear (left side)
        const gearSize = Math.max(16, Math.round(22 * scale));
        ctx.font = `bold ${gearSize}px "Inter", "SF Pro Display", "Segoe UI", sans-serif`;
        const gearColors: Record<string, string> = {
          D: '#22c55e',
          R: '#ef4444',
          N: '#eab308',
          P: '#737373',
        };
        ctx.fillStyle = gearColors[sei.gear] || '#737373';
        ctx.fillText(sei.gear, tp * 2, topBarH / 2 + gearSize * 0.3);

        // AP status (right side)
        if (sei.apStatus && sei.apStatus !== 'UNKNOWN') {
          const apSize = Math.max(10, Math.round(12 * scale));
          ctx.font = `600 ${apSize}px "Inter", "SF Pro Display", "Segoe UI", sans-serif`;
          const apColors: Record<string, string> = {
            AP: '#3b82f6',
            FSD: '#6366f1',
            STANDBY: '#eab308',
            OFF: '#737373',
          };
          ctx.fillStyle = apColors[sei.apStatus] || '#737373';
          const apText = sei.apStatus;
          const apW = ctx.measureText(apText).width;
          ctx.fillText(
            apText,
            width - tp * 2 - apW,
            topBarH / 2 + apSize * 0.3,
          );
        }
      }

      // ── Bottom info bar (polished design) ──
      const barHeight = height - vH;
      if (barHeight > 0) {
        const { time, location, settings: sett } = overlayRef.current;
        const barY = vH;

        // Gradient bar background
        const grad = ctx.createLinearGradient(0, barY, 0, height);
        grad.addColorStop(0, '#111111');
        grad.addColorStop(1, '#0a0a0a');
        ctx.fillStyle = grad;
        ctx.fillRect(0, barY, width, barHeight);

        // Top accent line
        ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.fillRect(0, barY, width, 1);

        // Metrics come from the same helper that sized the bar, so the stack
        // (padding · brand · gap · timestamp · padding) always fits inside it.
        const { padding, brandSize, titleSize, subSize, gap, iconSize } =
          resolveOverlayBarLayout(scale);
        const hPad = Math.round(22 * scale);
        const leftTextX = hPad + iconSize + Math.round(16 * scale);
        const brandY = barY + padding;
        const titleTop = brandY + brandSize + gap;

        const iconImage = teslaIconRef.current;
        if (iconImage?.complete) {
          const iconX = hPad;
          const iconY = barY + (barHeight - iconSize) / 2;
          ctx.fillStyle = 'rgba(225, 29, 72, 0.12)';
          ctx.fillRect(
            iconX - Math.round(8 * scale),
            iconY - Math.round(6 * scale),
            iconSize + Math.round(16 * scale),
            iconSize + Math.round(12 * scale),
          );
          ctx.drawImage(iconImage, iconX, iconY, iconSize, iconSize);
        }

        ctx.textBaseline = 'top';

        if (sett.showTime) {
          ctx.fillStyle = '#fb7185';
          ctx.font = `700 ${brandSize}px "Aptos", "Segoe UI Variable Display", "Segoe UI", sans-serif`;
          ctx.fillText('TESLA CINEMA', leftTextX, brandY);

          ctx.fillStyle = '#fafafa';
          ctx.font = `700 ${titleSize}px "Aptos Display", "Segoe UI Variable Display", "Segoe UI", sans-serif`;
          ctx.fillText(time, leftTextX, titleTop);
        }

        if (sett.showLocation) {
          ctx.font = `500 ${subSize}px "Aptos", "Segoe UI Variable Text", "Segoe UI", sans-serif`;
          const locWidth = ctx.measureText(location).width;
          const accentW = Math.max(3, Math.round(4 * scale));
          const accentH = Math.max(18, Math.round(22 * scale));
          const locX = width - hPad - locWidth;
          const locY = barY + (barHeight - subSize) / 2 + Math.round(1 * scale);
          const accentX = locX - Math.round(16 * scale);
          const accentY = barY + (barHeight - accentH) / 2;

          ctx.fillStyle = '#ef4444';
          ctx.fillRect(accentX, accentY, accentW, accentH);

          ctx.fillStyle = '#d4d4d8';
          ctx.fillText(location, locX, locY);
        }

        ctx.textBaseline = 'alphabetic';
      }
    },
    [refMap, overlayRef],
  );

  /**
   * Resolve export canvas size. Grid layouts are capped at 4K wide instead of
   * multiplying the native source size (6-grid from 2896x1876 footage was
   * allocating 8688x3812 — 33 MP, ~1 s per JPEG encode). Geometry and the
   * bottom-bar height live in resolveExportCanvasSize so they stay in sync
   * with drawFrame and are covered by tests.
   */
  const resolveCanvasSize = useCallback(
    (maxWidth?: number) => {
      const visibleVideoRefs = visibleCams
        .map((cam) => refMap[cam]?.current)
        .filter(
          (video): video is HTMLVideoElement =>
            !!video?.videoWidth && !!video?.videoHeight,
        );
      const baseVideo =
        visibleVideoRefs[0] || frontRef.current || backRef.current;

      return resolveExportCanvasSize({
        viewType,
        sourceWidth: baseVideo?.videoWidth || 1280,
        sourceHeight: baseVideo?.videoHeight || 720,
        maxWidth,
      });
    },
    [viewType, refMap, visibleCams],
  );

  // ── Video Export (compose fast path + canvas fallback) ──
  const setOverlayTimeLocation = useCallback(
    (time: string, location: string) => {
      overlayRef.current = { ...overlayRef.current, time, location };
    },
    [],
  );

  const localizedCamLabels = useMemo(
    () =>
      Object.fromEntries(
        ALL_CAMS.map((cam) => [cam, t(CAM_I18N_KEYS[cam])]),
      ) as Record<CamName, string>,
    [t],
  );

  const {
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
    exportableSeconds,
    exportCurrentView,
    cancelExport,
  } = useVideoExport({
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
    camLabels: localizedCamLabels,
    buildDriveWindows,
    exportSettings,
    t,
    setToastMsg,
  });

  // ── Keyboard Shortcuts ──
  const handleKeyboardControl = useCallback(
    (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
        return;

      switch (event.code) {
        case 'Space':
          event.preventDefault();
          setPlaying((p) => !p);
          break;
        case 'ArrowLeft':
          event.preventDefault();
          jump(event.shiftKey ? -1 : -5);
          break;
        case 'ArrowRight':
          event.preventDefault();
          jump(event.shiftKey ? 1 : 5);
          break;
        case 'Comma':
          // Frame step back — pauses playback for precise scrubbing
          event.preventDefault();
          stepFrame(-1);
          break;
        case 'Period':
          // Frame step forward
          event.preventDefault();
          stepFrame(1);
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
    [jump, stepFrame, togglePiP, markExportIn, markExportOut],
  );
  useEffect(() => {
    window.addEventListener('keydown', handleKeyboardControl);
    return () => window.removeEventListener('keydown', handleKeyboardControl);
  }, [handleKeyboardControl]);

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
            const path = await window.electronAPI?.saveFile(
              fileName,
              arrayBuffer,
            );
            if (path) {
              setToastMsg(t('toast.screenshotSaved'));
              window.electronAPI?.showItemInFolder(path);
            }
          } catch (e) {
            console.error('Save screenshot failed', e);
            setToastMsg(t('toast.saveFailed', { error: errText(e) }));
          }
        },
        'image/jpeg',
        0.92,
      );
    } catch (error) {
      console.error('Screenshot failed', error);
      setToastMsg(t('toast.screenshotFailed', { error: errText(error) }));
    }
  }, [clip.name, drawFrame, resolveCanvasSize, viewType, t]);

  const deleteClip = useCallback(async () => {
    if (!onDelete || deleting || exporting) return;
    setDeleting(true);
    try {
      const result = await onDelete(clip);
      if (!result?.ok && !result?.canceled) {
        setToastMsg(
          t('toast.deleteFailed', { error: result?.error || 'unknown' }),
        );
        return;
      }
      if (result?.ok) {
        const toast = deleteResultToast(result);
        setToastMsg(t(toast.key, toast.params));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown';
      setToastMsg(t('toast.deleteFailed', { error: message }));
    } finally {
      setDeleting(false);
    }
  }, [clip, deleting, exporting, onDelete, t]);

  // ── CSV Export ──
  const exportCSV = useCallback(async () => {
    if (!footage.seiData || footage.seiData.length === 0) {
      setToastMsg(t('toast.noMetadata'));
      return;
    }
    try {
      const header =
        'offset_s,speed_kph,gear,steering_deg,brake_pct,throttle_pct,ap_status,latitude,longitude';
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
        ].join(','),
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
    } catch (e) {
      console.error('CSV export failed', e);
      setToastMsg(t('toast.csvFailed', { error: errText(e) }));
    }
  }, [clip.name, footage.seiData, t]);

  // ── Map Links ──
  const mapLinks = useMemo(() => {
    if (!clip.event) return [];
    return genAllMapLinks(clip.event);
  }, [clip.event]);

  // ── Grid CSS class ──
  const gridClass = useMemo(() => {
    switch (viewType) {
      case 'grid6':
        return 'grid grid-cols-3 grid-rows-2';
      case 'grid4':
        return 'grid grid-cols-2 grid-rows-2';
      case 'grid4old':
        return 'flex flex-col';
      default:
        return 'flex items-center justify-center';
    }
  }, [viewType]);

  // ── Render helpers for each layout ──
  const renderPlayer = useCallback(
    (cam: CamName, extraClass?: string) => (
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
    ),
    [
      segment,
      playing,
      playbackRate,
      isSingleView,
      viewType,
      handleChangeState,
      segmentIndex,
      refMap,
      hasPillarCams,
      setViewType,
    ],
  );

  return (
    <div className="animate-fade-in relative flex h-full min-h-0 flex-col gap-3">
      <Toast message={toastMsg} onClose={() => setToastMsg(null)} />
      <ExportModal
        open={exporting}
        progress={exportProgress}
        frameCount={exportFrameCount}
        eta={exportEta}
        encoding={exportEncoding}
        onCancel={cancelExport}
      />

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
          onClick={deleteClip}
          disabled={deleting || exporting}
          className="glass-panel rounded-md px-3 py-1.5 text-xs font-medium text-neutral-300 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="inline-flex items-center gap-1.5">
            <IoTrashOutline size={14} />
            {deleting ? t('viewer.deleting') : t('viewer.deleteClip')}
          </span>
        </button>
        <button
          onClick={exportScreenshot}
          className="glass-panel rounded-md px-3 py-1.5 text-xs font-medium text-neutral-300 transition-colors hover:bg-white/10 hover:text-white"
        >
          {t('viewer.snapshot')}
        </button>
        {hasRealMetadata && (
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
        {/* GPS track panel (renders only when the clip has GPS data) */}
        <TrackMap data={seiSeries} playedSeconds={clipPlayedSeconds} />

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

      {/* Driving telemetry strip */}
      <Dashboard
        data={currentSEI}
        hasMetadata={hasMetadata}
        timeText={formatTime}
        locationText={locationText}
        variant="bar"
      />

      {/* View Switcher */}
      <div className="flex flex-wrap justify-center gap-1.5">
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
      <div className="glass-panel mx-auto flex w-full max-w-6xl flex-col gap-3 rounded-2xl p-4">
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
              speedData={seiSeries}
              warnMarks={incidentMarks}
              warnLabel={t('viewer.hardBraking')}
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
                  onClick={() => {
                    setExportIn(undefined);
                    setExportOut(undefined);
                  }}
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
            <IconBtn onClick={() => jump(-5)}>
              <span className="text-sm font-semibold tabular-nums">-5s</span>
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
            <IconBtn onClick={() => jump(5)}>
              <span className="text-sm font-semibold tabular-nums">+5s</span>
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
          <div className="pointer-events-none absolute bottom-full left-1/2 z-40 mb-2 hidden -translate-x-1/2 rounded-lg bg-neutral-900 px-4 py-2 whitespace-nowrap shadow-xl ring-1 ring-white/10 group-hover/kb:block">
            <div className="flex gap-4 text-[10px] text-neutral-400">
              <span>{t('viewer.hint.playPause')}</span>
              <span>{t('viewer.hint.seek')}</span>
              <span>{t('viewer.hint.fineSeek')}</span>
              <span>{t('viewer.hint.frameStep')}</span>
              <span>{t('viewer.hint.clipNav')}</span>
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
