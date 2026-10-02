import { useRef } from 'react';
import type { Dialog } from '../app/machine.ts';
import { ConfirmDialog } from './components/ConfirmDialog.tsx';
import { lapsText } from './copy.ts';
import { useApp } from './store.tsx';

function copy(d: NonNullable<Dialog>, laps: number) {
  if (d.kind === 'discardConfig') {
    return {
      title: 'Discard changes?',
      body: 'Your unsaved configuration changes will be lost.',
      confirmLabel: 'Discard',
      cancelLabel: 'Keep editing',
    };
  }
  return {
    title: 'End session?',
    body: laps > 0 ? `${lapsText(laps)} will be discarded.` : 'The lap in progress will be discarded.',
    confirmLabel: 'End session',
    cancelLabel: 'Cancel',
  };
}

/** The machine's `dialog` field as one native modal (spec §3.2). */
export function Dialogs() {
  const dialog = useApp((s) => s.state.dialog);
  const laps = useApp((s) => s.state.session?.laps.length ?? 0);
  const dispatch = useApp((s) => s.dispatch);
  // Keep the last content while the dialog closes.
  const last = useRef<NonNullable<Dialog>>({ kind: 'endSession' });
  if (dialog) last.current = dialog;
  return (
    <ConfirmDialog
      open={dialog !== null}
      {...copy(last.current, laps)}
      onConfirm={() => dispatch({ type: 'CONFIRM' })}
      onCancel={() => dispatch({ type: 'CANCEL' })}
    />
  );
}
