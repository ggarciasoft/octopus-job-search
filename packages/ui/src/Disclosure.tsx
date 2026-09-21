import type { ReactNode } from 'react';
import { cn, FOCUS_RING } from './cn';

export interface DisclosureProps {
  /** The always-visible summary; it is the button, so it must name the content. */
  readonly summary: ReactNode;
  readonly children: ReactNode;
  readonly defaultOpen?: boolean;
  readonly className?: string;
  readonly 'data-testid'?: string;
}

/**
 * A native `<details>` disclosure. Used for evidence excerpts: the claim is
 * always visible and the text it was read from is one keypress away, so a
 * user can check a requirement or an inferred field without leaving the page.
 * Native so it is keyboard operable and announced without extra script.
 */
export function Disclosure({
  summary,
  children,
  defaultOpen = false,
  className,
  'data-testid': testId,
}: DisclosureProps) {
  return (
    <details
      open={defaultOpen}
      data-testid={testId}
      className={cn('rounded border border-slate-200 bg-slate-50 text-sm', className)}
    >
      <summary
        className={cn('cursor-pointer rounded px-3 py-2 font-medium text-slate-800', FOCUS_RING)}
      >
        {summary}
      </summary>
      <div className="border-t border-slate-200 px-3 py-2 text-slate-700">{children}</div>
    </details>
  );
}
