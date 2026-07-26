/**
 * The delete toast is the only thing that tells a user whether their footage
 * went to the Recycle Bin or was erased outright — on a TeslaCam USB drive it
 * is always the latter, so a wrong message here is actively misleading.
 */
import { expect, test } from '@playwright/test';

import { deleteResultToast } from '../src/utils/deleteResultToast';

test('recycle-bin delete reports the recoverable message', () => {
  expect(deleteResultToast({ ok: true, trashedCount: 6 })).toEqual({
    key: 'toast.clipDeleted',
  });
});

test('permanent delete never claims the Recycle Bin', () => {
  const toast = deleteResultToast({
    ok: true,
    trashedCount: 6,
    permanent: true,
  });
  expect(toast.key).toBe('toast.clipDeletedPermanent');
});

test('partial delete is reported with both counts, not as clean', () => {
  const toast = deleteResultToast({
    ok: true,
    trashedCount: 4,
    failedCount: 2,
    permanent: true,
  });
  expect(toast.key).toBe('toast.clipDeletedPartial');
  expect(toast.params).toEqual({ count: 4, failed: 2 });
});

test('partial delete wins over the permanent/recycle distinction', () => {
  // Leftover files matter more than which mechanism removed the rest.
  const toast = deleteResultToast({
    ok: true,
    trashedCount: 1,
    failedCount: 5,
  });
  expect(toast.key).toBe('toast.clipDeletedPartial');
  expect(toast.params).toEqual({ count: 1, failed: 5 });
});
