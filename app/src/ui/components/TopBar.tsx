import { Check, Flag, type LucideIcon, Settings } from 'lucide-react';
import { type ReactNode, Suspense } from 'react';
import { cx } from '../cx.ts';
import { SimBar } from '../sim/lazy.ts';
import { useApp } from '../store.tsx';

function NavItem({
  icon: Icon,
  label,
  current,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  current?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={current ? 'page' : undefined}
      onClick={onClick}
      className={cx(
        'inline-flex min-h-12 items-center gap-2 rounded-full px-3 text-[18px] font-semibold whitespace-nowrap max-[380px]:gap-1.5 max-[380px]:px-2',
        current ? 'text-accent' : 'text-text hover:bg-surface-2',
      )}
    >
      <Icon aria-hidden size={22} strokeWidth={2.25} />
      {label}
    </button>
  );
}

function SaveItem() {
  const dirty = useApp((s) => s.state.configDirty);
  const valid = useApp((s) => s.state.configValid);
  const dispatch = useApp((s) => s.dispatch);
  return (
    <button
      type="button"
      disabled={!valid}
      onClick={() => dispatch({ type: 'SAVE' })}
      className={cx(
        'inline-flex min-h-12 items-center gap-2 rounded-full px-4 text-[18px] font-semibold whitespace-nowrap disabled:opacity-40',
        dirty && valid ? 'bg-accent text-accent-ink shadow-glow-accent' : 'text-text hover:bg-surface-2',
      )}
    >
      <Check aria-hidden size={22} strokeWidth={2.5} />
      Save
    </button>
  );
}

/** Top menu (spec §3.1): New session · Configuration, or New session · Save on Configuration. */
export function TopBar({ children }: { children?: ReactNode }) {
  const screen = useApp((s) => s.state.screen);
  const dispatch = useApp((s) => s.dispatch);
  const sim = useApp((s) => s.sim !== null);
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-surface pt-safe md:flex md:items-center landscape:flex landscape:items-center">
      <nav
        aria-label="Main"
        className="mx-auto flex min-h-16 max-w-[1040px] items-center gap-2 px-safe short:min-h-12 md:flex-1 landscape:flex-1"
      >
        <NavItem
          icon={Flag}
          label="New session"
          current={screen !== 'config'}
          onClick={() => dispatch({ type: 'NAV_NEW_SESSION' })}
        />
        <div className="flex min-w-0 flex-1 justify-center">{children}</div>
        {screen === 'config' ? (
          <SaveItem />
        ) : (
          <NavItem icon={Settings} label="Configuration" onClick={() => dispatch({ type: 'NAV_CONFIG' })} />
        )}
      </nav>
      {sim && (
        <Suspense fallback={null}>
          <SimBar />
        </Suspense>
      )}
    </header>
  );
}
