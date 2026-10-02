import { Star } from 'lucide-react';
import { cx } from '../cx.ts';

/** BEST label: text + icon, never colour alone (spec §3.3). */
export function BestBadge({ className }: { className?: string }) {
  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center gap-1 rounded-full bg-best px-2.5 py-0.5 text-sm font-extrabold tracking-wider text-best-ink uppercase',
        className,
      )}
    >
      <Star aria-hidden size={14} strokeWidth={0} fill="currentColor" />
      Best
    </span>
  );
}
