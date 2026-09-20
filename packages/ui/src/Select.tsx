import type { ReactNode, SelectHTMLAttributes } from 'react';
import { cn, DISABLED, FOCUS_RING } from './cn';
import { FormField } from './FormField';
import { INPUT_CLASS } from './TextField';

export interface SelectOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
}

type NativeSelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id' | 'required'>;

export interface SelectProps extends NativeSelectProps {
  readonly label: ReactNode;
  readonly options: readonly SelectOption[];
  readonly description?: ReactNode;
  readonly error?: ReactNode;
  readonly required?: boolean;
  readonly id?: string;
  readonly hideLabel?: boolean;
  readonly fieldClassName?: string;
  /** Rendered first as an empty value; omit when a value is always present. */
  readonly placeholder?: string;
}

export function Select({
  label,
  options,
  description,
  error,
  required,
  id,
  hideLabel,
  fieldClassName,
  placeholder,
  className,
  ...rest
}: SelectProps) {
  return (
    <FormField
      label={label}
      description={description}
      error={error}
      required={required}
      id={id}
      hideLabel={hideLabel}
      className={fieldClassName}
    >
      {(field) => (
        <select
          {...field}
          {...rest}
          required={required}
          className={cn(INPUT_CLASS, FOCUS_RING, DISABLED, className)}
        >
          {placeholder === undefined ? null : <option value="">{placeholder}</option>}
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </FormField>
  );
}
