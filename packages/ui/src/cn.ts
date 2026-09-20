import clsx, { type ClassValue } from 'clsx';

/** Single class-name joiner so every primitive merges overrides the same way. */
export function cn(...values: ClassValue[]): string {
  return clsx(values);
}

/**
 * Every interactive element in this package must be keyboard reachable with a
 * *visible* focus indicator (08_UX_AND_CUSTOMIZATION.md: "accessible labels,
 * keyboard navigation, visible focus"). Keeping the ring in one constant means
 * a new primitive cannot quietly ship without one.
 */
export const FOCUS_RING =
  'outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600';

/** Shared disabled treatment; disabled controls stay readable, not invisible. */
export const DISABLED = 'disabled:cursor-not-allowed disabled:opacity-60';
