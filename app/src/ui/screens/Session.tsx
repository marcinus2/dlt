import { Volume2 } from 'lucide-react';
import { lazy, Suspense } from 'react';
import type { SessionData } from '../../session/types.ts';
import { ActionBar, ActionButton } from '../components/ActionBar.tsx';
import { Banner } from '../components/Banner.tsx';
import { LapHero } from '../components/LapHero.tsx';
import { LapList } from '../components/LapList.tsx';
import { type ChipKind, StatusChip, WarnChip } from '../components/StatusChip.tsx';
import { TopBar } from '../components/TopBar.tsx';
import { lapsText, pauseBanner } from '../copy.ts';
import { useApp } from '../store.tsx';

const SpeechLatencyHud = lazy(() =>
  import('../debug/Hud.tsx').then((m) => ({ default: m.SpeechLatencyHud })),
);

function chip(session: SessionData, paused: boolean): { kind: ChipKind; text: string } {
  if (paused) return { kind: 'paused', text: lapsText(session.laps.length) };
  if (session.phase === 'arming') return { kind: 'arming', text: 'Keep clear of the camera' };
  if (session.timing.kind === 'standby') return { kind: 'standby', text: 'Waiting for first pass' };
  return { kind: 'timing', text: `Lap ${session.laps.length + 1} running` };
}

function Banners({ paused }: { paused: boolean }) {
  const reason = useApp((s) => s.state.pauseReason);
  const camera = useApp((s) => s.state.camera);
  const audioLocked = useApp((s) => s.ui.audioLocked && (s.saved.audio.beep || s.saved.audio.voice));
  const wakeLockBanner = useApp((s) => s.ui.wakeLockBanner);
  const dismissWakeLock = useApp((s) => s.dismissWakeLockBanner);
  const unlockAudio = useApp((s) => s.unlockAudio);
  const pause = paused ? pauseBanner(reason, typeof camera === 'object' ? camera.error : null) : null;
  if (!pause && !audioLocked && !wakeLockBanner) return null;
  return (
    <div className="flex flex-col gap-2">
      {pause && (
        <Banner tone={reason === 'cameraLost' ? 'danger' : 'warn'} title={pause.title}>
          {pause.body}
        </Banner>
      )}
      {audioLocked && (
        <Banner
          tone="warn"
          icon={Volume2}
          title="Sound is off"
          // The tap resumes the AudioContext; the banner goes once it runs.
          action={{ label: 'Tap to enable sound', onClick: unlockAudio }}
        />
      )}
      {wakeLockBanner && (
        <Banner tone="info" title="Screen may turn off" onDismiss={dismissWakeLock}>
          Set Auto-Lock to Never during sessions.
        </Banner>
      )}
    </div>
  );
}

/** Session and Session – paused (spec §3.1). Same layout; the action bar swaps STOP for CONTINUE + END. */
export function Session() {
  const screen = useApp((s) => s.state.screen);
  const session = useApp((s) => s.state.session);
  const lowFps = useApp((s) => s.ui.lowFps);
  const debug = useApp((s) => s.debug);
  const dispatch = useApp((s) => s.dispatch);
  if (!session) return null;
  const paused = screen === 'paused';
  const status = chip(session, paused);

  return (
    <div className="flex h-screen-d flex-col overflow-hidden">
      <TopBar />
      <main className="mx-auto grid min-h-0 w-full max-w-[1040px] flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)_auto] [grid-template-areas:'head'_'list'_'actions'] md:grid-cols-2 md:grid-rows-[minmax(0,1fr)_auto] md:[grid-template-areas:'head_list'_'actions_list'] landscape:grid-cols-2 landscape:grid-rows-[minmax(0,1fr)_auto] landscape:[grid-template-areas:'head_list'_'actions_list']">
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-safe pt-4 [grid-area:head] short:gap-2 short:pt-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <StatusChip kind={status.kind} />
            <span className="font-semibold text-text">{status.text}</span>
            {lowFps && !paused && <WarnChip>Low frame rate — passes may be missed</WarnChip>}
          </div>
          {debug && (
            <Suspense>
              <SpeechLatencyHud />
            </Suspense>
          )}
          <Banners paused={paused} />
          <LapHero session={session} />
        </div>
        <section
          // biome-ignore lint/a11y/noNoninteractiveTabindex: a scroll container must be focusable for keyboard users (axe scrollable-region-focusable)
          tabIndex={0}
          aria-label="History"
          className="min-h-0 overflow-y-auto overscroll-contain px-safe pt-2 [grid-area:list] md:border-l md:border-border md:pt-4 landscape:border-l landscape:border-border landscape:pt-4"
        >
          <LapList laps={session.laps} bestIdx={session.bestIdx} />
        </section>
        <ActionBar key={screen} className="[grid-area:actions] md:max-w-[480px] md:justify-self-stretch">
          {paused ? (
            <>
              <ActionButton
                label="Continue"
                tone="accent"
                grow={2}
                hint="Space"
                onPress={() => dispatch({ type: 'CONTINUE' })}
              />
              <ActionButton label="End" tone="dangerOutline" onPress={() => dispatch({ type: 'END' })} />
            </>
          ) : (
            <ActionButton
              label="Stop"
              tone="danger"
              hint="Space"
              onPress={() => dispatch({ type: 'STOP' })}
            />
          )}
        </ActionBar>
      </main>
    </div>
  );
}
