import type { ReactNode } from 'react';
import { cn } from './cn';

export interface EmptyStateProps {
  readonly title: ReactNode;
  /** What is actually absent, in the user's terms. */
  readonly body: ReactNode;
  /**
   * Concrete next steps. 08_UX_AND_CUSTOMIZATION.md requires an empty job list
   * to suggest adding boards or relaxing filters — never to fabricate example
   * rows as if they were live results, so this component renders suggestions
   * and actions only, never sample data.
   */
  readonly suggestions?: readonly ReactNode[];
  readonly actions?: ReactNode;
  readonly className?: string;
}

export function EmptyState({ title, body, suggestions, actions, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded border border-dashed border-slate-300 bg-slate-50 p-6',
        className,
      )}
    >
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      <p className="text-sm text-slate-700">{body}</p>
      {suggestions && suggestions.length > 0 ? (
        <ul className="list-disc pl-5 text-sm text-slate-700">
          {suggestions.map((suggestion, index) => (
            <li key={index}>{suggestion}</li>
          ))}
        </ul>
      ) : null}
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
