/**
 * Shared UI primitives for Job Getter.
 *
 * Rules for this package (see README.md):
 *  - no business logic, no data fetching, no product vocabulary except the
 *    status union, which exists precisely so product vocabulary cannot drift;
 *  - every interactive element is keyboard reachable and shows a visible focus
 *    ring (08_UX_AND_CUSTOMIZATION.md);
 *  - nothing here fabricates content: `EmptyState` renders suggestions, never
 *    sample rows.
 */
export { cn, FOCUS_RING, DISABLED } from './cn';

export { Badge } from './Badge';
export type { BadgeProps, BadgeTone } from './Badge';

export { Button } from './Button';
export type { ButtonProps, ButtonSize, ButtonVariant } from './Button';

export { Callout } from './Callout';
export type { CalloutProps, CalloutTone } from './Callout';

export { Checkbox } from './Checkbox';
export type { CheckboxProps } from './Checkbox';

export { Dialog } from './Dialog';
export type { DialogProps } from './Dialog';

export { EmptyState } from './EmptyState';
export type { EmptyStateProps } from './EmptyState';

export { FormField } from './FormField';
export type { FieldAriaProps, FormFieldProps } from './FormField';

export { ProgressBar } from './ProgressBar';
export type { ProgressBarProps } from './ProgressBar';

export { RadioGroup } from './RadioGroup';
export type { RadioGroupProps, RadioOption } from './RadioGroup';

export { Select } from './Select';
export type { SelectOption, SelectProps } from './Select';

export { SkeletonRow } from './SkeletonRow';
export type { SkeletonRowProps } from './SkeletonRow';

export { Spinner } from './Spinner';
export type { SpinnerProps } from './Spinner';

export { Table } from './Table';
export type { TableColumn, TableProps } from './Table';

export { TextArea } from './TextArea';
export type { TextAreaProps } from './TextArea';

export { INPUT_CLASS, TextField } from './TextField';
export type { TextFieldProps } from './TextField';

export { VisuallyHidden } from './VisuallyHidden';
export type { VisuallyHiddenProps } from './VisuallyHidden';

export { StatusBadge } from './StatusBadge';
export type { StatusBadgeProps } from './StatusBadge';

export {
  describeStatus,
  isStatusKey,
  isSubmitted,
  isVerifiedSubmission,
  STATUS_DESCRIPTORS,
  STATUS_KEYS,
  STATUS_VOCABULARY,
} from './status';
export type { StatusDescriptor, StatusEvidence, StatusIconHint, StatusKey } from './status';
