import type { ReactNode } from 'react';
import { cn } from './cn';

export type CalloutTone = 'info' | 'warning' | 'error' | 'success';

const TONES: Record<CalloutTone, string> = {
  info: 'border-sky-300 bg-sky-50 text-sky-950',
  warning: 'border-amber-300 bg-amber-50 text-amber-950',
  error: 'border-rose-300 bg-rose-50 text-rose-950',
  success: 'border-emerald-300 bg-emerald-50 text-emerald-950',
};

export interface CalloutProps {
  readonly tone: CalloutTone;
  readonly title?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
  /**
   * Errors and warnings produced in response to a user action are announced.
   * Static page copy should not be, so this defaults to the tone rather than
   * making every callout shout.
   */
  readonly live?: boolean;
}

export function Callout({ tone, title, children, className, live }: CalloutProps) {
  const announce = live ?? (tone === 'error' || tone === 'warning');
  return (
    <div
      role={tone === 'error' ? 'alert' : announce ? 'status' : undefined}
      className={cn('rounded border p-3 text-sm', TONES[tone], className)}
    >
      {title ? <p className="mb-1 font-semibold">{title}</p> : null}
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}
