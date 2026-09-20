import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn, DISABLED, FOCUS_RING } from './cn';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-sky-700 text-white hover:bg-sky-800 border border-transparent',
  secondary: 'bg-white text-slate-900 border border-slate-300 hover:bg-slate-50',
  danger: 'bg-rose-700 text-white hover:bg-rose-800 border border-transparent',
  ghost: 'bg-transparent text-slate-800 border border-transparent hover:bg-slate-100',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'px-2.5 py-1 text-sm',
  md: 'px-3.5 py-2 text-sm',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  /**
   * Shows a spinner and disables the control. `busyLabel` is announced so a
   * screen-reader user is told work is in flight rather than nothing happening.
   */
  readonly busy?: boolean;
  readonly busyLabel?: string;
  readonly children: ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  busy = false,
  busyLabel,
  disabled,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      // An explicit default type stops a button inside a form submitting by accident.
      type={type}
      disabled={disabled === true || busy}
      aria-busy={busy || undefined}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded font-medium',
        VARIANTS[variant],
        SIZES[size],
        FOCUS_RING,
        DISABLED,
        className,
      )}
      {...rest}
    >
      {busy ? <Spinner size="sm" label={busyLabel ?? 'Working'} /> : null}
      <span>{children}</span>
    </button>
  );
}
