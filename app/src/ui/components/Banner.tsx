import { Info, type LucideIcon, TriangleAlert, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from '../cx.ts';

const TONES = {
  warn: { box: 'border-warn/50 bg-warn/10', icon: 'text-warn', Icon: TriangleAlert },
  danger: { box: 'border-danger bg-danger/15', icon: 'text-danger-glow', Icon: TriangleAlert },
  info: { box: 'border-accent/40 bg-accent/10', icon: 'text-accent', Icon: Info },
} satisfies Record<string, { box: string; icon: string; Icon: LucideIcon }>;

interface Props {
  tone: keyof typeof TONES;
  title: string;
  children?: ReactNode;
  icon?: LucideIcon;
  action?: { label: string; onClick: () => void };
  onDismiss?: () => void;
}

/** Inline alert (auto-pause reasons, sound, wake lock): `role="alert"` (spec §4.5). */
export function Banner({ tone, title, children, icon, action, onDismiss }: Props) {
  const t = TONES[tone];
  const Icon = icon ?? t.Icon;
  return (
    <div role="alert" className={cx('flex items-start gap-3 rounded-card border px-4 py-3', t.box)}>
      <Icon aria-hidden size={22} strokeWidth={2.5} className={cx('mt-0.5 shrink-0', t.icon)} />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-text">{title}</p>
        {children && <div className="mt-0.5 text-text-muted">{children}</div>}
      </div>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="min-h-12 shrink-0 rounded-full bg-surface-2 px-4 font-semibold text-text"
        >
          {action.label}
        </button>
      )}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="-m-2 inline-flex size-12 shrink-0 items-center justify-center rounded-full text-text-muted hover:text-text"
        >
          <X aria-hidden size={20} />
        </button>
      )}
    </div>
  );
}
