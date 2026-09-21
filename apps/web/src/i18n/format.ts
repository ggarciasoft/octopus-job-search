import type { Locale } from '@job-getter/contracts';

/**
 * All dates and numbers go through `Intl` so Spanish shows Spanish
 * conventions (08_UX_AND_CUSTOMIZATION.md, AT27). Timestamps from the API are
 * ISO-8601 UTC strings and are rendered in the viewer's own time zone.
 */
export function formatDateTime(locale: Locale, iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'medium' }).format(date);
}

export function formatNumber(locale: Locale, value: number): string {
  return new Intl.NumberFormat(locale).format(value);
}

export function formatCurrency(locale: Locale, value: number, currency: string | null): string {
  if (!currency) return formatNumber(locale, value);
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value);
}

/** Elapsed seconds, rounded down; the caller supplies the unit label. */
export function elapsedSeconds(fromIso: string, toMs: number): number {
  const from = new Date(fromIso).getTime();
  if (Number.isNaN(from)) return 0;
  return Math.max(0, Math.floor((toMs - from) / 1000));
}

/**
 * A byte count a person can read. Binary units, because that is what a file
 * manager shows, and one decimal place because two is noise at this scale.
 */
export function formatBytes(locale: Locale, bytes: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rendered = new Intl.NumberFormat(locale, {
    maximumFractionDigits: unit === 0 ? 0 : 1,
  }).format(value);
  return `${rendered} ${units[unit]}`;
}
