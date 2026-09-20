import type { ReactNode } from 'react';

export interface VisuallyHiddenProps {
  readonly children: ReactNode;
  /** Render as a different element when the context needs a block/inline tag. */
  readonly as?: 'span' | 'div';
}

/**
 * Content that is available to assistive technology but not painted. Used for
 * live-region announcements and for labels a sighted user infers from layout.
 */
export function VisuallyHidden({ children, as = 'span' }: VisuallyHiddenProps) {
  const className = 'absolute h-px w-px overflow-hidden whitespace-nowrap border-0 p-0 -m-px';
  if (as === 'div') return <div className={className}>{children}</div>;
  return <span className={className}>{children}</span>;
}
