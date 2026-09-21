/**
 * The fit screens (M3, PR06).
 *
 * Almost every assertion here is about a number not being shown, or being
 * shown with the qualification that makes it honest. A score is a heuristic
 * ranking, never a probability of being hired (invariant 3), so the UI has to
 * keep four promises:
 *
 *  * an unchecked job says "Not checked" and shows no digit at all;
 *  * a score is never shown without the coverage it was computed from;
 *  * a component nothing could be read for says so instead of scoring zero;
 *  * a requirement matched only through a related skill is reported as
 *    uncertain and explicitly not counted.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { JobGetterApi } from '../src/api/client';
import {
  JOB_ID,
  createFakeApi,
  makeJob,
  makeJobDetail,
  makeMatchExplanation,
  makeMatchSummary,
  renderApp,
} from './helpers';

async function openDetail(api: JobGetterApi) {
  const result = renderApp({ client: api, route: `/jobs/${JOB_ID}` });
  await screen.findByTestId('job-detail');
  return result;
}

async function openJobs(api: JobGetterApi) {
  renderApp({ client: api, route: '/jobs' });
  await screen.findByRole('heading', { name: 'Jobs', level: 1 });
}

const REQUIREMENT = {
  text: 'Expert in TypeScript',
  kind: 'required' as const,
  evidence_excerpt: 'You will need to be an expert in TypeScript.',
};

describe('the match cell in the jobs list', () => {
  it('shows a score beside its coverage, never a bare percentage', async () => {
    await openJobs(
      createFakeApi({
        listJobs: async () => ({
          items: [makeJob({ match: makeMatchSummary({ score: 72, coverage_percent: 90 }) })],
          next_cursor: null,
        }),
      }),
    );
    const cell = await screen.findByTestId('match-cell');

    expect(cell.dataset.match).toBe('scored');
    expect(within(cell).getByTestId('match-score').textContent).toBe('72');
    expect(within(cell).getByTestId('match-coverage').textContent).toContain('90%');
    // "of 100", not "72%": a percentage reads as a chance of being hired.
    expect(cell.textContent).toContain('of 100');
    expect(cell.textContent).not.toContain('72%');
  });

  it('shows a null score as "not enough to judge" rather than zero', async () => {
    await openJobs(
      createFakeApi({
        listJobs: async () => ({
          items: [makeJob({ match: makeMatchSummary({ score: null, coverage_percent: 0 }) })],
          next_cursor: null,
        }),
      }),
    );
    const cell = await screen.findByTestId('match-cell');

    expect(within(cell).getByTestId('match-score-unknown').textContent).toBe('Not enough to judge');
    expect(within(cell).queryByTestId('match-score')).toBeNull();
    expect(cell.textContent).not.toMatch(/\b0\b(?!%)/);
  });

  it('marks a score whose inputs have moved on as out of date', async () => {
    await openJobs(
      createFakeApi({
        listJobs: async () => ({
          items: [makeJob({ match: makeMatchSummary({ stale: true }) })],
          next_cursor: null,
        }),
      }),
    );
    const cell = await screen.findByTestId('match-cell');

    expect(within(cell).getByTestId('match-stale').textContent).toBe('Out of date');
  });

  it('never renders an unknown eligibility as a pass', async () => {
    await openJobs(
      createFakeApi({
        listJobs: async () => ({
          items: [makeJob({ match: makeMatchSummary({ eligible: 'unknown' }) })],
          next_cursor: null,
        }),
      }),
    );
    const cell = await screen.findByTestId('match-cell');

    expect(within(cell).getByTestId('match-eligible').textContent).toBe('Unknown');
    // "Eligible" is the yes label; an undetermined verdict must not borrow it.
    expect(cell.textContent).not.toContain('Eligible');
  });
});

describe('the fit panel', () => {
  it('says the job has not been checked, and offers to check it', async () => {
    await openDetail(createFakeApi({ getJob: async () => makeJobDetail({ match: null }) }));

    expect(screen.getByTestId('fit-not-checked').textContent).toContain(
      'has not been checked against your profile yet',
    );
    expect(screen.queryByTestId('fit-panel')).toBeNull();
    expect(screen.getByRole('button', { name: 'Check fit' })).toBeTruthy();
  });

  it('states that the ranking is heuristic, beside the number itself', async () => {
    await openDetail(
      createFakeApi({
        getJob: async () =>
          makeJobDetail({ match: makeMatchSummary(), match_explanation: makeMatchExplanation() }),
      }),
    );

    const disclaimer = screen.getByTestId('fit-disclaimer').textContent ?? '';
    expect(disclaimer).toContain('not a probability of being hired');
    expect(disclaimer).toContain('not an ATS score');
    expect(screen.getByTestId('fit-score').textContent).toContain('72');
    expect(screen.getByTestId('fit-score').textContent).toContain('90%');
  });

  it('reports an unevaluable component as not judged, never as zero', async () => {
    await openDetail(
      createFakeApi({
        getJob: async () =>
          makeJobDetail({
            match: makeMatchSummary(),
            match_explanation: makeMatchExplanation({
              components: [
                {
                  key: 'industry',
                  value: null,
                  weight: 10,
                  evaluable: false,
                  unknown_code: 'JOB_STATES_NOTHING',
                  evidence: [],
                  fact_ids: [],
                },
              ],
              unknown_components: ['industry'],
            }),
          }),
      }),
    );

    const component = screen.getByTestId('match-component');
    expect(component.dataset.evaluable).toBe('false');
    expect(within(component).getByTestId('component-unknown').textContent).toBe('Not judged');
    expect(within(component).getByTestId('component-unknown-reason').textContent).toBe(
      'The posting does not say.',
    );
    expect(within(component).queryByTestId('component-value')).toBeNull();
    expect(screen.getByTestId('fit-coverage-note').textContent).toContain('Industry');
  });

  it('explains that an uncertain requirement was deliberately not counted', async () => {
    await openDetail(
      createFakeApi({
        getJob: async () =>
          makeJobDetail({
            match: makeMatchSummary(),
            match_explanation: makeMatchExplanation({
              requirements: [
                {
                  requirement: REQUIREMENT,
                  outcome: 'uncertain',
                  weight: 2,
                  fact_ids: [],
                  matched_skill: 'JavaScript',
                },
              ],
            }),
          }),
      }),
    );

    const row = screen.getByTestId('match-requirement');
    expect(row.dataset.outcome).toBe('uncertain');
    const explanation = within(row).getByTestId('requirement-uncertain').textContent ?? '';
    expect(explanation).toContain('JavaScript');
    expect(explanation).toContain('related but not the same thing');
    expect(explanation).toContain('did not enter');
  });

  it('lists gaps before matches, so the list opens with what is missing', async () => {
    await openDetail(
      createFakeApi({
        getJob: async () =>
          makeJobDetail({
            match: makeMatchSummary(),
            match_explanation: makeMatchExplanation({
              requirements: [
                {
                  requirement: { ...REQUIREMENT, text: 'Covered one' },
                  outcome: 'matched',
                  weight: 2,
                  fact_ids: ['11111111-1111-4111-8111-111111111111'],
                  matched_skill: 'TypeScript',
                },
                {
                  requirement: { ...REQUIREMENT, text: 'Missing one' },
                  outcome: 'missing',
                  weight: 2,
                  fact_ids: [],
                  matched_skill: null,
                },
              ],
            }),
          }),
      }),
    );

    const rows = screen.getAllByTestId('match-requirement');
    expect(rows[0]?.dataset.outcome).toBe('missing');
    expect(rows[1]?.dataset.outcome).toBe('matched');
  });

  it('says an unknown blocking eligibility has to be answered before applying', async () => {
    await openDetail(
      createFakeApi({
        getJob: async () =>
          makeJobDetail({
            match: makeMatchSummary({ eligible: 'unknown' }),
            match_explanation: makeMatchExplanation({
              eligibility: [
                {
                  filter: 'work_authorization',
                  verdict: 'unknown',
                  code: 'AUTHORIZATION_ABSENT',
                  blocking: true,
                  evidence: [],
                },
              ],
            }),
          }),
      }),
    );

    const check = screen.getByTestId('eligibility-check');
    expect(check.dataset.verdict).toBe('unknown');
    expect(within(check).getByTestId('eligibility-reason').textContent).toContain(
      'no work authorization at all',
    );
    expect(within(check).getByTestId('eligibility-blocking').textContent).toContain(
      'Unknown is not a yes',
    );
  });

  it('never converts a salary it could not compare', async () => {
    await openDetail(
      createFakeApi({
        getJob: async () =>
          makeJobDetail({
            match: makeMatchSummary(),
            match_explanation: makeMatchExplanation({
              eligibility: [
                {
                  filter: 'salary_minimum',
                  verdict: 'unknown',
                  code: 'SALARY_NOT_COMPARABLE',
                  blocking: false,
                  evidence: [
                    { source: 'job', excerpt: 'EUR 90,000-110,000 per year', fact_id: null },
                  ],
                },
              ],
            }),
          }),
      }),
    );

    const reason = screen.getByTestId('eligibility-reason').textContent ?? '';
    expect(reason).toContain('different currency or period');
    expect(reason).toContain('Nothing was converted');
    // The posting's own figures, unaltered.
    expect(screen.getByTestId('eligibility-check').textContent).toContain('EUR 90,000-110,000');
  });

  it('says out loud that no requirements were extracted', async () => {
    await openDetail(
      createFakeApi({
        getJob: async () =>
          makeJobDetail({
            match: makeMatchSummary(),
            match_explanation: makeMatchExplanation({ requirements: [] }),
          }),
      }),
    );

    const note = screen.getByTestId('fit-no-requirements').textContent ?? '';
    expect(note).toContain('No requirements were extracted');
    expect(note).toContain('not that the job has none');
  });

  it('records the algorithm and alias-map versions behind the number', async () => {
    await openDetail(
      createFakeApi({
        getJob: async () =>
          makeJobDetail({ match: makeMatchSummary(), match_explanation: makeMatchExplanation() }),
      }),
    );

    expect(screen.getByTestId('fit-versions').textContent).toBe('Algorithm v1, alias map v1.');
  });

  it('warns that a stale score is shown as it was', async () => {
    await openDetail(
      createFakeApi({
        getJob: async () =>
          makeJobDetail({
            match: makeMatchSummary({ stale: true }),
            match_explanation: makeMatchExplanation(),
          }),
      }),
    );

    expect(screen.getByTestId('fit-stale-notice').textContent).toContain(
      'Check the fit again for a current one',
    );
  });
});

describe('asking for a fit check', () => {
  it('queues one match under a single idempotency key', async () => {
    const user = userEvent.setup();
    const matchJob = vi.fn<JobGetterApi['matchJob']>(async () => ({
      task_id: '88888888-8888-4888-8888-888888888888',
      status: 'queued' as const,
    }));
    await openDetail(
      createFakeApi({ getJob: async () => makeJobDetail({ match: null }), matchJob }),
    );

    await user.click(screen.getByRole('button', { name: 'Check fit' }));
    await waitFor(() => expect(matchJob).toHaveBeenCalledTimes(1));

    const call = matchJob.mock.lastCall?.[0];
    expect(call?.params).toEqual({ id: JOB_ID });
    expect(call?.idempotencyKey).toBeTruthy();
  });

  it('says the check runs locally and spends no AI budget', async () => {
    const user = userEvent.setup();
    await openDetail(createFakeApi({ getJob: async () => makeJobDetail({ match: null }) }));

    await user.click(screen.getByRole('button', { name: 'Check fit' }));

    const queued = await screen.findByTestId('fit-queued');
    expect(queued.textContent).toContain('uses no AI budget');
  });

  it('offers to check again once a score exists', async () => {
    await openDetail(
      createFakeApi({
        getJob: async () =>
          makeJobDetail({ match: makeMatchSummary(), match_explanation: makeMatchExplanation() }),
      }),
    );

    expect(screen.getByRole('button', { name: 'Check fit again' })).toBeTruthy();
  });
});
