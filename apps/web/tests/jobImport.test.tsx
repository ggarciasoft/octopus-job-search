import type { NormalizedJob, TaskView } from '@job-getter/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { JobGetterApi } from '../src/api/client';
import {
  JOB_ID,
  TASK_ID,
  createFakeApi,
  makeCapabilities,
  makeMe,
  makeTask,
  renderApp,
} from './helpers';

const PAGE_URL = 'https://careers.example.test/jobs/123';

function discoveryMe(overrides: { worker_online?: boolean } = {}) {
  return makeMe({ capabilities: makeCapabilities({ job_discovery: true, ...overrides }) });
}

function makeNormalizedJob(overrides: Partial<NormalizedJob> = {}): NormalizedJob {
  return {
    external_id: 'url:careers.example.test/jobs/123',
    source_key: 'url:careers.example.test/jobs/123',
    canonical_url: PAGE_URL,
    apply_url: null,
    company: 'Example Co',
    title: 'Data Engineer',
    description_text: 'Build pipelines.',
    published_at: null,
    updated_at: null,
    locations: [],
    remote_type: 'unknown',
    eligible_countries: null,
    employment_type: null,
    salary: null,
    language: null,
    requirements: [],
    inferred: [],
    content_hash: 'b'.repeat(64),
    retrieved_at: '2026-01-01T00:00:05.000Z',
    ...overrides,
  };
}

/** A finished `fetch_job` task as the API stores it, `job_import` block included. */
function fetchJobTask(
  result: {
    job: NormalizedJob | null;
    candidates: NormalizedJob[];
    warnings: { code: string; message: string }[];
    job_import: { id: string; status: string; job_id: string | null };
  },
  overrides: Partial<TaskView> = {},
): TaskView {
  return makeTask({
    type: 'fetch_job',
    state: 'succeeded',
    attempt: 1,
    result: {
      ...result,
      fetch: {
        performed: true,
        final_url: PAGE_URL,
        http_status: 200,
        content_type: 'text/html',
        bytes: 1000,
        redirects: 0,
        extraction: 'html_text',
      },
    },
    ...overrides,
  });
}

async function openImport(api: JobGetterApi) {
  renderApp({ client: api, route: '/discover' });
  await screen.findByRole('heading', { name: 'Discover', level: 1 });
}

async function submitUrl(user: ReturnType<typeof userEvent.setup>, url = PAGE_URL) {
  await user.type(screen.getByLabelText(/^Job page URL/), url);
  await user.click(screen.getByRole('button', { name: 'Import' }));
}

const BYPASS_SUGGESTIONS = /proxy|vpn|user[- ]agent|circumvent|evade|spoof|cookie|headless|log in/i;

