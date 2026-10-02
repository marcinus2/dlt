import { m } from 'motion/react';
import { useEffect } from 'react';
import { T_CHIP } from '../motion.tsx';
import { useApp } from '../store.tsx';

export const TOAST_MS = 4000;

interface Props {
  text: string;
  action?: { label: string; onClick: () => void };
}

/** Floating message above the bottom safe area. */
export function Toast({ text, action }: Props) {
  return (
    <m.div
      role="status"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={T_CHIP}
      className="pointer-events-auto mx-auto flex max-w-[480px] items-center gap-3 rounded-card border border-border bg-surface-2 px-4 py-2 shadow-lg"
    >
      <p className="min-w-0 flex-1 py-1.5 font-semibold text-text">{text}</p>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="min-h-12 shrink-0 rounded-full bg-accent px-4 font-bold text-accent-ink"
        >
          {action.label}
        </button>
      )}
    </m.div>
  );
}

/** The store's transient toast (e.g. "Settings can't be saved"), auto-dismissed. */
export function StoreToast() {
  const toast = useApp((s) => s.ui.toast);
  const dismiss = useApp((s) => s.dismissToast);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => dismiss(toast.id), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast, dismiss]);
  return toast ? <Toast key={toast.id} text={toast.text} /> : null;
}
