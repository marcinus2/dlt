// getUserMedia / track errors → CameraError (spec §3.4). Pure.
import type { CameraError } from './types.ts';

const ERROR_KINDS: Record<string, CameraError['kind']> = {
  NotAllowedError: 'permission',
  SecurityError: 'permission',
  NotFoundError: 'notFound',
  NotReadableError: 'busy',
  AbortError: 'busy',
  OverconstrainedError: 'overconstrained',
};

/** CameraError as-is; DOMException-like errors mapped by name. */
export function toCameraError(err: unknown): CameraError {
  if (typeof err === 'object' && err !== null) {
    const e = err as { kind?: unknown; name?: unknown; message?: unknown };
    const message = typeof e.message === 'string' ? e.message : String(err);
    if (typeof e.kind === 'string') return { kind: e.kind as CameraError['kind'], message };
    if (typeof e.name === 'string') return { kind: ERROR_KINDS[e.name] ?? 'unknown', message };
  }
  return { kind: 'unknown', message: String(err) };
}
