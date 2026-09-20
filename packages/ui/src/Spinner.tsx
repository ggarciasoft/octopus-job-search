import { cn } from './cn';
import { VisuallyHidden } from './VisuallyHidden';

export interface SpinnerProps {
  readonly size?: 'sm' | 'md';
  /** Required text so the indicator is not silent to assistive technology. */
  readonly label: string;
  readonly className?: string;
}

export function Spinner({ size = 'md', label, className }: SpinnerProps) {
  return (
    <span role="status" className={cn('inline-flex items-center', className)}>
      <span
        aria-hidden="true"
        className={cn(
          'inline-block animate-spin rounded-full border-2 border-current border-t-transparent',
          size === 'sm' ? 'h-3.5 w-3.5' : 'h-5 w-5',
        )}
      />
      <VisuallyHidden>{label}</VisuallyHidden>
    </span>
  );
}
