import { useEffect, useRef, useState } from 'react';

type Props = {
  /** Pre-rendered thumb.png when the clip folder ships one */
  file?: File;
  /** Fallback: a video file to extract a poster frame from (lazy) */
  videoFile?: File;
  /** Stable cache key (clip name) so frames are generated once per clip */
  cacheKey?: string;
};

// ── Poster-frame extraction: module-level cache + small work queue ──
// A folder can hold hundreds of clips; frames are generated only when the
// card scrolls into view, at most GEN_CONCURRENCY at a time, once per clip.

const frameCache = new Map<string, string>();
const GEN_CONCURRENCY = 2;
let activeJobs = 0;
const pending: (() => void)[] = [];

function schedule(run: () => Promise<void>) {
  const start = () => {
    activeJobs++;
    run().finally(() => {
      activeJobs--;
      pending.shift()?.();
    });
  };
  if (activeJobs < GEN_CONCURRENCY) start();
  else pending.push(start);
}

function extractPosterFrame(videoFile: File): Promise<string | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(videoFile);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.src = url;

    let settled = false;
    const done = (result: string | null) => {
      if (settled) return;
      settled = true;
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
      resolve(result);
    };

    const timer = setTimeout(() => done(null), 8000);

    video.addEventListener('error', () => {
      clearTimeout(timer);
      done(null);
    });
    video.addEventListener('loadedmetadata', () => {
      const target = Math.min(1, (video.duration || 2) / 2);
      video.currentTime = target;
    });
    video.addEventListener('seeked', () => {
      clearTimeout(timer);
      try {
        const w = 192;
        const h = Math.round(
          (w * (video.videoHeight || 9)) / (video.videoWidth || 16),
        );
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return done(null);
        ctx.drawImage(video, 0, 0, w, h);
        done(canvas.toDataURL('image/jpeg', 0.6));
      } catch {
        done(null);
      }
    });
  });
}

export function Thumb({ file, videoFile, cacheKey }: Props) {
  const [src, setSrc] = useState<string | undefined>(() =>
    cacheKey ? frameCache.get(cacheKey) : undefined,
  );
  const rootRef = useRef<HTMLDivElement>(null);

  // Prefer the shipped thumb.png
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Otherwise lazily extract a poster frame when scrolled into view
  useEffect(() => {
    if (file || !videoFile || !cacheKey) return;
    if (frameCache.has(cacheKey)) {
      setSrc(frameCache.get(cacheKey));
      return;
    }
    const el = rootRef.current;
    if (!el) return;

    let cancelled = false;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      observer.disconnect();
      schedule(async () => {
        if (cancelled || frameCache.has(cacheKey)) {
          if (!cancelled) setSrc(frameCache.get(cacheKey));
          return;
        }
        const dataUrl = await extractPosterFrame(videoFile);
        if (dataUrl) {
          frameCache.set(cacheKey, dataUrl);
          if (!cancelled) setSrc(dataUrl);
        }
      });
    });
    observer.observe(el);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [file, videoFile, cacheKey]);

  if (!src) {
    // Placeholder while loading / when no source is available
    return (
      <div
        ref={rootRef}
        className="flex h-full w-full items-center justify-center bg-neutral-800 text-neutral-600"
      >
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
