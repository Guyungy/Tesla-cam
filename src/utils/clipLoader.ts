import type { CamClip, CamFootage } from './types';

export type ClipSelection = {
  clip?: CamClip;
  footage?: CamFootage;
  progress?: { current: number; total: number };
  error?: string;
  revision: number;
};

/** Owns loaded resources and the request generation, independent of React renders. */
export function createClipLoader(options: {
  generate: (
    files: File[],
    progress: (current: number, total: number) => void,
  ) => Promise<CamFootage>;
  release: (footage?: CamFootage) => void;
  change: (selection: ClipSelection) => void;
}) {
  let state: ClipSelection = { revision: 0 };
  let generation = 0;
  const emit = (next: ClipSelection) => {
    state = next;
    options.change(next);
  };
  const reset = (notify = true) => {
    generation++;
    options.release(state.footage);
    state = { revision: generation };
    if (notify) options.change(state);
  };
  return {
    current: () => state,
    reset,
    dispose: () => reset(false),
    update(clip: CamClip, revision: number, footage: CamFootage) {
      if (
        state.clip === clip &&
        generation === revision &&
        state.footage?.urls === footage.urls
      ) {
        emit({ ...state, footage });
      }
    },
    async select(clip: CamClip, force = false): Promise<void> {
      if (!force && state.clip === clip && (state.footage || state.progress))
        return;
      reset(false);
      const revision = generation;
      emit({
        clip,
        revision,
        progress: { current: 0, total: clip.videos.length },
      });
      try {
        const footage = await options.generate(
          clip.videos,
          (current, total) => {
            if (revision === generation)
              emit({ ...state, progress: { current, total } });
          },
        );
        if (revision !== generation) {
          options.release(footage);
          return;
        }
        if (footage.segments.length === 0) {
          options.release(footage);
          throw new Error('No supported camera segments');
        }
        emit({ clip, footage, revision });
      } catch (error) {
        if (revision === generation)
          emit({
            revision,
            error: error instanceof Error ? error.message : String(error),
          });
      }
    },
  };
}
