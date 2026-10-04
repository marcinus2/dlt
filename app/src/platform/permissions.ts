// Camera permission state (spec §3.4, plan 8.4): after NotAllowedError, tell "blocked in the
// settings" from "prompt dismissed, not decided yet" where the Permissions API knows it.
import type { CameraError } from '../engine/types.ts';

export type PermissionsLike = Pick<Permissions, 'query'>;

/** `null` when the browser can't say (no API, or `camera` not a known permission name). */
export async function cameraPermission(
  perms: PermissionsLike | undefined = globalThis.navigator?.permissions,
): Promise<PermissionState | null> {
  try {
    return perms ? (await perms.query({ name: 'camera' as PermissionName })).state : null;
  } catch {
    return null;
  }
}

/** A permission error annotated with `blocked`; other errors and unknown states unchanged. */
export function withPermission(e: CameraError, state: PermissionState | null): CameraError {
  if (e.kind !== 'permission' || state === null || state === 'granted') return e;
  return { ...e, blocked: state === 'denied' };
}
