import { m } from 'motion/react';
import type { ReactNode } from 'react';
import { cx } from '../cx.ts';
import { PRESS } from '../motion.tsx';
import { useTapGuard } from '../useTapGuard.ts';
import { KeyHint } from './KeyHint.tsx';

/** Bottom-anchored bar in the thumb zone: 112 px (96 in landscape), 16 px gutters. */
export function ActionBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('px-safe pb-safe-bar pt-3', className)}>
      <div className="flex h-28 gap-4 landscape:max-md:h-24">{children}</div>
    </div>
  );
}

const TONES = {
  danger: 'bg-danger text-text shadow-glow-danger',
  accent: 'bg-accent text-accent-ink shadow-glow-accent',
  dangerOutline: 'border-[3px] border-danger bg-bg text-danger-glow',
};

interface Props {
  label: string;
  tone: keyof typeof TONES;
  onPress: () => void;
  /** Flex grow (CONTINUE : END = 2 : 1). */
  grow?: 1 | 2;
  hint?: string;
}

export function ActionButton({ label, tone, onPress, grow = 1, hint }: Props) {
  const { ready, guard } = useTapGuard();
  return (
    <m.button
      type="button"
      aria-disabled={!ready || undefined}
      onClick={guard(onPress)}
      {...PRESS}
      className={cx(
        'flex min-w-0 basis-0 flex-col items-center justify-center gap-1 rounded-full text-button font-extrabold uppercase',
        grow === 2 ? 'grow-2' : 'grow',
        TONES[tone],
      )}
    >
      {label}
      {hint && <KeyHint>{hint}</KeyHint>}
    </m.button>
  );
}
