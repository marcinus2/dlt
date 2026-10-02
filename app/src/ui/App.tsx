import { m, useReducedMotion } from 'motion/react';
import { type ReactNode, useEffect, useRef } from 'react';
import type { Screen } from '../app/machine.ts';
import { CameraHost } from './components/CameraLayer.tsx';
import { StoreToast } from './components/Toast.tsx';
import { Dialogs } from './Dialogs.tsx';
import { MotionProvider, T_REDUCED, T_SCREEN } from './motion.tsx';
import { Configuration } from './screens/Configuration.tsx';
import { GetReady } from './screens/GetReady.tsx';
import { Session } from './screens/Session.tsx';
import { Welcome } from './screens/Welcome.tsx';
import { useApp } from './store.tsx';
import { useKeyboard } from './useKeyboard.ts';

/** Session and Paused share one layout (no transition between them). */
type View = Exclude<Screen, 'paused'>;
const ORDER: Record<View, number> = { welcome: 0, getReady: 1, session: 2, config: 3 };

function Transition({ dir, children }: { dir: number; children: ReactNode }) {
  const reduced = useReducedMotion();
  return (
    <m.div
      className="flex min-h-screen-d flex-col"
      initial={dir === 0 ? false : { opacity: 0, x: 8 * dir }}
      animate={{ opacity: 1, x: 0 }}
      transition={reduced ? T_REDUCED : T_SCREEN}
    >
      {children}
    </m.div>
  );
}

export function App() {
  const screen = useApp((s) => s.state.screen);
  useKeyboard();

  const view: View = screen === 'paused' ? 'session' : screen;
  const prev = useRef<View | null>(null);
  const dir = prev.current === null ? 0 : Math.sign(ORDER[view] - ORDER[prev.current]) || 1;
  useEffect(() => {
    prev.current = view;
  }, [view]);

  return (
    <MotionProvider>
      <CameraHost />
      <Transition key={view} dir={dir}>
        {view === 'welcome' && <Welcome />}
        {view === 'getReady' && <GetReady />}
        {view === 'session' && <Session />}
        {view === 'config' && <Configuration />}
      </Transition>
      <Dialogs />
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-safe pb-safe-bar">
        <StoreToast />
      </div>
    </MotionProvider>
  );
}
