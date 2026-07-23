import type { CamClip, CamClipEvent } from './types';

export function parseClipType(path?: string): CamClip['type'] {
  if (path === 'SavedClips') {
    return 'saved';
  }
  if (path === 'SentryClips') {
    return 'sentry';
  }
}

const manualSavedReasons = [
  'user_interaction_dashcam_icon_tapped',
  'user_interaction_dashcam_launcher_action_tapped',
];

export function parseSaveType(event?: CamClipEvent): CamClip['saveType'] {
  if (!event?.reason) {
    return;
  }
  if (event.reason === 'vehicle_auto_emergency_braking') {
    return 'aeb';
  }
  if (manualSavedReasons.includes(event.reason)) {
    return 'manual';
  }
}
