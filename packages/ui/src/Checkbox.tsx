import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn, DISABLED, FOCUS_RING } from './cn';

type NativeCheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'type'>;

export interface CheckboxProps extends NativeCheckboxProps {
  readonly label: ReactNode;
  readonly description?: ReactNode;
  readonly error?: ReactNode;
  readonly id?: string;
}

/**
 * A checkbox keeps its label next to the box rather than above it, so it uses
 * its own layout instead of `FormField`; the ARIA wiring is identical.
 */
export function Checkbox({
  label,
  description,
  error,
  id,
  className,
  ...rest
}: CheckboxProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const descriptionId = `${fieldId}-description`;
  const errorId = `${fieldId}-error`;
  const describedBy =
    [description ? descriptionId : null, error ? errorId : null].filter(Boolean).join(' ') ||
    undefined;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-start gap-2">
        <input
          id={fieldId}
          type="checkbox"
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className={cn('mt-0.5 h-4 w-4 rounded border-slate-400', FOCUS_RING, DISABLED, className)}
          {...rest}
        />
        <label htmlFor={fieldId} className="text-sm text-slate-800">
          {label}
        </label>
      </div>
      {description ? (
        <p id={descriptionId} className="ml-6 text-sm text-slate-600">
          {description}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="ml-6 text-sm font-medium text-rose-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
