import { useId, type ReactNode } from 'react';
import { cn } from './cn';
import { VisuallyHidden } from './VisuallyHidden';

/**
 * The ARIA wiring a control receives from its field. Spreading this onto the
 * input is the only supported way to connect a label, a description and an
 * error, so a screen cannot ship a visually-labelled-but-unlabelled control.
 */
export interface FieldAriaProps {
  readonly id: string;
  readonly 'aria-describedby': string | undefined;
  readonly 'aria-invalid': true | undefined;
  readonly 'aria-required': true | undefined;
}

export interface FormFieldProps {
  readonly label: ReactNode;
  readonly description?: ReactNode;
  /** Present only when the field is genuinely invalid; announced immediately. */
  readonly error?: ReactNode;
  readonly required?: boolean;
  readonly id?: string;
  /** Keep the label for assistive technology while hiding it visually. */
  readonly hideLabel?: boolean;
  readonly className?: string;
  readonly children: (field: FieldAriaProps) => ReactNode;
}

export function FormField({
  label,
  description,
  error,
  required = false,
  id,
  hideLabel = false,
  className,
  children,
}: FormFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const descriptionId = `${fieldId}-description`;
  const errorId = `${fieldId}-error`;

  const describedBy =
    [description ? descriptionId : null, error ? errorId : null].filter(Boolean).join(' ') ||
    undefined;

  const labelNode = (
    <label htmlFor={fieldId} className="block text-sm font-medium text-slate-800">
      {label}
      {required ? (
        <span aria-hidden="true" className="ml-1 text-rose-700">
          *
        </span>
      ) : null}
    </label>
  );

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {hideLabel ? <VisuallyHidden as="div">{labelNode}</VisuallyHidden> : labelNode}
      {description ? (
        <p id={descriptionId} className="text-sm text-slate-600">
          {description}
        </p>
      ) : null}
      {children({
        id: fieldId,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
        'aria-required': required ? true : undefined,
      })}
      {error ? (
        <p id={errorId} role="alert" className="text-sm font-medium text-rose-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
