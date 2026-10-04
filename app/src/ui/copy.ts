// User-facing copy that depends on state (spec §3.4).
import type { PauseReason } from '../app/machine.ts';
import type { CameraError } from '../engine/types.ts';

export type Platform = 'android' | 'ios' | 'desktop';

export function detectPlatform(ua = navigator.userAgent, touchPoints = navigator.maxTouchPoints): Platform {
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1)) return 'ios';
  return 'desktop';
}

export const PERMISSION_STEPS: Record<Platform, string> = {
  android: 'Tap the icon left of the address → Permissions → Camera → Allow.',
  ios: 'Open Settings → Apps → Safari → Camera → Allow. Installed app: Settings → Apps → Lap Counter → Camera.',
  desktop:
    'Allow the camera in the site settings (icon left of the address) and in the system privacy settings.',
};

export interface ErrorCopy {
  title: string;
  body: string;
}

export function cameraErrorCopy(e: CameraError, platform: Platform = detectPlatform()): ErrorCopy {
  switch (e.kind) {
    case 'permission':
      if (e.blocked === false)
        return {
          title: 'Camera not allowed yet',
          body: `Tap Retry and choose Allow when the browser asks. No prompt? ${PERMISSION_STEPS[platform]}`,
        };
      return {
        title: 'Camera blocked',
        body: `Allow camera access, then tap Retry. ${PERMISSION_STEPS[platform]}`,
      };
    case 'notFound':
      return {
        title: 'No camera found',
        body: 'Connect a camera or check that it isn’t disabled, then tap Retry.',
      };
    case 'busy':
      return {
        title: 'Camera in use by another app',
        body: 'Close other apps or tabs using the camera, then tap Retry.',
      };
    case 'overconstrained':
      return {
        title: 'Camera settings not supported',
        body: 'Lower the frame rate or size in Configuration.',
      };
    case 'insecure':
      return {
        title: 'Open this app over HTTPS',
        body: 'The camera only works on a secure (https://) address.',
      };
    case 'ended':
      return { title: 'Camera stopped', body: 'The camera was disconnected or its permission was revoked.' };
    case 'unknown':
      return { title: 'Camera failed to start', body: e.message || 'Try again, or restart the browser.' };
  }
}

export const CAMERA_EXPLAINER =
  'Camera is used only on this device to see the drone pass; nothing is recorded or uploaded.';

export function pauseBanner(reason: PauseReason | null, error: CameraError | null): ErrorCopy | null {
  if (reason === 'hidden')
    return { title: 'Paused — app was in background', body: 'Tap CONTINUE to resume.' };
  if (reason === 'cameraLost') {
    const c = error ? cameraErrorCopy(error) : null;
    return {
      title: `Paused — ${c ? c.title.toLowerCase() : 'camera lost'}`,
      body: 'CONTINUE retries the camera.',
    };
  }
  return null;
}

export function lapsText(n: number): string {
  return n === 1 ? '1 lap' : `${n} laps`;
}
