// Motion tokens (spec §4.4). Only transform/opacity are animated; MotionConfig drops
// transform animations under prefers-reduced-motion.
import { domAnimation, LazyMotion, MotionConfig } from 'motion/react';
import type { ReactNode } from 'react';

export const EASE = [0.2, 0.8, 0.2, 1] as const;
export const T_SCREEN = { duration: 0.22, ease: EASE };
export const T_REDUCED = { duration: 0.1 };
export const T_LAP = { duration: 0.18, ease: EASE };
export const T_CHIP = { duration: 0.12 };
/** Press: 80 ms in (whileTap), 160 ms out (element transition). */
export const PRESS = {
  whileTap: { scale: 0.96, transition: { duration: 0.08 } },
  transition: { duration: 0.16 },
};

export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
