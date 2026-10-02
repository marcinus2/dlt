import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog.tsx';

const props = {
  title: 'End session?',
  body: '12 laps will be discarded.',
  confirmLabel: 'End session',
  onConfirm: () => {},
  onCancel: () => {},
};

describe('ConfirmDialog', () => {
  it('opens modal with Cancel focused', () => {
    render(<ConfirmDialog {...props} open />);
    const dialog = screen.getByRole('dialog', { name: 'End session?' }) as HTMLDialogElement;
    expect(dialog.open).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('12 laps will be discarded.').id).toBe(dialog.getAttribute('aria-describedby'));
  });

  it('confirm and cancel call back; Esc (cancel event) cancels', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmDialog {...props} open onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'End session' }));
    expect(onConfirm).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('closes when open turns false', () => {
    const { rerender } = render(<ConfirmDialog {...props} open />);
    const dialog = screen.getByRole('dialog') as HTMLDialogElement;
    rerender(<ConfirmDialog {...props} open={false} />);
    expect(dialog.open).toBe(false);
  });
});
