import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react';
import { cn } from './cn';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export interface DialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  /** Action row; the caller owns the buttons so this stays business-free. */
  readonly footer?: ReactNode;
  readonly className?: string;
}

/**
 * Modal dialog with the three behaviours a keyboard user needs: focus moves
 * into the dialog on open, Tab cycles inside it, and Escape (or a close
 * action) returns focus to whatever opened it.
 *
 * Implemented by hand rather than with `<dialog showModal>` because jsdom does
 * not implement the native modal behaviour, and an untested focus trap is worse
 * than no dialog at all.
 */
export function Dialog({ open, title, onClose, children, footer, className }: DialogProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const titleId = useId();

  const focusableElements = useCallback((): HTMLElement[] => {
    const panel = panelRef.current;
    if (!panel) return [];
    // Deliberately not filtered by `offsetParent`: that property is always null
    // in jsdom, which would make the trap untestable and silently empty.
    return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (element) => !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true',
    );
  }, []);

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const first = focusableElements()[0];
    if (first) first.focus();
    else panel?.focus();

    return () => {
      previouslyFocused.current?.focus();
    };
  }, [open, focusableElements]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const elements = focusableElements();
      if (elements.length === 0) {
        event.preventDefault();
        panelRef.current?.focus();
        return;
      }
      const first = elements[0] as HTMLElement;
      const last = elements[elements.length - 1] as HTMLElement;
      const active = document.activeElement;

      if (event.shiftKey && (active === first || !panelRef.current?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open, onClose, focusableElements]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          'flex max-h-full w-full max-w-lg flex-col gap-4 overflow-auto rounded bg-white p-5 shadow-lg',
          className,
        )}
      >
        <h2 id={titleId} className="text-lg font-semibold text-slate-900">
          {title}
        </h2>
        <div className="flex flex-col gap-3 text-sm text-slate-800">{children}</div>
        {footer ? <div className="flex justify-end gap-2">{footer}</div> : null}
      </div>
    </div>
  );
}
