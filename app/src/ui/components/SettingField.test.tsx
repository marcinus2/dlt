import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULTS, field, getSetting, ROI_PRESETS, type SettingKey } from '../../settings/schema.ts';
import { fieldError } from '../../settings/validate.ts';
import { SettingField } from './SettingField.tsx';

/** A field wired like the Configuration screen: value → validate → error. */
function Harness({
  k,
  initial,
  onValue,
}: {
  k: SettingKey;
  initial?: unknown;
  onValue?: (v: unknown) => void;
}) {
  const meta = field(k);
  const [value, setValue] = useState<unknown>(initial ?? getSetting(DEFAULTS, k));
  return (
    <SettingField
      meta={meta}
      value={value}
      error={fieldError(meta, value) ?? undefined}
      changed={value !== meta.default}
      onChange={(v) => {
        setValue(v);
        onValue?.(v);
      }}
    />
  );
}

describe('SettingField', () => {
  it('number: out-of-range input shows an inline error tied with aria-describedby', () => {
    render(<Harness k="detection.pixelDiffThreshold" />);
    const input = screen.getByLabelText('Pixel threshold') as HTMLInputElement;
    expect(input.getAttribute('aria-invalid')).toBe('false');
    fireEvent.change(input, { target: { value: '250' } });
    const error = screen.getByText('Must be 1–100');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')?.split(' ')).toContain(error.id);
  });

  it('number: empty text is "Enter a number"; fractions on an int field are rejected', () => {
    render(<Harness k="detection.cooldownMs" />);
    const input = screen.getByLabelText('Minimum lap time');
    fireEvent.change(input, { target: { value: '' } });
    expect(screen.getByText('Enter a number')).toBeTruthy();
    fireEvent.change(input, { target: { value: '1500.5' } });
    expect(screen.getByText('Enter a whole number')).toBeTruthy();
  });

  it('number: −/+ step and clamp to the range; the changed dot appears', () => {
    const onValue = vi.fn();
    render(<Harness k="detection.pixelDiffThreshold" initial={2} onValue={onValue} />);
    expect(screen.getByLabelText('changed from default')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Decrease Pixel threshold'));
    expect(onValue).toHaveBeenLastCalledWith(1);
    expect((screen.getByLabelText('Decrease Pixel threshold') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Increase Pixel threshold'));
    expect(onValue).toHaveBeenLastCalledWith(2);
  });

  it('help text is always linked', () => {
    render(<Harness k="detection.cooldownMs" />);
    const input = screen.getByLabelText('Minimum lap time');
    const help = screen.getByText(/minimum lap time/i, { selector: 'p' });
    expect(input.getAttribute('aria-describedby')).toBe(help.id);
    expect(screen.queryByLabelText('changed from default')).toBeNull();
  });

  it('ratio: shown and entered in %', () => {
    const onValue = vi.fn();
    render(<Harness k="detection.startRatio" onValue={onValue} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('2');
    fireEvent.change(input, { target: { value: '60' } });
    expect(onValue).toHaveBeenLastCalledWith(0.6);
    expect(screen.getByText('Must be 0.05%–50%')).toBeTruthy();
  });

  it('toggle: a switch with aria-checked', () => {
    const onValue = vi.fn();
    render(<Harness k="audio.voice" onValue={onValue} />);
    const sw = screen.getByRole('switch', { name: 'Spoken lap times' });
    expect(sw.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(sw);
    expect(onValue).toHaveBeenLastCalledWith(false);
  });

  it('segmented: pressed state per option', () => {
    const onValue = vi.fn();
    render(<Harness k="camera.facing" onValue={onValue} />);
    expect(screen.getByRole('button', { name: 'Front' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Rear' }));
    expect(onValue).toHaveBeenLastCalledWith('environment');
  });

  it('roi: presets, then custom values with the region error', () => {
    const onValue = vi.fn();
    render(<Harness k="detection.roi" onValue={onValue} />);
    fireEvent.click(screen.getByRole('button', { name: 'Box' }));
    expect(onValue).toHaveBeenLastCalledWith(ROI_PRESETS.box);
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    fireEvent.change(screen.getByLabelText('Width'), { target: { value: '90' } });
    expect(onValue).toHaveBeenLastCalledWith({ ...ROI_PRESETS.box, width: 0.9 });
    expect(screen.getByText('Region must stay inside the frame')).toBeTruthy();
  });
});
