// Portrait lock (spec §2.5, plan 8.5) where it is allowed: installed (standalone) or fullscreen.
// Browsers reject it elsewhere and iOS ignores it, so rotation is handled anyway: the analyzer
// resets on a frame-size change and the next frame is neutral.

type Lockable = { lock?: (o: 'portrait') => Promise<void> };

export function lockPortrait(
  orientation: Lockable | undefined = globalThis.screen?.orientation as Lockable | undefined,
  allowed: () => boolean = () => matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches,
): void {
  if (!orientation?.lock || !allowed()) return;
  orientation.lock('portrait').catch(() => {});
}
