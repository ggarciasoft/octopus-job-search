import type { Locale } from '@job-getter/contracts';
import { en } from './en';

/** Every key the UI may ask for. Derived from the English catalogue. */
export type MessageKey = keyof typeof en;

export type MessageParams = Readonly<Record<string, string | number>>;

/** Locale comes from the contract (`en` | `es`); it is not re-declared here. */
export const SUPPORTED_LOCALES: readonly Locale[] = ['en', 'es'];

export function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'es';
}

/**
 * Substitutes `{name}` placeholders. A missing key returns the key itself so a
 * gap is loud in the UI and in tests, rather than rendering an empty string.
 */
export function translate(
  catalogue: Readonly<Record<MessageKey, string>>,
  key: MessageKey,
  params?: MessageParams,
): string {
  const template = catalogue[key];
  if (typeof template !== 'string') return key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}