describe('discover: manual import', () => {
  it('sends a URL or a pasted description, never both', async () => {
    const user = userEvent.setup();
    const importJob = vi.fn<JobGetterApi['importJob']>(async () => ({
      task_id: TASK_ID,
      status: 'queued',
    }));
    await openImport(
      createFakeApi({
        getMe: async () => discoveryMe(),
        importJob,
        getTask: async () => makeTask({ type: 'fetch_job', state: 'queued' }),
      }),
    );

    await user.type(screen.getByLabelText(/^Company/), 'Example Co');
    await submitUrl(user);
    await waitFor(() => expect(importJob).toHaveBeenCalledTimes(1));
    const first = importJob.mock.calls[0]?.[0];
    expect(first?.body).toEqual({ url: PAGE_URL, company: 'Example Co' });
    expect(first?.body).not.toHaveProperty('description_text');
    expect(typeof first?.idempotencyKey).toBe('string');

    await user.click(await screen.findByRole('button', { name: 'Start another import' }));
    await user.click(screen.getByLabelText('Pasted description'));
    expect(screen.queryByLabelText(/^Job page URL/)).toBeNull();
    await user.type(
      screen.getByLabelText(/^Description text/),
      'Senior engineer wanted for a small team in Lisbon.',
    );
    await user.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(importJob).toHaveBeenCalledTimes(2));
    const second = importJob.mock.calls[1]?.[0];
    expect(second?.body).toEqual({
      description_text: 'Senior engineer wanted for a small team in Lisbon.',
      company: 'Example Co',
    });
    expect(second?.body).not.toHaveProperty('url');
  });

  it('refuses an empty or non-https URL locally and keeps what was typed', async () => {
    const user = userEvent.setup();
    const importJob = vi.fn<JobGetterApi['importJob']>();
    await openImport(createFakeApi({ getMe: async () => discoveryMe(), importJob }));

    await submitUrl(user, 'http://insecure.example.test/job');
    expect(screen.getByRole('alert').textContent).toContain('Enter the https URL');
    expect(importJob).not.toHaveBeenCalled();
    expect((screen.getByLabelText(/^Job page URL/) as HTMLInputElement).value).toBe(
      'http://insecure.example.test/job',
    );
  });

  it('links to the created job', async () => {
    const user = userEvent.setup();
    await openImport(
      createFakeApi({
        getMe: async () => discoveryMe(),
        getTask: async () =>
          fetchJobTask({
            job: makeNormalizedJob(),
            candidates: [],
            warnings: [{ code: 'NO_STRUCTURED_DATA', message: 'No JSON-LD found.' }],
            job_import: { id: 'import-1', status: 'resolved', job_id: JOB_ID },
          }),
      }),
    );
    await submitUrl(user);
    const outcome = await screen.findByTestId('import-outcome');
    expect(outcome.dataset.outcome).toBe('created');
    expect(within(outcome).getByText('Data Engineer — Example Co')).toBeTruthy();
    expect(within(outcome).getByTestId('import-job-link').getAttribute('href')).toBe(
      `/jobs/${JOB_ID}`,
    );
    // The fetch note is shown with its label and the worker's own message.
    expect(within(outcome).getByText('NO_STRUCTURED_DATA')).toBeTruthy();
    expect(within(outcome).getByText('No JSON-LD found.')).toBeTruthy();
  });

  it('offers the candidates and imports the chosen one by its own URL under a new key', async () => {
    const user = userEvent.setup();
    const candidateA = makeNormalizedJob({
      title: 'Data Engineer',
      canonical_url: 'https://careers.example.test/jobs/1',
    });
    const candidateB = makeNormalizedJob({
      title: 'Platform Engineer',
      canonical_url: 'https://careers.example.test/jobs/2',
    });
    const importJob = vi.fn<JobGetterApi['importJob']>(async () => ({
      task_id: TASK_ID,
      status: 'queued',
    }));
    await openImport(
      createFakeApi({
        getMe: async () => discoveryMe(),
        importJob,
        getTask: async () =>
          fetchJobTask({
            job: null,
            candidates: [candidateA, candidateB],
            warnings: [{ code: 'MULTIPLE_POSTINGS', message: 'Two postings on the page.' }],
            job_import: { id: 'import-1', status: 'needs_choice', job_id: null },
          }),
      }),
    );

    await submitUrl(user);
    const outcome = await screen.findByTestId('import-outcome');
    expect(outcome.dataset.outcome).toBe('needs_choice');
    expect(within(outcome).getByText('Several postings were found on that page')).toBeTruthy();
    const candidates = within(outcome).getAllByTestId('candidate');
    expect(candidates).toHaveLength(2);
    expect(
      within(candidates[1] as HTMLElement).getByText('Platform Engineer — Example Co'),
    ).toBeTruthy();

    await user.click(
      within(candidates[1] as HTMLElement).getByRole('button', { name: 'Import this posting' }),
    );
    await waitFor(() => expect(importJob).toHaveBeenCalledTimes(2));
    const first = importJob.mock.calls[0]?.[0];
    const second = importJob.mock.calls[1]?.[0];
    expect(second?.body).toEqual({ url: 'https://careers.example.test/jobs/2' });
    expect(second?.idempotencyKey).not.toBe(first?.idempotencyKey);
  });

  it('reports a refused fetch plainly, offers paste mode and suggests no way around it', async () => {
    const user = userEvent.setup();
    await openImport(
      createFakeApi({
        getMe: async () => discoveryMe(),
        getTask: async () =>
          fetchJobTask({
            job: null,
            candidates: [],
            warnings: [{ code: 'ROBOTS_DISALLOWED', message: 'robots.txt disallows /jobs' }],
            job_import: { id: 'import-1', status: 'failed', job_id: null },
          }),
      }),
    );

    await submitUrl(user);
    const outcome = await screen.findByTestId('import-outcome');
    expect(outcome.dataset.outcome).toBe('refused');
    expect(screen.getByTestId('import-refused').textContent).toContain(
      'does not work around a refusal',
    );
    expect(within(outcome).getAllByText(/robots directives disallow/).length).toBeGreaterThan(0);
    expect(within(outcome).getByText('robots.txt disallows /jobs')).toBeTruthy();
    expect(document.body.textContent ?? '').not.toMatch(BYPASS_SUGGESTIONS);
    expect(screen.queryByTestId('import-job-link')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Paste the description instead' }));
    expect((screen.getByLabelText('Pasted description') as HTMLInputElement).checked).toBe(true);
    expect(screen.getByLabelText(/^Description text/)).toBeTruthy();
    // The refused page URL becomes the application-URL hint, nothing more.
    expect((screen.getByLabelText(/^Application URL/) as HTMLInputElement).value).toBe(PAGE_URL);
  });

  it('shows the real failure code and message when the task fails', async () => {
    const user = userEvent.setup();
    await openImport(
      createFakeApi({
        getMe: async () => discoveryMe(),
        getTask: async () =>
          makeTask({
            type: 'fetch_job',
            state: 'failed',
            attempt: 1,
            error: { code: 'TIMEOUT', message: 'No response within 20 s.', retryable: true },
          }),
      }),
    );
    await submitUrl(user);
    expect((await screen.findByTestId('failure-code')).textContent).toBe('TIMEOUT');
    expect(screen.getByTestId('failure-message').textContent).toContain('No response within 20 s.');
    expect(screen.getByText('The server considers this failure retryable.')).toBeTruthy();
    expect(screen.queryByTestId('import-outcome')).toBeNull();
  });

  it('says a queued import will not run while the API reports no worker', async () => {
    const user = userEvent.setup();
    await openImport(
      createFakeApi({
        getMe: async () => discoveryMe({ worker_online: false }),
        getTask: async () => makeTask({ type: 'fetch_job', state: 'queued' }),
      }),
    );
    await submitUrl(user);
    const explanation = (await screen.findByTestId('queued-no-worker')).textContent ?? '';
    expect(explanation).toContain('no worker online');
    expect(explanation).toContain('you do not need to queue it again');
    expect(screen.queryByText('Job imported')).toBeNull();
  });

  it('does not guess when the task result has an unexpected shape', async () => {
    const user = userEvent.setup();
    await openImport(
      createFakeApi({
        getMe: async () => discoveryMe(),
        getTask: async () =>
          makeTask({ type: 'fetch_job', state: 'succeeded', result: { unexpected: true } }),
      }),
    );
    await submitUrl(user);
    expect((await screen.findByTestId('import-unreadable')).textContent).toContain(
      'did not have the expected shape',
    );
    expect(screen.queryByTestId('import-job-link')).toBeNull();
  });
});
