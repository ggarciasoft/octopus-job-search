import { TextArea } from '@job-getter/ui';
import { useState, type ReactNode } from 'react';
import { linesToList, listToLines } from '../profile/factValues';

export interface StringListFieldProps {
  readonly label: ReactNode;
  readonly description?: ReactNode;
  readonly error?: ReactNode;
  readonly value: readonly string[];
  readonly onChange: (next: string[]) => void;
  readonly rows?: number;
  readonly required?: boolean;
}

/**
 * A list of short strings edited as one entry per line. The text is kept
 * locally while typing so a blank line can exist mid-edit; the list handed
 * back is trimmed and free of blanks.
 */
export function StringListField({
  label,
  description,
  error,
  value,
  onChange,
  rows = 3,
  required,
}: StringListFieldProps) {
  const [text, setText] = useState(() => listToLines(value));
  return (
    <TextArea
      label={label}
      description={description}
      error={error}
      rows={rows}
      required={required}
      value={text}
      onChange={(event) => {
        const next = event.currentTarget.value;
        setText(next);
        onChange(linesToList(next));
      }}
    />
  );
}
