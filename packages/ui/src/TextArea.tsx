import type { ReactNode, TextareaHTMLAttributes } from 'react';
import { cn, DISABLED, FOCUS_RING } from './cn';
import { FormField } from './FormField';
import { INPUT_CLASS } from './TextField';

type NativeTextAreaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id' | 'required'>;

export interface TextAreaProps extends NativeTextAreaProps {
  readonly label: ReactNode;
  readonly description?: ReactNode;
  readonly error?: ReactNode;
  readonly required?: boolean;
  readonly id?: string;
  readonly hideLabel?: boolean;
  readonly fieldClassName?: string;
}

export function TextArea({
  label,
  description,
  error,
  required,
  id,
  hideLabel,
  fieldClassName,
  className,
  rows = 4,
  ...rest
}: TextAreaProps) {
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
        <textarea
          {...field}
          {...rest}
          rows={rows}
          required={required}
          className={cn(INPUT_CLASS, FOCUS_RING, DISABLED, className)}
        />
      )}
    </FormField>
  );
}
