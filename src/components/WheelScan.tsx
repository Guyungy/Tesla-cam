import clsx from 'clsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  MdKeyboardArrowDown,
  MdOutlineCancel,
  MdOutlineSearch,
} from 'react-icons/md';
import { VscClose } from 'react-icons/vsc';

import type {
  VisionCamera,
  VisionCandidate,
  VisionScanProgress,
  WheelSide,
} from '../../electron/visionTypes';
import { useI18n } from '../i18n';
import type { CamClip } from '../utils';
import { formatDuration } from '../utils';

type Props = {
  items: CamClip[];
  onReview: (clip: CamClip, seconds: number) => void;
};

const thumbnailCache = new Map<string, string>();

type CandidateGroup = {
  id: string;
  candidates: VisionCandidate[];
  startSeconds: number;
  endSeconds: number;
  maxScore: number;
};

function CandidateThumbnail({ candidate }: { candidate: VisionCandidate }) {
  const key = `${candidate.videoPath}:${candidate.videoSeconds.toFixed(1)}`;
  const [src, setSrc] = useState(() => thumbnailCache.get(key));
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (src || !candidate.videoPath) return;
    const root = rootRef.current;
    if (!root) return;
    let canceled = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        void window.electronAPI
          ?.visionThumbnail(candidate.videoPath, candidate.videoSeconds)
          .then((value) => {
            if (!value || canceled) return;
            thumbnailCache.set(key, value);
            setSrc(value);
          });
      },
      { rootMargin: '160px' },
    );
    observer.observe(root);
    return () => {
      canceled = true;
      observer.disconnect();
    };
  }, [candidate.videoPath, candidate.videoSeconds, key, src]);

  return (
    <div
      ref={rootRef}
      className="relative h-24 w-32 shrink-0 overflow-hidden rounded-lg bg-black/50 ring-1 ring-white/10"
    >
      {src ? (
        <img
          src={src}
          alt=""
          className="h-full w-full object-cover"
          draggable={false}
        />
      ) : (
        <div className="h-full w-full animate-pulse bg-white/5" />
      )}
      {src &&
        candidate.tracks.map((track, index) => (
          <svg
            key={`track:${track.label}:${index}`}
            className="pointer-events-none absolute inset-0 h-full w-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
            <polyline
              points={track.points
                .map((point) => `${point.x * 100},${point.y * 100}`)
                .join(' ')}
              fill="none"
              stroke="#fbbf24"
              strokeWidth="2.5"
              vectorEffect="non-scaling-stroke"
            />
            {track.points.map((point, pointIndex) => (
              <circle
                key={pointIndex}
                cx={point.x * 100}
                cy={point.y * 100}
                r={pointIndex === track.points.length - 1 ? 3 : 2}
                fill="#fbbf24"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
        ))}
      {src &&
        candidate.detections.map((detection, index) => (
          <div
            key={`${detection.label}:${index}`}
            className="pointer-events-none absolute border-2 border-emerald-400 shadow-[0_0_0_1px_rgba(0,0,0,0.65)]"
            style={{
              left: `${detection.x * 100}%`,
              top: `${detection.y * 100}%`,
              width: `${detection.width * 100}%`,
              height: `${detection.height * 100}%`,
            }}
          >
            <span className="absolute -top-4 left-[-2px] bg-emerald-500 px-1 text-[8px] leading-4 font-bold text-black">
              {detection.label} {Math.round(detection.confidence * 100)}%
            </span>
          </div>
        ))}
    </div>
  );
}

export function WheelScan({ items, onReview }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [wheel, setWheel] = useState<WheelSide>('left_front');
  const [cameras, setCameras] = useState<VisionCamera[]>(['left']);
  const [sessionId, setSessionId] = useState<string>();
  const [progress, setProgress] = useState<VisionScanProgress>();
  const [candidates, setCandidates] = useState<VisionCandidate[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string>();
  const [cached, setCached] = useState(false);
  const sessionRef = useRef(sessionId);
  sessionRef.current = sessionId;

  useEffect(() => {
    return window.electronAPI?.onVisionScanProgress((next) => {
      if (next.sessionId === sessionRef.current) {
        setProgress(next);
        setCandidates(next.results);
      }
    });
  }, []);

  const clipsByName = useMemo(
    () => new Map(items.map((clip) => [clip.name, clip])),
    [items],
  );

  const candidateGroups = useMemo<CandidateGroup[]>(() => {
    const grouped = new Map<string, VisionCandidate[]>();
    for (const candidate of candidates) {
      const list = grouped.get(candidate.clipName) ?? [];
      list.push(candidate);
      grouped.set(candidate.clipName, list);
    }

    return [...grouped.entries()]
      .map(([id, values]) => {
        const ordered = [...values].sort(
          (a, b) => a.startSeconds - b.startSeconds || b.score - a.score,
        );
        return {
          id,
          candidates: ordered,
          startSeconds: Math.min(...ordered.map((item) => item.startSeconds)),
          endSeconds: Math.max(...ordered.map((item) => item.endSeconds)),
          maxScore: Math.max(...ordered.map((item) => item.score)),
        };
      })
      .sort((a, b) => b.maxScore - a.maxScore || a.id.localeCompare(b.id));
  }, [candidates]);

  useEffect(() => {
    if (candidateGroups.length === 0) {
      setExpandedGroups(new Set());
      return;
    }
    setExpandedGroups((current) => {
      if (current.size > 0) return current;
      return new Set([candidateGroups[0].id]);
    });
  }, [candidateGroups]);

  const start = async () => {
    if (!window.electronAPI?.visionScanStart || items.length === 0) return;
    const id = crypto.randomUUID();
    setSessionId(id);
    setProgress({
      sessionId: id,
      completed: 0,
      total: 0,
      candidates: 0,
      results: [],
    });
    setCandidates([]);
    setExpandedGroups(new Set());
    setError(undefined);
    setCached(false);
    const result = await window.electronAPI.visionScanStart({
      sessionId: id,
      wheel,
      cameras,
      clips: items.map((clip) => ({
        clipName: clip.name,
        paths: clip.sourcePaths ?? [],
        clipType: clip.type,
      })),
    });
    if (sessionRef.current !== id) return;
    setSessionId(undefined);
    if (result.ok) {
      setCandidates(result.candidates);
      setCached(Boolean(result.cached));
    } else if (!result.canceled) {
      setError(result.error || t('wheelScan.failed'));
    }
  };

  const cameraOptions: { id: VisionCamera; label: string }[] = [
    { id: 'left', label: t('wheelScan.camera.left') },
    { id: 'left_pillar', label: t('wheelScan.camera.leftPillar') },
    { id: 'front', label: t('wheelScan.camera.front') },
    { id: 'back', label: t('wheelScan.camera.back') },
    { id: 'right', label: t('wheelScan.camera.right') },
    { id: 'right_pillar', label: t('wheelScan.camera.rightPillar') },
  ];

  const cameraLabel = (camera: VisionCamera) =>
    cameraOptions.find((option) => option.id === camera)?.label ?? camera;

  const movementLabel = (
    movement: VisionCandidate['tracks'][number]['movement'],
  ) =>
    movement === 'approaching'
      ? t('wheelScan.movement.approaching')
      : movement === 'leaving'
        ? t('wheelScan.movement.leaving')
        : t('wheelScan.movement.stable');

  const proximityLabel = (
    proximity: VisionCandidate['tracks'][number]['proximity'],
  ) =>
    proximity === 'very_near'
      ? t('wheelScan.proximity.veryNear')
      : proximity === 'near'
        ? t('wheelScan.proximity.near')
        : proximity === 'medium'
          ? t('wheelScan.proximity.medium')
          : t('wheelScan.proximity.far');

  const toggleCamera = (camera: VisionCamera) => {
    setCameras((current) => {
      if (current.includes(camera)) {
        return current.length === 1
          ? current
          : current.filter((item) => item !== camera);
      }
      return [...current, camera];
    });
  };

  const cancel = () => {
    if (!sessionId) return;
    window.electronAPI?.visionScanCancel(sessionId);
  };

  const review = (candidate: VisionCandidate) => {
    const clip = clipsByName.get(candidate.clipName);
    if (!clip) return;
    setOpen(false);
    onReview(clip, Math.max(0, candidate.startSeconds - 3));
  };

  const toggleGroup = (id: string) => {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const percent =
    progress && progress.total > 0
      ? Math.round((progress.completed / progress.total) * 100)
      : 0;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="glass-panel absolute top-5 left-5 z-30 inline-flex items-center gap-2 rounded-lg border border-amber-400/20 px-3 py-2 text-xs font-medium text-amber-200 transition-colors hover:border-amber-300/40 hover:bg-white/10"
      >
        <MdOutlineSearch size={17} />
        {sessionId
          ? t('wheelScan.scanningBadge', {
              percent,
              count: candidates.length,
            })
          : t('wheelScan.open')}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm">
          <div className="bg-surface-panel flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/10 shadow-2xl">
            <div className="flex items-start justify-between border-b border-white/5 px-6 py-5">
              <div>
                <h2 className="text-lg font-semibold text-white">
                  {t('wheelScan.title')}
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-neutral-500">
                  {t('wheelScan.description')}
                </p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="text-neutral-500 hover:text-white"
                aria-label={t('settings.close')}
              >
                <VscClose size={20} />
              </button>
            </div>

            <div className="border-b border-white/5 px-6 py-4">
              <div className="flex items-center gap-3">
                <span className="w-16 shrink-0 text-xs text-neutral-500">
                  {t('wheelScan.damageLocation')}
                </span>
                {(['left_front', 'left_rear'] as const).map((value) => (
                  <button
                    key={value}
                    disabled={Boolean(sessionId)}
                    onClick={() => setWheel(value)}
                    className={clsx(
                      'rounded-lg border px-4 py-2 text-sm transition-colors disabled:opacity-50',
                      wheel === value
                        ? 'border-amber-400/50 bg-amber-400/10 text-amber-200'
                        : 'border-white/10 text-neutral-400 hover:border-white/20',
                    )}
                  >
                    {t(
                      value === 'left_front'
                        ? 'wheelScan.leftFront'
                        : 'wheelScan.leftRear',
                    )}
                  </button>
                ))}
                <div className="flex-1" />
                {sessionId ? (
                  <button
                    onClick={cancel}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-4 py-2 text-sm text-neutral-300 hover:bg-white/10"
                  >
                    <MdOutlineCancel /> {t('wheelScan.cancel')}
                  </button>
                ) : (
                  <button
                    onClick={() => void start()}
                    disabled={items.length === 0}
                    className="bg-brand-primary rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                  >
                    {t('wheelScan.start')}
                  </button>
                )}
              </div>
              <div className="mt-3 flex items-center gap-2">
                <span className="w-16 shrink-0 text-xs text-neutral-500">
                  {t('wheelScan.views')}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {cameraOptions.map((option) => {
                    const selected = cameras.includes(option.id);
                    return (
                      <button
                        key={option.id}
                        disabled={Boolean(sessionId)}
                        onClick={() => toggleCamera(option.id)}
                        className={clsx(
                          'rounded-md border px-2.5 py-1.5 text-xs transition-colors disabled:opacity-50',
                          selected
                            ? 'border-blue-400/40 bg-blue-400/10 text-blue-200'
                            : 'border-white/10 text-neutral-500 hover:text-neutral-300',
                        )}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="mt-2 pl-16 text-[11px] text-neutral-600">
                {t('wheelScan.viewsHint')}
              </div>
            </div>

            {sessionId && (
              <div className="border-b border-white/5 px-6 py-4">
                <div className="mb-2 flex justify-between text-xs text-neutral-400">
                  <span>{progress?.clipName || t('wheelScan.preparing')}</span>
                  <span>
                    {percent}% · {progress?.candidates ?? 0}{' '}
                    {t('wheelScan.candidateUnit')}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full bg-amber-400 transition-all"
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </div>
            )}

            {sessionId && candidates.length > 0 && (
              <div className="border-b border-amber-400/10 bg-amber-400/[0.04] px-6 py-2 text-xs text-amber-200/80">
                {t('wheelScan.reviewWhileScanning')}
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {error && (
                <div className="rounded-lg border border-red-400/20 bg-red-400/5 p-3 text-sm text-red-300">
                  {error}
                </div>
              )}
              {!sessionId && !error && candidates.length === 0 && (
                <div className="py-12 text-center text-sm text-neutral-500">
                  {t('wheelScan.empty')}
                </div>
              )}
              {cached && candidates.length > 0 && (
                <div className="mb-3 text-xs text-neutral-500">
                  {t('wheelScan.cached')}
                </div>
              )}
              <div className="flex flex-col gap-3">
                {candidateGroups.map((group) => {
                  const expanded = expandedGroups.has(group.id);
                  return (
                    <section
                      key={group.id}
                      className="overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.015]"
                    >
                      <button
                        onClick={() => toggleGroup(group.id)}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.035]"
                        aria-expanded={expanded}
                      >
                        <MdKeyboardArrowDown
                          size={21}
                          className={clsx(
                            'shrink-0 text-neutral-500 transition-transform',
                            !expanded && '-rotate-90',
                          )}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-neutral-200">
                            {group.id}
                          </div>
                          <div className="mt-1 text-[11px] text-neutral-500">
                            {formatDuration(group.startSeconds)}–
                            {formatDuration(group.endSeconds)} ·{' '}
                            {group.candidates.length}{' '}
                            {t('wheelScan.candidateUnit')}
                          </div>
                        </div>
                        <div
                          className={clsx(
                            'rounded-full px-2.5 py-1 text-xs font-semibold',
                            group.maxScore >= 75
                              ? 'bg-red-400/15 text-red-300'
                              : group.maxScore >= 50
                                ? 'bg-amber-400/15 text-amber-300'
                                : 'bg-blue-400/15 text-blue-300',
                          )}
                        >
                          {t('wheelScan.highestRisk')} {group.maxScore}
                        </div>
                      </button>

                      {expanded && (
                        <div className="flex flex-col gap-2 border-t border-white/5 p-2">
                          {group.candidates.map((candidate) => (
                            <button
                              key={candidate.id}
                              onClick={() => review(candidate)}
                              className="flex items-center gap-4 rounded-xl border border-white/5 bg-white/[0.025] p-3 text-left transition-colors hover:border-amber-400/30 hover:bg-white/5"
                            >
                              <CandidateThumbnail candidate={candidate} />
                              <div
                                className={clsx(
                                  'flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold',
                                  candidate.score >= 75
                                    ? 'bg-red-400/15 text-red-300'
                                    : candidate.score >= 50
                                      ? 'bg-amber-400/15 text-amber-300'
                                      : 'bg-blue-400/15 text-blue-300',
                                )}
                              >
                                {candidate.score}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-medium text-neutral-200">
                                  {candidate.clipName}
                                </div>
                                <div className="mt-1 text-xs text-neutral-500">
                                  {cameraLabel(candidate.camera)}
                                  {' · '}
                                  {formatDuration(candidate.startSeconds)}–
                                  {formatDuration(candidate.endSeconds)}
                                </div>
                                {candidate.tracks[0] && (
                                  <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
                                    <span className="rounded bg-amber-400/10 px-1.5 py-0.5 text-amber-200">
                                      {movementLabel(
                                        candidate.tracks[0].movement,
                                      )}
                                    </span>
                                    <span className="rounded bg-blue-400/10 px-1.5 py-0.5 text-blue-200">
                                      {t('wheelScan.estimatedDistance')}：
                                      {proximityLabel(
                                        candidate.tracks[0].proximity,
                                      )}
                                    </span>
                                  </div>
                                )}
                              </div>
                              <span className="text-xs text-amber-300">
                                {t('wheelScan.review')}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>
            </div>

            <div className="border-t border-white/5 px-6 py-3 text-[11px] leading-relaxed text-neutral-600">
              {t('wheelScan.disclaimer')}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
