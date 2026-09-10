/** Result shape returned by the `trash-files` IPC handler. */
export type DeleteResult = {
  ok: boolean;
  canceled?: boolean;
  error?: string;
  trashedCount?: number;
  failedCount?: number;
  permanent?: boolean;
};

/**
 * Pick the toast that describes what actually happened to the files.
 *
 * "Moved to Recycle Bin" is only true when the volume has one — on a TeslaCam
 * USB drive the files are erased outright, and a partial delete must not be
 * reported as a clean one.
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
