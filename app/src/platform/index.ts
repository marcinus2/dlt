// Browser platform effects (M8), shared by the real and the sim wiring.
import type { PlatformPort, WakeLockPort } from '../app/effects.ts';
import { cameraPermission } from './permissions.ts';
import { createUnloadGuard, onVisibility } from './visibility.ts';
import { createWakeLock } from './wake-lock.ts';

export function createBrowserPlatform(): { wakeLock: WakeLockPort; platform: PlatformPort } {
  return {
    wakeLock: createWakeLock(),
    platform: { onVisibility, cameraPermission: () => cameraPermission(), unloadGuard: createUnloadGuard() },
  };
}
