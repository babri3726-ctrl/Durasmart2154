import type { ReactNode } from 'react';
import { Controller } from 'react-hook-form';
import type { Control, FieldValues, Path } from 'react-hook-form';

interface BaseProps<T extends FieldValues> {
  name: string;
  label: string;
  control: Control<T>;
  hint?: string;
  required?: boolean;
  className?: string;
}

/** Native inputs only accept string|number; form values arrive loosely typed. */
function inputValue(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

function FieldShell({
  label,
  required,
  hint,
  error,
  className = '',
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <label className="label">
        {label}
        {required && <span className="text-brand-red"> *</span>}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-[11px] text-faint">{hint}</p>}
      {error && <p className="mt-1 text-[11px] font-semibold text-brand-red">{error}</p>}
    </div>
  );
}

export function TextField<T extends FieldValues>({
  name,
  label,
  control,
  hint,
  required,
  type = 'text',
  placeholder,
  className = '',
}: BaseProps<T> & { type?: string; placeholder?: string }) {
  return (
    <Controller
      name={name as Path<T>}
      control={control}
      render={({ field, fieldState }) => (
        <FieldShell label={label} required={required} hint={hint} error={fieldState.error?.message} className={className}>
          <input
            type={type}
            className={`input ${fieldState.error ? 'input-error' : ''}`}
            placeholder={placeholder}
            value={inputValue(field.value)}
            onChange={(e) => field.onChange(e.target.value)}
            onBlur={field.onBlur}
          />
        </FieldShell>
      )}
    />
  );
}

export function NumberField<T extends FieldValues>({
  name,
  label,
  control,
  hint,
  required,
  placeholder,
  min = 0,
  max,
  step = 'any',
  className = '',
}: BaseProps<T> & { placeholder?: string; min?: number; max?: number; step?: string }) {
  return (
    <Controller
      name={name as Path<T>}
      control={control}
      render={({ field, fieldState }) => (
        <FieldShell label={label} required={required} hint={hint} error={fieldState.error?.message} className={className}>
          <input
            type="number"
            inputMode="decimal"
            className={`input ${fieldState.error ? 'input-error' : ''}`}
            placeholder={placeholder}
            min={min}
            max={max}
            step={step}
            value={inputValue(field.value)}
            onChange={(e) => field.onChange(e.target.value === '' ? '' : Number(e.target.value))}
            onBlur={field.onBlur}
          />
        </FieldShell>
      )}
    />
  );
}

export function DateField<T extends FieldValues>({ name, label, control, hint, required, className = '' }: BaseProps<T>) {
  return (
    <Controller
      name={name as Path<T>}
      control={control}
      render={({ field, fieldState }) => (
        <FieldShell label={label} required={required} hint={hint} error={fieldState.error?.message} className={className}>
          <input
            type="date"
            className={`input ${fieldState.error ? 'input-error' : ''}`}
            value={inputValue(field.value)}
            onChange={(e) => field.onChange(e.target.value)}
            onBlur={field.onBlur}
          />
        </FieldShell>
      )}
    />
  );
}

export function DateTimeField<T extends FieldValues>({ name, label, control, hint, required, className = '' }: BaseProps<T>) {
  return (
    <Controller
      name={name as Path<T>}
      control={control}
      render={({ field, fieldState }) => (
        <FieldShell label={label} required={required} hint={hint} error={fieldState.error?.message} className={className}>
          <input
            type="datetime-local"
            className={`input ${fieldState.error ? 'input-error' : ''}`}
            value={inputValue(field.value)}
            onChange={(e) => field.onChange(e.target.value)}
            onBlur={field.onBlur}
          />
        </FieldShell>
      )}
    />
  );
}

export function SelectField<T extends FieldValues>({
  name,
  label,
  control,
  hint,
  required,
  options,
  placeholder = 'Select…',
  className = '',
}: BaseProps<T> & { options: { value: string; label: string }[]; placeholder?: string }) {
  return (
    <Controller
      name={name as Path<T>}
      control={control}
      render={({ field, fieldState }) => (
        <FieldShell label={label} required={required} hint={hint} error={fieldState.error?.message} className={className}>
          <select
            className={`input ${fieldState.error ? 'input-error' : ''}`}
            value={inputValue(field.value)}
            onChange={(e) => field.onChange(e.target.value)}
            onBlur={field.onBlur}
          >
            <option value="" disabled={!field.value}>
              {placeholder}
            </option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </FieldShell>
      )}
    />
  );
}

export function TextareaField<T extends FieldValues>({
  name,
  label,
  control,
  hint,
  required,
  rows = 3,
  placeholder,
  className = '',
}: BaseProps<T> & { rows?: number; placeholder?: string }) {
  return (
    <Controller
      name={name as Path<T>}
      control={control}
      render={({ field, fieldState }) => (
        <FieldShell label={label} required={required} hint={hint} error={fieldState.error?.message} className={className}>
          <textarea
            rows={rows}
            className={`input resize-none ${fieldState.error ? 'input-error' : ''}`}
            placeholder={placeholder}
            value={inputValue(field.value)}
            onChange={(e) => field.onChange(e.target.value)}
            onBlur={field.onBlur}
          />
        </FieldShell>
      )}
    />
  );
}

export function CheckboxField<T extends FieldValues>({ name, label, control, hint, className = '' }: BaseProps<T>) {
  return (
    <Controller
      name={name as Path<T>}
      control={control}
      render={({ field }) => (
        <label className={`flex items-start gap-2.5 ${className}`}>
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 accent-brand-blue"
            checked={!!field.value}
            onChange={(e) => field.onChange(e.target.checked)}
          />
          <span>
            <span className="block text-[13px] font-semibold text-ink">{label}</span>
            {hint && <span className="block text-[11px] text-faint">{hint}</span>}
          </span>
        </label>
      )}
    />
  );
}
