/** Result shape returned by the `trash-files` IPC handler. */
export type DeleteResult = {
  ok: boolean;
  canceled?: boolean;
  error?: string;
  trashedCount?: number;
  failedCount?: number;
  permanent?: boolean;
  removedPaths?: string[];
  failedPaths?: string[];
};

/**
 * Pick the toast that describes what actually happened to the files.
 *
 * The current handler only recycles and stops when recycling fails.
 * Keep the legacy permanent flag for compatibility, but never mistake a
 * partial operation for a complete one.
 */
export function deleteResultToast(result: DeleteResult): {
  key:
    | 'toast.clipDeleted'
    | 'toast.clipDeletedPermanent'
    | 'toast.clipDeletedPartial';
  params?: Record<string, string | number>;
} {
  if (result.failedCount) {
    return {
      key: 'toast.clipDeletedPartial',
      params: {
        count: result.trashedCount ?? 0,
        failed: result.failedCount,
      },
    };
  }
  return {
    key: result.permanent ? 'toast.clipDeletedPermanent' : 'toast.clipDeleted',
  };
}
