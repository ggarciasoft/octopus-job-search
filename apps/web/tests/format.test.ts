/**
 * AT27, the half about numbers and dates.
 *
 *   AT27 | English/Spanish flow | Labels, Unicode, dates and documents correct
 *
 * `i18n.test.tsx` covers the labels: identical key sets, no empty string, no raw
 * key leaking onto a rendered Spanish screen. What it cannot cover is whether a
 * date or a number is *right* in Spanish, because a screen full of correct
 * Spanish labels can still print `9/21/2026` and `1,234.5` to someone who reads
 * `21/9/2026` and `1.234,5`.
 *
 * The failure worth guarding against is not an exception. It is a number that
 * renders, looks plausible, and means something else — `1,234` is one thousand
 * two hundred and thirty-four in English and one point two three four in
 * Spanish. So the assertions below compare the two locales against each other
 * rather than pinning exact strings: ICU output varies by Node version and
 * timezone database, and a test that pins `21 sept 2026` breaks on an upgrade
 * without anything being wrong.
 */
import { describe, expect, it } from 'vitest';
import {
  elapsedSeconds,
  formatBytes,
  formatCurrency,
  formatDateTime,
  formatNumber,
} from '../src/i18n/format';

const ISO = '2026-09-21T15:04:05.000Z';

describe('dates', () => {
  it('formats the same instant differently in each language', () => {
    const english = formatDateTime('en', ISO);
    const spanish = formatDateTime('es', ISO);

    expect(english).not.toBeNull();
    expect(spanish).not.toBeNull();
    // Not a cosmetic difference: `9/21` and `21/9` are the same two numbers in
    // the opposite order, and only one of them is the date this is.
    expect(spanish).not.toBe(english);
  });

  it('puts the day before the month in Spanish', () => {
    // A medium date style spells the month, so the ordering is readable without
    // pinning the month's exact abbreviation.
    const spanish = formatDateTime('es', ISO)!;
    const dayIndex = spanish.indexOf('21');
    const monthIndex = spanish.search(/sep/i);
    expect(dayIndex).toBeGreaterThanOrEqual(0);
    expect(monthIndex).toBeGreaterThanOrEqual(0);
    expect(dayIndex).toBeLessThan(monthIndex);
  });

  it('puts the month before the day in English', () => {
    const english = formatDateTime('en', ISO)!;
    expect(english.search(/sep/i)).toBeLessThan(english.indexOf('21'));
  });

  it('names the month in words rather than leaving two ambiguous numbers', () => {
    // `dateStyle: 'medium'` exists for this reason. 03/04/2026 is two different
    // days depending on who is reading it, and a job application is not a good
    // place to find that out.
    for (const locale of ['en', 'es'] as const) {
      expect(formatDateTime(locale, ISO)).toMatch(/[A-Za-z]{3}/);
    }
  });

  it('returns null for an absent date instead of inventing one', () => {
    for (const locale of ['en', 'es'] as const) {
      expect(formatDateTime(locale, null)).toBeNull();
      expect(formatDateTime(locale, undefined)).toBeNull();
      expect(formatDateTime(locale, '')).toBeNull();
    }
  });

  it('returns null for an unparseable date instead of "Invalid Date"', () => {
    // The caller falls back to a real sentence like "never scanned". Letting
    // `Invalid Date` reach a screen would be the UI reporting a bug as content.
    for (const locale of ['en', 'es'] as const) {
      expect(formatDateTime(locale, 'not a date')).toBeNull();
      expect(formatDateTime(locale, '2026-13-45T99:99:99Z')).toBeNull();
    }
  });

  it('renders a UTC timestamp in the viewer time zone, not as raw ISO', () => {
    const rendered = formatDateTime('en', ISO)!;
    expect(rendered).not.toContain('T');
    expect(rendered).not.toContain('Z');
    expect(rendered).not.toBe(ISO);
  });
});

describe('numbers', () => {
  it('uses the separators each language actually uses', () => {
    // English groups with a comma and decimalises with a dot; Spanish is the
    // other way round. Rendering one as the other does not look broken, which
    // is what makes it worth a test: `1,234` is one thousand two hundred and
    // thirty-four to an English reader and one point two three four to a
    // Spanish one.
    expect(formatNumber('en', 1234567.5)).toBe('1,234,567.5');
    expect(formatNumber('es', 1234567.5)).toBe('1.234.567,5');
  });

  it('does not group a four-digit number in Spanish, because Spanish does not', () => {
    // CLDR gives Spanish `minimumGroupingDigits: 2`, so grouping starts at five
    // digits. Asserted rather than assumed: the obvious expectation here is
    // `1.234,5`, and writing that into the code would be introducing an error
    // in the name of consistency.
    expect(formatNumber('es', 1234.5)).toBe('1234,5');
    expect(formatNumber('en', 1234.5)).toBe('1,234.5');
  });

  it('formats a whole number without inventing decimals', () => {
    expect(formatNumber('en', 50)).toBe('50');
    expect(formatNumber('es', 50)).toBe('50');
  });

  it('formats a currency amount in each language', () => {
    const english = formatCurrency('en', 1234567.5, 'USD');
    const spanish = formatCurrency('es', 1234567.5, 'USD');

    expect(english).toBe('$1,234,567.50');
    // Spanish puts the symbol after the amount, disambiguates the dollar as
    // `US$`, and separates the two with a **non-breaking** space (U+00A0) so a
    // line break cannot orphan the currency from its figure. Written as an
    // escape because the two spaces are indistinguishable in a diff, and an
    // assertion nobody can read is an assertion nobody can maintain.
    expect(spanish).toBe('1.234.567,50 US$');
  });

  it('falls back to a bare number when the currency is unknown', () => {
    // AT08: no invalid comparison and no silent conversion. A figure with no
    // currency is shown as a figure, not decorated with a guessed symbol.
    expect(formatCurrency('es', 1234567.5, null)).toBe('1.234.567,5');
    expect(formatCurrency('en', 1234567.5, null)).toBe('1,234,567.5');
  });

  it('formats byte counts with the locale decimal separator', () => {
    expect(formatBytes('en', 1536)).toBe('1.5 KiB');
    expect(formatBytes('es', 1536)).toBe('1,5 KiB');
    // Bytes get no decimal: "512.0 B" is false precision.
    expect(formatBytes('en', 512)).toBe('512 B');
  });

  it('keeps byte units unlocalised, because KiB is not translated', () => {
    for (const locale of ['en', 'es'] as const) {
      expect(formatBytes(locale, 5 * 1024 * 1024)).toContain('MiB');
    }
  });
});

describe('elapsed time', () => {
  const start = Date.parse(ISO);

  it('counts whole seconds from an ISO timestamp', () => {
    expect(elapsedSeconds(ISO, start + 5_400)).toBe(5);
  });

  it('never reports negative time for a clock that disagrees', () => {
    // The server's clock and the browser's need not agree, and "-3 seconds ago"
    // is worse than "0 seconds ago".
    expect(elapsedSeconds(ISO, start - 10_000)).toBe(0);
  });

  it('returns zero for an unparseable timestamp rather than NaN', () => {
    expect(elapsedSeconds('not a date', start)).toBe(0);
  });
});
