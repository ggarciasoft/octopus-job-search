import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { JobGetterApi } from '../src/api/client';
import { freshnessOf } from '../src/discovery/presentation';
import { JOB_ID, JOB_ID_2, createFakeApi, makeJob, renderApp } from './helpers';

const HOUR_MS = 3_600_000;

async function openJobs(api: JobGetterApi) {
  renderApp({ client: api, route: '/jobs' });
  await screen.findByRole('heading', { name: 'Jobs', level: 1 });
}

function rowFor(title: string): HTMLElement {
  return screen.getByText(title).closest('tr') as HTMLElement;
}

describe('freshness rule', () => {
  it('flags a fetch older than 24 hours and an absent fetch, and nothing younger', () => {
    const now = Date.parse('2026-03-01T12:00:00.000Z');
    const at = (hoursAgo: number) => new Date(now - hoursAgo * HOUR_MS).toISOString();
    expect(freshnessOf({ last_fetched_at: at(1) }, now)).toBe('fresh');
    expect(freshnessOf({ last_fetched_at: at(23.9) }, now)).toBe('fresh');
    expect(freshnessOf({ last_fetched_at: at(24.1) }, now)).toBe('stale');
    expect(freshnessOf({ last_fetched_at: at(30) }, now)).toBe('stale');
    expect(freshnessOf({ last_fetched_at: null }, now)).toBe('never_fetched');
  });
});

