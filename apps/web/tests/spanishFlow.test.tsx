/**
 * AT27, the half about a flow rather than a catalogue.
 *
 *   AT27 | English/Spanish flow | Labels, Unicode, dates and documents correct
 *
 * `i18n.test.tsx` proves the catalogue is complete and that no raw key reaches a
 * Spanish screen. `format.test.ts` proves a date and a number are formatted the
 * way a Spanish reader expects. Neither of those touches the thing in between:
 * a screen carrying **real data**, in Spanish, with accented characters in the
 * data itself rather than only in the labels.
 *
 * That gap matters because the data is not ours. An employer's name, a job
 * title and a city all arrive from a board and go straight onto the screen and
 * then into a CV; a pipeline that mangles `Ñ` in a label would be caught by the
 * catalogue test, and one that mangles it in a *value* would not be caught by
 * anything. So every string asserted below is accented, and none of it comes
 * from the message catalogue.
 */
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeApi, makeJob, makeJobDetail, makeMatchSummary, renderApp } from './helpers';

/** Accented values that arrive as *data*, never from the catalogue. */
const COMPANY = 'Compañía Ferroviaria Española';
const TITLE = 'Ingeniera de Programación Sénior';
const CITY = 'Alcalá de Henares';

beforeEach(() => {
  globalThis.localStorage.setItem('job-getter.locale', 'es');
});

afterEach(() => {
  globalThis.localStorage.removeItem('job-getter.locale');
});

function spanishJob() {
  return makeJob({
    company: COMPANY,
    title: TITLE,
    locations: [{ country: 'ES', region: null, city: CITY, source_excerpt: null }],
    published_at: '2026-09-21T15:04:05.000Z',
    last_seen_at: '2026-09-21T15:04:05.000Z',
    last_fetched_at: '2026-09-21T15:04:05.000Z',
    match: makeMatchSummary({ score: 1234, eligible: 'unknown' }),
  });
}

describe('a Spanish flow over real data', () => {
  it('renders accented employer, title and city exactly as they arrived', async () => {
    renderApp({
      client: createFakeApi({
        listJobs: async () => ({ items: [spanishJob()], next_cursor: null }),
      }),
      route: '/jobs',
    });

    await screen.findByRole('heading', { name: 'Empleos', level: 1 });

    // Byte-for-byte. A normalisation step that turned `ñ` into `n`, or into a
    // decomposed `n` plus a combining tilde, would render identically here and
    // is exactly what this asserts against: `toHaveTextContent` would pass on
    // the decomposed form, `textContent` equality does not.
    const cell = await screen.findByTestId('job-row');
    const row = cell.closest('tr') as HTMLElement;
    expect(within(cell).getByText(TITLE).textContent).toBe(TITLE);
    expect(cell.textContent).toContain(COMPANY);
    expect(row.textContent).toContain(CITY);
  });

  it('carries the accented title through to the job detail screen', async () => {
    const api = createFakeApi({
      listJobs: async () => ({ items: [spanishJob()], next_cursor: null }),
      getJob: async () => makeJobDetail({ ...spanishJob(), description_text: 'Descripción.' }),
    });
    renderApp({ client: api, route: '/jobs' });

    await screen.findByRole('heading', { name: 'Empleos', level: 1 });
    await userEvent.click(await screen.findByRole('link', { name: TITLE }));

    // Two screens, one flow: the point is that nothing re-encodes the value on
    // the way between them.
    const heading = await screen.findByRole('heading', { name: TITLE });
    expect(heading.textContent).toBe(TITLE);
    expect(document.body.textContent).toContain(COMPANY);
  });

  it('shows a date in Spanish order on a screen with real data', async () => {
    renderApp({
      client: createFakeApi({
        listJobs: async () => ({ items: [spanishJob()], next_cursor: null }),
      }),
      route: '/jobs',
    });

    await screen.findByRole('heading', { name: 'Empleos', level: 1 });
    const row = (await screen.findByTestId('job-row')).closest('tr') as HTMLElement;
    const text = row.textContent ?? '';

    // 21 September 2026. In Spanish the day leads; `9/21` would be the same two
    // numbers in the order the reader does not expect.
    const day = text.indexOf('21');
    const month = text.search(/sept?/i);
    expect(day).toBeGreaterThanOrEqual(0);
    expect(month).toBeGreaterThanOrEqual(0);
    expect(day).toBeLessThan(month);
  });

  it('keeps the document language attribute in step with the flow', async () => {
    renderApp({
      client: createFakeApi({
        listJobs: async () => ({ items: [spanishJob()], next_cursor: null }),
      }),
      route: '/jobs',
    });

    await screen.findByRole('heading', { name: 'Empleos', level: 1 });
    // Not decoration: a screen reader picks its voice from this, and reading
    // Spanish with an English voice is unintelligible rather than merely wrong.
    expect(document.documentElement.lang).toBe('es');
  });

  it('renders the same data in English when the locale says so', async () => {
    globalThis.localStorage.setItem('job-getter.locale', 'en');
    renderApp({
      client: createFakeApi({
        listJobs: async () => ({ items: [spanishJob()], next_cursor: null }),
      }),
      route: '/jobs',
    });

    await screen.findByRole('heading', { name: 'Jobs', level: 1 });
    const row = await screen.findByTestId('job-row');

    // The labels change language. The employer's name does not: it is theirs,
    // not a string we own, and translating it would be inventing a company.
    expect(row.textContent).toContain(COMPANY);
    expect(row.textContent).toContain(TITLE);
  });
});
