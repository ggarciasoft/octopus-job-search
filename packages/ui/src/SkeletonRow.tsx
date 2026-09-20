import { cn } from './cn';
import { VisuallyHidden } from './VisuallyHidden';

export interface SkeletonRowProps {
  readonly columns?: number;
  readonly rows?: number;
  /** Announced once, so a loading table is not silent. */
  readonly label: string;
  readonly className?: string;
}

/**
 * Placeholder shimmer for content that is *loading*. It never stands in for
 * content that does not exist — that is `EmptyState`'s job.
 */
export function SkeletonRow({ columns = 3, rows = 3, label, className }: SkeletonRowProps) {
  return (
    <div className={cn('flex flex-col gap-2', className)} role="status" aria-busy="true">
      <VisuallyHidden as="div">{label}</VisuallyHidden>
      {Array.from({ length: rows }, (_, rowIndex) => (
        <div key={rowIndex} className="flex gap-2" aria-hidden="true">
          {Array.from({ length: columns }, (_, columnIndex) => (
            <div key={columnIndex} className="h-4 flex-1 animate-pulse rounded bg-slate-200" />
          ))}
        </div>
      ))}
    </div>
  );
}
