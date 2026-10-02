import type { ReactNode } from 'react';
import { buildLabel } from '../build-info.ts';

export function BuildFooter({ children }: { children?: ReactNode }) {
  return (
    <footer className="flex min-h-12 flex-wrap items-center justify-center gap-x-3 px-safe pb-safe-bar pt-2 text-sm text-text-muted">
      {children}
      <span data-testid="build-label">{buildLabel}</span>
    </footer>
  );
}
