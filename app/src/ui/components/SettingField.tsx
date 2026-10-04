import { Minus, Plus } from 'lucide-react';
import { type ReactNode, useEffect, useId, useState } from 'react';
import type { CameraDevice, Roi } from '../../engine/types.ts';
import {
  type EnumField,
  type FieldMeta,
  type NumberField,
  type RatioField,
  ROI_PRESETS,
  type RoiPreset,
  type SelectField,
} from '../../settings/schema.ts';
import { cx } from '../cx.ts';

interface Props {
  meta: FieldMeta;
  value: unknown;
  error?: string;
  /** Differs from the default → "changed" dot. */
  changed: boolean;
  onChange: (v: unknown) => void;
  /** Choices of a `device` field. */
  devices?: readonly CameraDevice[];
}

interface ControlProps<F extends FieldMeta> {
  meta: F;
  value: unknown;
  onChange: (v: unknown) => void;
  id: string;
  labelId: string;
  describedBy: string;
  invalid: boolean;
}

const decimals = (step: number) => (String(step).split('.')[1] ?? '').length;
const roundTo = (v: number, step: number) => Number(v.toFixed(decimals(step) + 2));
const asNum = (v: unknown) => (typeof v === 'number' ? v : Number.NaN);

/** Schema-driven form row (spec §4.3): label, control, help, "changed" dot, inline error. */
export function SettingField({ meta, value, error, changed, onChange, devices = [] }: Props) {
  const id = useId();
  const helpId = `${id}-help`;
  const errId = `${id}-err`;
  const p = {
    value,
    onChange,
    id,
    labelId: `${id}-label`,
    describedBy: error ? `${helpId} ${errId}` : helpId,
    invalid: Boolean(error),
  };
  const inline = meta.type === 'bool';

  return (
    <div className="py-3" data-field={meta.key}>
      <div className={cx('flex items-center gap-3', inline ? 'justify-between' : 'mb-2')}>
        <label id={p.labelId} htmlFor={id} className="flex items-center gap-2 font-semibold text-text">
          {meta.label}
          {changed && (
            <span className="size-2 rounded-full bg-accent" role="img" aria-label="changed from default" />
          )}
        </label>
        {inline && <Toggle {...p} meta={meta} />}
      </div>
      {meta.type === 'number' && <NumberControl {...p} meta={meta} />}
      {meta.type === 'ratio' && <RatioControl {...p} meta={meta} />}
      {meta.type === 'select' && <SelectControl {...p} meta={meta} />}
      {meta.type === 'enum' && <Segmented {...p} meta={meta} />}
      {meta.type === 'device' && <DeviceControl {...p} meta={meta} devices={devices} />}
      {meta.type === 'roi' && <RoiControl {...p} meta={meta} />}
      <p id={helpId} className="mt-1.5 text-sm text-text-muted">
        {meta.help}
      </p>
      {error && (
        <p id={errId} className="mt-1 text-sm font-semibold text-danger-glow">
          {error}
        </p>
      )}
    </div>
  );
}

const INPUT =
  'h-12 rounded-card border border-border bg-surface-2 px-3 text-base text-text aria-invalid:border-danger-glow';

const fmtNum = (v: number, scale: number) => (Number.isFinite(v) ? String(+(v * scale).toPrecision(6)) : '');
const parseNum = (t: string, scale: number) =>
  (t.trim() === '' ? Number.NaN : Number(t.replace(',', '.'))) / scale;

/** Text input that keeps what the user typed; emits NaN for unparseable text. */
function NumberInput({
  value,
  scale = 1,
  onChange,
  className,
  ...rest
}: {
  value: number;
  scale?: number;
  onChange: (v: number) => void;
  className?: string;
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  'aria-label'?: string;
  inputMode: 'numeric' | 'decimal';
}) {
  const [text, setText] = useState(() => fmtNum(value, scale));
  useEffect(() => {
    // External change (stepper, slider, preset, Reset): show it unless the text already means it.
    setText((t) => (Object.is(parseNum(t, scale), value) ? t : fmtNum(value, scale)));
  }, [value, scale]);
  return (
    <input
      type="text"
      autoComplete="off"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(parseNum(e.target.value, scale));
      }}
      className={cx(INPUT, 'w-24 text-center font-mono', className)}
      {...rest}
    />
  );
}

function StepButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex size-12 shrink-0 items-center justify-center rounded-full border border-border bg-surface-2 text-text disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function NumberControl({ meta, value, onChange, id, describedBy, invalid }: ControlProps<NumberField>) {
  const v = asNum(value);
  const step = (dir: 1 | -1) => {
    const base = Number.isFinite(v) ? v : meta.default;
    onChange(Math.min(meta.max, Math.max(meta.min, roundTo(base + dir * meta.step, meta.step))));
  };
  return (
    <div className="flex items-center gap-2">
      <StepButton label={`Decrease ${meta.label}`} onClick={() => step(-1)} disabled={v <= meta.min}>
        <Minus aria-hidden size={20} />
      </StepButton>
      <NumberInput
        id={id}
        value={v}
        onChange={onChange}
        inputMode={meta.int ? 'numeric' : 'decimal'}
        aria-describedby={describedBy}
        aria-invalid={invalid}
      />
      <StepButton label={`Increase ${meta.label}`} onClick={() => step(1)} disabled={v >= meta.max}>
        <Plus aria-hidden size={20} />
      </StepButton>
      {meta.unit && <span className="ml-1 text-text-muted">{meta.unit}</span>}
    </div>
  );
}

const SLIDER_STEPS = 1000;

function toSlider(meta: RatioField, v: number): number {
  if (!Number.isFinite(v)) return 0;
  const c = Math.min(meta.max, Math.max(meta.min, v));
  const f = meta.log
    ? Math.log(c / meta.min) / Math.log(meta.max / meta.min)
    : (c - meta.min) / (meta.max - meta.min);
  return Math.round(f * SLIDER_STEPS);
}

function fromSlider(meta: RatioField, pos: number): number {
  const f = pos / SLIDER_STEPS;
  const v = meta.log ? meta.min * (meta.max / meta.min) ** f : meta.min + f * (meta.max - meta.min);
  // Keep 2 significant digits on a log scale, otherwise the field step.
  return meta.log ? Number(v.toPrecision(2)) : roundTo(Math.round(v / meta.step) * meta.step, meta.step);
}

/** Fraction shown in %: slider (log for ratios) + exact % input. */
function RatioControl({
  meta,
  value,
  onChange,
  id,
  labelId,
  describedBy,
  invalid,
}: ControlProps<RatioField>) {
  const v = asNum(value);
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={0}
        max={SLIDER_STEPS}
        value={toSlider(meta, v)}
        onChange={(e) => onChange(fromSlider(meta, Number(e.target.value)))}
        aria-labelledby={labelId}
        aria-valuetext={Number.isFinite(v) ? `${+(v * 100).toPrecision(3)}%` : undefined}
        aria-describedby={describedBy}
        className="slider h-12 min-w-0 flex-1"
      />
      <NumberInput
        id={id}
        value={v}
        scale={100}
        onChange={onChange}
        inputMode="decimal"
        aria-describedby={describedBy}
        aria-invalid={invalid}
        className="w-20"
      />
      <span className="text-text-muted">%</span>
    </div>
  );
}

function SelectControl({ meta, value, onChange, id, describedBy, invalid }: ControlProps<SelectField>) {
  return (
    <div className="flex items-center gap-2">
      <select
        id={id}
        value={String(value)}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        className={cx(INPUT, 'min-w-28')}
      >
        {meta.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      {meta.unit && <span className="text-text-muted">{meta.unit}</span>}
    </div>
  );
}

/** Automatic (by facing) or one camera. A saved camera that isn't listed stays selectable. */
function DeviceControl({
  value,
  onChange,
  id,
  describedBy,
  invalid,
  devices,
}: ControlProps<FieldMeta> & { devices: readonly CameraDevice[] }) {
  const v = typeof value === 'string' ? value : null;
  const missing = v !== null && !devices.some((d) => d.deviceId === v);
  return (
    <>
      <select
        id={id}
        value={v ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        className={cx(INPUT, 'w-full')}
      >
        <option value="">Automatic</option>
        {devices.map((d, i) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || `Camera ${i + 1}`}
          </option>
        ))}
        {missing && <option value={v}>Saved camera (not connected)</option>}
      </select>
      {devices.every((d) => !d.label) && (
        <p className="mt-1.5 text-sm text-text-muted">Camera names show once the camera has run.</p>
      )}
    </>
  );
}

