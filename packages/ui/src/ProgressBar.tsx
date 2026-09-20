import { cn } from './cn';

export interface ProgressBarProps {
  /**
   * Percent 0-100, or `null` when the backend has not reported progress. A
   * null value renders an indeterminate bar: inventing "50%" would be a claim
   * the server never made.
   */
  readonly percent: number | null;
  readonly label: string;
  /** Visible text describing the current stage, when one is known. */
  readonly stage?: string | null;
  readonly className?: string;
}

export function ProgressBar({ percent, label, stage, className }: ProgressBarProps) {
  const determinate = typeof percent === 'number' && Number.isFinite(percent);
  const clamped = determinate ? Math.min(100, Math.max(0, Math.round(percent))) : null;

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex items-baseline justify-between text-sm text-slate-700">
        <span>{stage ?? label}</span>
        {clamped === null ? null : <span>{clamped}%</span>}
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clamped ?? undefined}
        aria-valuetext={clamped === null ? 'Progress not reported' : `${clamped}%`}
        className="h-2 w-full overflow-hidden rounded bg-slate-200"
      >
        <div
          className={cn(
            'h-full bg-sky-700',
            clamped === null ? 'w-1/3 animate-pulse' : 'transition-[width]',
          )}
          style={clamped === null ? undefined : { width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}
