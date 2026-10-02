import type { ReactNode } from 'react';

/** Keyboard hint, shown only with a fine pointer (desktop). */
export function KeyHint({ children }: { children: ReactNode }) {
  return (
    <span className="hidden items-center gap-1.5 text-sm text-text-muted pointer-fine:inline-flex">
      <kbd className="rounded-md border border-border bg-surface-2 px-1.5 py-0.5 font-sans text-xs font-semibold text-text">
        {children}
      </kbd>
    </span>
  );
}
