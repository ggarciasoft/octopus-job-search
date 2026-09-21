import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { JobGetterApi } from '../src/api/client';
import {
  JOB_ID,
  JOB_ID_2,
  createFakeApi,
  makeJob,
  makeJobDetail,
  renderApp,
  staleRevisionError,
} from './helpers';

async function openDetail(api: JobGetterApi) {
  const result = renderApp({ client: api, route: `/jobs/${JOB_ID}` });
  await screen.findByTestId('job-detail');
  return result;
}

describe('job detail', () => {
  it('corrects a title and employer the page got wrong, and says whose words they are', async () => {
    const user = userEvent.setup();
    const patchJob = vi.fn<JobGetterApi['patchJob']>().mockResolvedValue(
      makeJob({
        revision: 2,
        title: 'Software Engineer',
        company: 'Greenhouse',
        edited_fields: ['company', 'title'],
      }),
    );
    await openDetail(
      createFakeApi({
        getJob: async () =>
          makeJobDetail({
            revision: 1,
            title: 'Job Application for Software Engineer at Greenhouse',
            company: '(company not stated)',
          }),
        patchJob,
      }),
    );

    // Nothing claims to be the user's wording until it is.
    expect(screen.queryByTestId('job-corrected')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Correct title and employer' }));
    const form = screen.getByTestId('job-correction');
    const title = within(form).getByLabelText('Job title');
    const company = within(form).getByLabelText('Employer');

    // An empty field is not a correction: both words reach the employer.
    await user.clear(title);
    expect(within(form).getByRole('button', { name: 'Save correction' })).toHaveProperty(
      'disabled',
      true,
    );

    await user.type(title, 'Software Engineer');
    await user.clear(company);
    await user.type(company, 'Greenhouse');
    await user.click(within(form).getByRole('button', { name: 'Save correction' }));

    await waitFor(() => expect(patchJob).toHaveBeenCalledTimes(1));
    expect(patchJob.mock.calls[0]?.[0].body).toEqual({
      expected_revision: 1,
      title: 'Software Engineer',
      company: 'Greenhouse',
    });
    expect(await screen.findByText('Software Engineer')).toBeTruthy();
    expect(screen.getByTestId('job-corrected').textContent).toContain('your wording');
    expect(screen.queryByTestId('job-correction')).toBeNull();
  });

  it('says eligibility is not stated when the posting names no countries', async () => {
    await openDetail(
      createFakeApi({ getJob: async () => makeJobDetail({ eligible_countries: null }) }),
    );
    const eligibility = screen.getByTestId('eligibility');
    expect(eligibility.dataset.eligibility).toBe('not_stated');
    expect(eligibility.textContent).toContain('Not stated — do not assume eligibility');
    expect(eligibility.textContent).toContain('remote posting does not mean worldwide');
  });

  it('lists the countries the posting names, verbatim', async () => {
    await openDetail(
      createFakeApi({ getJob: async () => makeJobDetail({ eligible_countries: ['CA', 'US'] }) }),
    );
    const eligibility = screen.getByTestId('eligibility');
    expect(eligibility.dataset.eligibility).toBe('stated');
    expect(eligibility.textContent).toBe('The posting names these countries: CA, US');
  });

  it('lists every inferred field with the excerpt it was inferred from', async () => {
    await openDetail(
      createFakeApi({
        getJob: async () =>
          makeJobDetail({
            remote_type: 'remote',
            eligible_countries: ['CA'],
            inferred: [
              { field: 'remote_type', source_excerpt: 'We are a remote-first company…' },
              {
                field: 'eligible_countries',
                source_excerpt: 'Applicants must be legally eligible to work in Canada',
              },
            ],
          }),
      }),
    );
    const inferred = screen.getAllByTestId('inferred-field');
    expect(inferred).toHaveLength(2);
    expect(inferred[0]?.dataset.field).toBe('remote_type');
    expect(within(inferred[0] as HTMLElement).getByText('Work arrangement')).toBeTruthy();
    expect(within(inferred[0] as HTMLElement).getByText('This was inferred from:')).toBeTruthy();
    expect(
      within(inferred[0] as HTMLElement).getByText('We are a remote-first company…'),
    ).toBeTruthy();
    expect(inferred[1]?.dataset.field).toBe('eligible_countries');
    expect(within(inferred[1] as HTMLElement).getByText('Eligible countries')).toBeTruthy();
    expect(
      within(inferred[1] as HTMLElement).getByText(
        'Applicants must be legally eligible to work in Canada',
      ),
    ).toBeTruthy();
    expect(screen.getByText(/check the excerpt before relying on the field/)).toBeTruthy();
  });

  it('says so when nothing was inferred', async () => {
    await openDetail(createFakeApi({ getJob: async () => makeJobDetail({ inferred: [] }) }));
    expect(screen.queryByTestId('inferred-field')).toBeNull();
    expect(screen.getByText(/No field was inferred/)).toBeTruthy();
  });

  it('renders the description as text: an HTML string is shown escaped, never as markup', async () => {
    const html = '<script>window.pwned = true</script><b>Bold</b> role & more';
    const { container } = await openDetail(
      createFakeApi({ getJob: async () => makeJobDetail({ description_text: html }) }),
    );
    const description = screen.getByTestId('description-text');
    expect(description.textContent).toBe(html);
    expect(description.querySelector('b')).toBeNull();
    expect(description.querySelector('script')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect((window as unknown as { pwned?: boolean }).pwned).toBeUndefined();
  });

  it('explains an empty requirements list instead of implying the job has none', async () => {
    await openDetail(createFakeApi({ getJob: async () => makeJobDetail({ requirements: [] }) }));
    const none = screen.getByTestId('requirements-none');
    expect(none.textContent).toContain('No requirements were extracted — read the description');
    expect(none.textContent).toContain('not that the job has none');
    expect(screen.queryByTestId('requirements-required')).toBeNull();
  });

  it('groups requirements by kind, each with its evidence excerpt in a disclosure', async () => {
    await openDetail(
      createFakeApi({
        getJob: async () =>
          makeJobDetail({
            requirements: [
              {
                text: '5 years of Go',
                kind: 'required',
                evidence_excerpt: 'Requirements: 5 years of Go',
              },
              {
                text: 'Kubernetes',
                kind: 'preferred',
                evidence_excerpt: 'Nice to have: Kubernetes',
              },
              { text: 'Team player', kind: 'unknown', evidence_excerpt: 'Team player wanted' },
            ],
          }),
      }),
    );
    const required = screen.getByTestId('requirements-required');
    expect(within(required).getByText('Required')).toBeTruthy();
    expect(within(required).getByText('5 years of Go')).toBeTruthy();
    expect(within(required).getByText('Requirements: 5 years of Go')).toBeTruthy();
    expect(within(required).getByTestId('evidence').tagName).toBe('DETAILS');
    expect(
      within(screen.getByTestId('requirements-preferred')).getByText('Kubernetes'),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId('requirements-unknown')).getByText('Requirement level not stated'),
    ).toBeTruthy();
  });

  it('renders provenance with external links that open safely, and duplicates with links', async () => {
    await openDetail(
      createFakeApi({
        getJob: async () =>
          makeJobDetail({
            sources: [
              {
                ...makeJob().sources[0]!,
                apply_url: 'https://boards.greenhouse.io/acme/jobs/1001#app',
              },
            ],
            possible_duplicates: [
              { job_id: JOB_ID_2, reason: 'same_apply_url', detail: 'Identical application URL' },
            ],
          }),
      }),
    );
    const provenance = screen.getByTestId('provenance');
    expect(provenance.dataset.connector).toBe('greenhouse');
    expect(within(provenance).getByText('1001')).toBeTruthy();
    const links = within(provenance).getAllByRole('link');
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
      expect(link.getAttribute('target')).toBe('_blank');
    }
    expect(links[1]?.getAttribute('href')).toBe('https://boards.greenhouse.io/acme/jobs/1001#app');

    const duplicate = screen.getByTestId('duplicate');
    expect(
      within(duplicate).getByRole('link', { name: 'Same application URL' }).getAttribute('href'),
    ).toBe(`/jobs/${JOB_ID_2}`);
    expect(within(duplicate).getByText('Identical application URL')).toBeTruthy();
  });

  it('offers no "prepare application" control and says why', async () => {
    await openDetail(createFakeApi());
    expect(screen.queryByRole('button', { name: /prepare/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /prepare/i })).toBeNull();
    expect(screen.getByTestId('prepare-unavailable').textContent).toContain('milestone M4');
    // And the match is stated as unchecked here as well.
    expect(screen.getByTestId('match-cell').textContent).toContain('Not checked');
  });

  it('keeps the closure dialog and state on a 409, reloads on request, then retries with the new revision', async () => {
    const user = userEvent.setup();
    const getJob = vi
      .fn<JobGetterApi['getJob']>()
      .mockResolvedValueOnce(makeJobDetail({ revision: 1 }))
      .mockResolvedValue(makeJobDetail({ revision: 2 }));
    const patchJob = vi
      .fn<JobGetterApi['patchJob']>()
      .mockRejectedValueOnce(
        staleRevisionError('The job is at revision 2, not 1. Reload and retry.'),
      )
      .mockResolvedValue(makeJob({ revision: 3, status: 'closed' }));
    await openDetail(createFakeApi({ getJob, patchJob }));

    await user.click(screen.getByRole('button', { name: 'Mark as closed' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Mark closed' }));

    // The stale message with the real code and server text, inside the still-open dialog.
    expect(
      await within(dialog).findByText(
        /Reload to get the current version, then reapply your change/,
      ),
    ).toBeTruthy();
    expect(within(dialog).getByText('STALE_REVISION')).toBeTruthy();
    expect(
      within(dialog).getByText('The job is at revision 2, not 1. Reload and retry.'),
    ).toBeTruthy();
    expect(patchJob.mock.calls[0]?.[0].body).toEqual({ expected_revision: 1, status: 'closed' });
    expect(screen.getByTestId('job-detail').dataset.revision).toBe('1');
    expect(screen.getByTestId('job-status').dataset.status).toBe('active');

    await user.click(within(dialog).getByRole('button', { name: 'Reload the job' }));
    await waitFor(() => expect(getJob).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId('job-detail').dataset.revision).toBe('2'));
    expect(screen.getByRole('dialog')).toBeTruthy();

    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Mark closed' }),
    );
    await waitFor(() => expect(patchJob).toHaveBeenCalledTimes(2));
    expect(patchJob.mock.calls[1]?.[0].body).toEqual({ expected_revision: 2, status: 'closed' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByTestId('job-status').dataset.status).toBe('closed');
    expect(screen.getByTestId('job-detail').dataset.revision).toBe('3');
    expect(screen.queryByRole('button', { name: 'Mark as closed' })).toBeNull();
  });

  it('saves with expected_revision and keeps the detail-only fields after the JobView answer', async () => {
    const user = userEvent.setup();
    const patchJob = vi.fn<JobGetterApi['patchJob']>(async () =>
      makeJob({ saved: true, revision: 2 }),
    );
    await openDetail(
      createFakeApi({
        getJob: async () => makeJobDetail({ description_text: 'Keep me after the patch.' }),
        patchJob,
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patchJob).toHaveBeenCalledTimes(1));
    expect(patchJob.mock.calls[0]?.[0].body).toEqual({ expected_revision: 1, saved: true });
    expect(await screen.findByRole('button', { name: 'Unsave' })).toBeTruthy();
    expect(screen.getByTestId('description-text').textContent).toBe('Keep me after the patch.');
  });

  it('renders a salary as stated with the excerpt, or the unknown badge', async () => {
    await openDetail(
      createFakeApi({
        getJob: async () =>
          makeJobDetail({
            salary: {
              min: 60000,
              max: null,
              currency: 'EUR',
              period: 'year',
              source_excerpt: 'from €60k',
            },
          }),
      }),
    );
    const salary = screen.getByTestId('salary-cell');
    expect(salary.dataset.salary).toBe('stated');
    expect(salary.textContent).toContain('60,000');
    expect(within(salary).getByTestId('salary-currency').textContent).toBe('EUR');
    expect(screen.getByText('As stated: “from €60k”')).toBeTruthy();
    expect(screen.getByText(/nothing is converted/)).toBeTruthy();
  });
});
