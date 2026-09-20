import type { InputHTMLAttributes, ReactNode } from 'react';
import { cn, DISABLED, FOCUS_RING } from './cn';
import { FormField } from './FormField';

export const INPUT_CLASS =
  'w-full rounded border border-slate-400 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500 aria-invalid:border-rose-600';

type NativeInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'required'>;

export interface TextFieldProps extends NativeInputProps {
  readonly label: ReactNode;
  readonly description?: ReactNode;
  readonly error?: ReactNode;
  readonly required?: boolean;
  readonly id?: string;
  readonly hideLabel?: boolean;
  readonly fieldClassName?: string;
}

/** Single-line text input with its label, description and error already wired. */
export function TextField({
  label,
  description,
  error,
  required,
  id,
  hideLabel,
  fieldClassName,
  className,
  type = 'text',
  ...rest
}: TextFieldProps) {
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
        <input
          {...field}
          {...rest}
          type={type}
          required={required}
          className={cn(INPUT_CLASS, FOCUS_RING, DISABLED, className)}
        />
      )}
    </FormField>
  );
}
