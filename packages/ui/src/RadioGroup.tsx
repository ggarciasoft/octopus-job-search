import { useId, type ReactNode } from 'react';
import { cn, DISABLED, FOCUS_RING } from './cn';

export interface RadioOption<Value extends string = string> {
  readonly value: Value;
  readonly label: ReactNode;
  readonly description?: ReactNode;
  readonly disabled?: boolean;
}

export interface RadioGroupProps<Value extends string = string> {
  readonly legend: ReactNode;
  readonly name: string;
  readonly options: readonly RadioOption<Value>[];
  readonly value: Value | null;
  readonly onValueChange: (value: Value) => void;
  readonly description?: ReactNode;
  readonly error?: ReactNode;
  readonly required?: boolean;
  readonly className?: string;
}

/**
 * A native radio group inside a `fieldset`/`legend`, which is what assistive
 * technology expects for "choose one of these". Arrow-key navigation comes from
 * the platform; we do not reimplement it.
 */
export function RadioGroup<Value extends string = string>({
  legend,
  name,
  options,
  value,
  onValueChange,
  description,
  error,
  required = false,
  className,
}: RadioGroupProps<Value>) {
  const groupId = useId();
  const descriptionId = `${groupId}-description`;
  const errorId = `${groupId}-error`;
  const describedBy =
    [description ? descriptionId : null, error ? errorId : null].filter(Boolean).join(' ') ||
    undefined;

  return (
    <fieldset
      className={cn('flex flex-col gap-2 border-0 p-0', className)}
      aria-describedby={describedBy}
      aria-invalid={error ? true : undefined}
      aria-required={required ? true : undefined}
    >
      <legend className="text-sm font-medium text-slate-800">{legend}</legend>
      {description ? (
        <p id={descriptionId} className="text-sm text-slate-600">
          {description}
        </p>
      ) : null}
      <div className="flex flex-col gap-2">
        {options.map((option) => {
          const optionId = `${groupId}-${option.value}`;
          const optionDescriptionId = `${optionId}-description`;
          return (
            <div key={option.value} className="flex items-start gap-2">
              <input
                id={optionId}
                type="radio"
                name={name}
                value={option.value}
                checked={value === option.value}
                disabled={option.disabled}
                aria-describedby={option.description ? optionDescriptionId : undefined}
                onChange={() => onValueChange(option.value)}
                className={cn('mt-0.5 h-4 w-4 border-slate-400', FOCUS_RING, DISABLED)}
              />
              <div className="flex flex-col">
                <label htmlFor={optionId} className="text-sm text-slate-800">
                  {option.label}
                </label>
                {option.description ? (
                  <p id={optionDescriptionId} className="text-sm text-slate-600">
                    {option.description}
                  </p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      {error ? (
        <p id={errorId} role="alert" className="text-sm font-medium text-rose-700">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
