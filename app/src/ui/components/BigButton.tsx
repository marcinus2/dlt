import { m } from 'motion/react';
import { cx } from '../cx.ts';
import { PRESS } from '../motion.tsx';
import { useTapGuard } from '../useTapGuard.ts';
import { KeyHint } from './KeyHint.tsx';

interface Props {
  label: string;
  tone: 'accent' | 'danger';
  onPress: () => void;
  disabled?: boolean;
  /** Desktop key hint under the button. */
  hint?: string;
  /** hero: min(72vw, 320px); compact (Get Ready, shares the screen with the preview): ≤ 30dvh. */
  size?: 'hero' | 'compact';
}

const SIZES = {
  hero: 'w-[min(72vw,320px)]',
  compact: 'w-[clamp(200px,min(56vw,30dvh),260px)]',
};

const TONES = {
  accent: 'bg-accent text-accent-ink shadow-glow-accent active:shadow-[0_0_40px_var(--color-accent)]',
  danger: 'bg-danger text-text shadow-glow-danger active:shadow-[0_0_40px_var(--color-danger-glow)]',
};

/** Hero circle (GET READY, START): min(72vw, 320px), ≥ 200 px. */
export function BigButton({ label, tone, onPress, disabled, hint = 'Space', size = 'hero' }: Props) {
  const { ready, guard } = useTapGuard();
  return (
    <div className="flex flex-col items-center gap-3">
      <m.button
        type="button"
        disabled={disabled}
        aria-disabled={!ready || undefined}
        onClick={guard(onPress)}
        {...(disabled ? {} : PRESS)}
        className={cx(
          'flex aspect-square min-w-[200px] items-center justify-center rounded-full px-6 text-center text-button font-extrabold uppercase transition-[box-shadow,opacity] duration-150',
          'disabled:opacity-40 disabled:shadow-none',
          SIZES[size],
          TONES[tone],
        )}
      >
        {label}
      </m.button>
      {hint && !disabled && <KeyHint>{hint}</KeyHint>}
    </div>
  );
}