function Toggle({ value, onChange, id, describedBy }: ControlProps<FieldMeta>) {
  const on = value === true;
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={on}
      aria-describedby={describedBy}
      onClick={() => onChange(!on)}
      className={cx(
        'relative inline-flex h-8 w-14 shrink-0 items-center rounded-full border-2 transition-colors',
        on ? 'border-accent bg-accent' : 'border-border bg-surface-2',
      )}
    >
      <span
        aria-hidden
        className={cx(
          'size-6 rounded-full transition-transform',
          on ? 'translate-x-6 bg-accent-ink' : 'translate-x-0.5 bg-text-muted',
        )}
      />
    </button>
  );
}

function SegmentGroup<V extends string>({
  options,
  value,
  onSelect,
  labelId,
  describedBy,
}: {
  options: readonly { value: V; label: string }[];
  value: V | null;
  onSelect: (v: V) => void;
  labelId: string;
  describedBy: string;
}) {
  return (
    <fieldset
      aria-labelledby={labelId}
      aria-describedby={describedBy}
      className="flex flex-wrap gap-1 rounded-card border border-border bg-surface-2 p-1"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onSelect(o.value)}
          className={cx(
            'min-h-11 flex-1 rounded-[9px] px-3 font-semibold whitespace-nowrap',
            o.value === value ? 'bg-accent text-accent-ink' : 'text-text hover:bg-surface',
          )}
        >
          {o.label}
        </button>
      ))}
    </fieldset>
  );
}

function Segmented({ meta, value, onChange, labelId, describedBy }: ControlProps<EnumField>) {
  return (
    <SegmentGroup
      options={meta.options}
      value={typeof value === 'string' ? value : null}
      onSelect={onChange}
      labelId={labelId}
      describedBy={describedBy}
    />
  );
}

type RoiChoice = RoiPreset | 'custom';
const ROI_OPTIONS: { value: RoiChoice; label: string }[] = [
  { value: 'full', label: 'Full' },
  { value: 'box', label: 'Box' },
  { value: 'vLine', label: 'V line' },
  { value: 'hLine', label: 'H line' },
  { value: 'custom', label: 'Custom' },
];

export function roiPreset(r: Roi): RoiPreset | null {
  for (const [k, p] of Object.entries(ROI_PRESETS)) {
    if (p.x === r.x && p.y === r.y && p.width === r.width && p.height === r.height) return k as RoiPreset;
  }
  return null;
}

/** ROI presets + custom x/y/w/h in %, with a small frame preview. */
function RoiControl({ value, onChange, id, labelId, describedBy, invalid }: ControlProps<FieldMeta>) {
  const roi = value as Roi;
  const preset = roiPreset(roi);
  const [custom, setCustom] = useState(preset === null);
  const choice: RoiChoice = custom || preset === null ? 'custom' : preset;
  const parts: { k: keyof Roi; label: string }[] = [
    { k: 'x', label: 'Left' },
    { k: 'y', label: 'Top' },
    { k: 'width', label: 'Width' },
    { k: 'height', label: 'Height' },
  ];
  return (
    <div className="flex gap-4">
      <div className="min-w-0 flex-1">
        <SegmentGroup
          options={ROI_OPTIONS}
          value={choice}
          onSelect={(c) => {
            setCustom(c === 'custom');
            if (c !== 'custom') onChange({ ...ROI_PRESETS[c] });
          }}
          labelId={labelId}
          describedBy={describedBy}
        />
        {choice === 'custom' && (
          <div className="mt-3 grid grid-cols-2 gap-3">
            {parts.map(({ k, label }) => (
              <div key={k} className="flex items-center justify-between gap-2 text-text-muted">
                <label htmlFor={`${id}-${k}`}>{label}</label>
                <span className="flex items-center gap-1">
                  <NumberInput
                    id={`${id}-${k}`}
                    value={roi[k]}
                    scale={100}
                    onChange={(v) => onChange({ ...roi, [k]: v })}
                    inputMode="decimal"
                    aria-invalid={invalid}
                    aria-describedby={describedBy}
                    className="w-20"
                  />
                  %
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div aria-hidden className="relative h-24 w-12 shrink-0 rounded-md border border-border bg-surface-2">
        <div
          className="absolute rounded-[2px] border-2 border-accent bg-accent/15"
          style={{
            left: `${roi.x * 100}%`,
            top: `${roi.y * 100}%`,
            width: `${roi.width * 100}%`,
            height: `${roi.height * 100}%`,
          }}
        />
      </div>
    </div>
  );
}
