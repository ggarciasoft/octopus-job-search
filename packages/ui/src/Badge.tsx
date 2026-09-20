import type { ReactNode } from 'react';
import { cn } from './cn';

export type BadgeTone =
  'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'attention' | 'unknown';

/**
 * `unknown` is deliberately its own tone rather than a grey "success". The
 * product rule is that unknown salary, sponsorship or eligibility stays unknown
 * and never reads as a positive answer (01_PRODUCT_REQUIREMENTS.md).
 */
const TONES: Record<BadgeTone, string> = {
  neutral: 'border-slate-300 bg-slate-100 text-slate-800',
  info: 'border-sky-300 bg-sky-100 text-sky-900',
  success: 'border-emerald-300 bg-emerald-100 text-emerald-900',
  warning: 'border-amber-300 bg-amber-100 text-amber-900',
  danger: 'border-rose-300 bg-rose-100 text-rose-900',
  attention: 'border-violet-300 bg-violet-100 text-violet-900',
  unknown: 'border-slate-400 bg-white text-slate-700 border-dashed',
};

export interface BadgeProps {
  readonly tone?: BadgeTone;
  readonly children: ReactNode;
  readonly className?: string;
  readonly title?: string;
}

export function Badge({ tone = 'neutral', children, className, title }: BadgeProps) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
