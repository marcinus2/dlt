import { buildLabel } from '../build-info.ts';

export function BuildFooter() {
  return (
    <footer className="px-safe pb-safe-bar pt-4 text-center text-sm text-text-muted">
      <span data-testid="build-label">{buildLabel}</span>
    </footer>
  );
}
