import { useEffect, useId, useRef } from 'react';

interface Props {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Native modal <dialog>: traps focus, Esc = cancel, restores focus on close. Cancel gets the
 * default focus so an accidental Enter never discards data (spec §3.4).
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      cancel.current?.focus();
    } else if (!open && d.open) {
      d.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-t`}
      aria-describedby={`${id}-b`}
      onCancel={(e) => {
        e.preventDefault(); // the store closes it
        onCancel();
      }}
      className="dialog m-auto w-[min(calc(100vw-32px),420px)] rounded-card border border-border bg-surface p-6 text-text backdrop:bg-bg/80"
    >
      <h2 id={`${id}-t`} className="text-2xl font-extrabold">
        {title}
      </h2>
      <p id={`${id}-b`} className="mt-2 text-lg text-text-muted">
        {body}
      </p>
      <div className="mt-6 flex gap-3">
        <button
          ref={cancel}
          type="button"
          onClick={onCancel}
          className="min-h-14 flex-1 rounded-full border-2 border-border bg-surface-2 px-4 text-xl font-bold text-text"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="min-h-14 flex-1 rounded-full bg-danger px-4 text-xl font-bold text-text"
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
