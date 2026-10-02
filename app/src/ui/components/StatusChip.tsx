import { Pause, TriangleAlert } from 'lucide-react';
import { m } from 'motion/react';
import { cx } from '../cx.ts';
import { T_CHIP } from '../motion.tsx';

export type ChipKind = 'arming' | 'standby' | 'timing' | 'paused';

const LABEL: Record<ChipKind, string> = {
  arming: 'Arming',
  standby: 'Stand-by',
  timing: 'Timing',
  paused: 'Paused',
};
const TONE: Record<ChipKind, string> = {
  arming: 'border-warn/50 bg-warn/10 text-warn',
  standby: 'border-warn/50 bg-warn/10 text-warn',
  timing: 'border-accent/50 bg-accent/10 text-accent',
  paused: 'border-border bg-surface-2 text-text',
};

/** Session status (spec §3.1); text + colour, cross-fades on change. */
export function StatusChip({ kind }: { kind: ChipKind }) {
  return (
    <div role="status" className="inline-flex">
      <m.span
        key={kind}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={T_CHIP}
        className={cx(
          'inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-sm font-extrabold tracking-wider uppercase',
          TONE[kind],
        )}
      >
        {kind === 'paused' ? (
          <Pause aria-hidden size={16} strokeWidth={3} />
        ) : (
          <span aria-hidden className="size-2.5 rounded-full bg-current" />
        )}
        {LABEL[kind]}
      </m.span>
    </div>
  );
}

/** Amber warning chip, e.g. low frame rate (spec §3.4). */
export function WarnChip({ children }: { children: string }) {
  return (
    <span className="inline-flex min-h-9 items-center gap-2 rounded-full border border-warn/50 bg-warn/10 px-3.5 py-1 text-sm font-semibold text-warn">
      <TriangleAlert aria-hidden size={16} strokeWidth={2.5} className="shrink-0" />
      {children}
    </span>
  );
}