describe('jobs list', () => {
  it('renders a null match as "Not checked" and never as a number', async () => {
    await openJobs(
      createFakeApi({
        listJobs: async () => ({ items: [makeJob({ match: null })], next_cursor: null }),
      }),
    );
    const row = await screen.findByTestId('job-row');
    expect(row.dataset.jobId).toBe(JOB_ID);
    const match = within(rowFor('Backend Engineer')).getByTestId('match-cell');
    expect(match.dataset.match).toBe('not_checked');
    expect(match.textContent).toContain('Not checked');
    expect(match.textContent).not.toMatch(/\d/);
    expect(match.textContent).not.toMatch(/%/);
    expect(screen.getByRole('link', { name: 'Backend Engineer' }).getAttribute('href')).toBe(
      `/jobs/${JOB_ID}`,
    );
  });

  it('shows "Salary unknown" for a null salary and the stated currency and period verbatim', async () => {
    await openJobs(
      createFakeApi({
        listJobs: async () => ({
          items: [
            makeJob({ id: JOB_ID, title: 'No salary role', salary: null }),
            makeJob({
              id: JOB_ID_2,
              title: 'Stated salary role',
              salary: {
                min: 90000,
                max: 120000,
                currency: 'CAD',
                period: 'year',
                source_excerpt: 'CAD 90,000 – 120,000 per year',
              },
            }),
          ],
          next_cursor: null,
        }),
      }),
    );
    await screen.findByText('No salary role');

    const unknown = within(rowFor('No salary role')).getByTestId('salary-cell');
    expect(unknown.dataset.salary).toBe('unknown');
    expect(unknown.textContent).toBe('Salary unknown');

    const stated = within(rowFor('Stated salary role')).getByTestId('salary-cell');
    expect(stated.dataset.salary).toBe('stated');
    expect(within(stated).getByTestId('salary-currency').textContent).toBe('CAD');
    expect(within(stated).getByTestId('salary-period').textContent).toBe('per year');
    expect(stated.textContent).toContain('90,000–120,000');
    // Never converted: no other currency symbol or code appears.
    expect(stated.textContent).not.toMatch(/\$|USD|EUR/);
  });

  it('flags a job whose last successful fetch is older than 24 hours, or absent', async () => {
    const now = Date.now();
    await openJobs(
      createFakeApi({
        listJobs: async () => ({
          items: [
            makeJob({
              id: JOB_ID,
              title: 'Fresh role',
              last_fetched_at: new Date(now - 2 * HOUR_MS).toISOString(),
            }),
            makeJob({
              id: JOB_ID_2,
              title: 'Stale role',
              last_fetched_at: new Date(now - 30 * HOUR_MS).toISOString(),
            }),
            makeJob({
              id: '31313131-3131-4131-8131-313131313131',
              title: 'Never fetched role',
              last_fetched_at: null,
            }),
          ],
          next_cursor: null,
        }),
      }),
    );
    await screen.findByText('Fresh role');

    expect(within(rowFor('Fresh role')).queryByTestId('stale-flag')).toBeNull();
    expect(within(rowFor('Fresh role')).getByTestId('fresh-flag')).toBeTruthy();

    const stale = within(rowFor('Stale role')).getByTestId('stale-flag');
    expect(stale.dataset.freshness).toBe('stale');
    expect(stale.textContent).toBe('May be stale — recheck before applying');

    const never = within(rowFor('Never fetched role')).getByTestId('stale-flag');
    expect(never.dataset.freshness).toBe('never_fetched');
    expect(never.textContent).toContain('recheck before applying');
  });

  it('hides excluded jobs until asked and then shows each with its reason', async () => {
    const user = userEvent.setup();
    const listJobs = vi.fn<JobGetterApi['listJobs']>(async ({ query } = {}) => ({
      items:
        query?.include_excluded === true
          ? [makeJob({ excluded_reason: 'Excluded employer: Acme Corp' })]
          : [],
      next_cursor: null,
    }));
    await openJobs(createFakeApi({ listJobs }));

    await screen.findByTestId('jobs-empty');
    expect(listJobs.mock.calls[0]?.[0]?.query).not.toHaveProperty('include_excluded');
    expect(screen.queryByTestId('job-row')).toBeNull();

    await user.click(screen.getByLabelText('Show excluded jobs'));
    await user.click(screen.getByRole('button', { name: 'Apply filters' }));
    await screen.findByTestId('job-row');
    expect(listJobs.mock.lastCall?.[0]?.query).toMatchObject({ include_excluded: true });
    expect(screen.getByTestId('excluded-reason').textContent).toBe(
      'Excluded: Excluded employer: Acme Corp',
    );
  });

  it('sends each filter only when it is set', async () => {
    const user = userEvent.setup();
    const listJobs = vi.fn<JobGetterApi['listJobs']>(async () => ({
      items: [],
      next_cursor: null,
    }));
    await openJobs(createFakeApi({ listJobs }));
    await screen.findByTestId('jobs-empty');
    expect(listJobs.mock.calls[0]?.[0]?.query).toEqual({ limit: 25 });

    await user.type(screen.getByLabelText(/^Search title or company/), 'engineer');
    await user.selectOptions(screen.getByLabelText(/^Status/), 'closed');
    await user.click(screen.getByLabelText('Saved only'));
    await user.click(screen.getByRole('button', { name: 'Apply filters' }));
    await waitFor(() => expect(listJobs.mock.calls.length).toBeGreaterThan(1));
    const sent = listJobs.mock.lastCall?.[0]?.query;
    expect(sent).toEqual({ limit: 25, query: 'engineer', status: 'closed', saved: true });
    // Left at "Any", the fit filters are absent rather than sent as a zero
    // threshold or an "unknown" verdict, either of which would silently
    // narrow the page.
    expect(sent).not.toHaveProperty('min_score');
    expect(sent).not.toHaveProperty('eligible');
  });

  it('sends the fit filters once they are chosen', async () => {
    const user = userEvent.setup();
    const listJobs = vi.fn<JobGetterApi['listJobs']>(async () => ({
      items: [],
      next_cursor: null,
    }));
    await openJobs(createFakeApi({ listJobs }));
    await screen.findByTestId('jobs-empty');

    await user.selectOptions(screen.getByLabelText(/^Minimum ranking/), '70');
    await user.selectOptions(screen.getByLabelText(/^Eligibility/), 'yes');
    await user.click(screen.getByRole('button', { name: 'Apply filters' }));
    await waitFor(() => expect(listJobs.mock.calls.length).toBeGreaterThan(1));

    expect(listJobs.mock.lastCall?.[0]?.query).toMatchObject({
      min_score: 70,
      eligible: 'yes',
    });
  });

  it('warns that a fit filter can only ever match jobs that were checked', async () => {
    await openJobs(createFakeApi());
    await screen.findByLabelText(/^Minimum ranking/);

    expect(screen.getByText(/Only jobs you have checked can pass this/)).toBeTruthy();
  });

  it('shows an empty state that suggests boards, a scan and relaxed filters, with no rows', async () => {
    const user = userEvent.setup();
    const { container } = renderApp({
      client: createFakeApi({ listJobs: async () => ({ items: [], next_cursor: null }) }),
      route: '/jobs',
    });
    await screen.findByRole('heading', { name: 'Jobs', level: 1 });

    const empty = await screen.findByTestId('jobs-empty');
    expect(empty.textContent).toContain('No example jobs are shown in its place');
    expect(
      within(empty)
        .getByRole('link', { name: 'Add a board on the Discover screen.' })
        .getAttribute('href'),
    ).toBe('/discover');
    expect(within(empty).getByText(/Run a scan of a registered board/)).toBeTruthy();
    expect(container.querySelectorAll('tbody tr')).toHaveLength(0);
    expect(screen.queryByTestId('job-row')).toBeNull();
    expect(screen.queryByTestId('match-cell')).toBeNull();

    // With a filter active the empty state also says to relax it.
    await user.type(screen.getByLabelText(/^Search title or company/), 'nothing');
    await user.click(screen.getByRole('button', { name: 'Apply filters' }));
    expect(await screen.findByText(/Relax the filters/)).toBeTruthy();
  });

  it('saves with the current revision and reflects the API answer', async () => {
    const user = userEvent.setup();
    const patchJob = vi.fn<JobGetterApi['patchJob']>(async () =>
      makeJob({ saved: true, revision: 2 }),
    );
    await openJobs(
      createFakeApi({
        listJobs: async () => ({ items: [makeJob({ revision: 1 })], next_cursor: null }),
        patchJob,
      }),
    );
    await user.click(await screen.findByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patchJob).toHaveBeenCalledTimes(1));
    expect(patchJob.mock.calls[0]?.[0]).toEqual({
      params: { id: JOB_ID },
      body: { expected_revision: 1, saved: true },
    });
    expect(await screen.findByRole('button', { name: 'Unsave' })).toBeTruthy();
    expect(screen.getByText('Saved')).toBeTruthy();
  });

  it('shows provenance count and the possible-duplicate flag', async () => {
    await openJobs(
      createFakeApi({
        listJobs: async () => ({
          items: [
            makeJob({
              sources: [
                ...makeJob().sources,
                {
                  id: '41414141-4141-4141-8141-414141414141',
                  source_id: null,
                  connector: 'url',
                  external_id: 'url:example',
                  canonical_url: 'https://example.test/job',
                  apply_url: null,
                  retrieved_at: '2026-01-02T00:00:00.000Z',
                },
              ],
              possible_duplicates: [
                {
                  job_id: JOB_ID_2,
                  reason: 'similar_title_and_location',
                  detail: 'Same title, same city',
                },
              ],
            }),
          ],
          next_cursor: null,
        }),
      }),
    );
    await screen.findByTestId('job-row');
    expect(screen.getByTestId('sources-count').textContent).toBe('2 sources');
    expect(screen.getByTestId('duplicates-flag').textContent).toContain('Possible duplicate');
  });
});
