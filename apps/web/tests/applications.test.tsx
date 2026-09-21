import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  APPLICATION_ID,
  createFakeApi,
  makeApplication,
  makeApplicationEvent,
  makeDevice,
  makePacket,
  renderApp,
} from './helpers';

/**
 * The M4 screens (PR08–PR10).
 *
 * These are the assertions that matter, and each one is a thing the screen
 * would get wrong if nobody were watching:
 *
 *  * approving quotes the hash the screen displayed, so an approval cannot
 *    silently attach to content that moved (AT13's browser half);
 *  * a stale packet says *what* changed, and the approve button is not offered;
 *  * an unanswered required question is visible as unanswered and blocks
 *    approval (AT14's browser half);
 *  * the fill panel never stops saying that nothing is submitted;
 *  * the tracker keeps "verified" and "reported by you" apart;
 *  * a pairing code is shown once, and the token is never rendered anywhere.
 */

describe('the applications list', () => {
  it('shows nothing rather than inventing rows', async () => {
    renderApp({ route: '/applications' });
    await screen.findByRole('heading', { name: 'Applications', level: 1 });
    expect(await screen.findByText('No applications yet')).toBeTruthy();
  });

  it('lists what is tracked, with its status', async () => {
    const client = createFakeApi({
      listApplications: async () => ({
        items: [makeApplication({ status: 'needs_input' })],
        next_cursor: null,
      }),
    });
    renderApp({ client, route: '/applications' });

    await screen.findByRole('heading', { name: 'Applications', level: 1 });
    expect(await screen.findByText('Needs your answer')).toBeTruthy();
  });
});

describe('the application review screen', () => {
  it('shows the exact destination and the hash an approval would bind', async () => {
    const client = createFakeApi({ getApplication: async () => makeApplication() });
    renderApp({ client, route: `/applications/${APPLICATION_ID}` });

    expect(await screen.findByTestId('packet-destination')).toBeTruthy();
    // Shown in full: a shortened URL is a different promise.
    expect(screen.getByTestId('packet-destination').textContent).toBe(
      'https://boards.greenhouse.io/acme/jobs/1#app',
    );
    expect(screen.getByTestId('packet-hash').textContent).toBe('c'.repeat(64));
  });

  it('approves with the hash it displayed, not with whatever the server holds', async () => {
    const approveApplication = vi.fn(async (_args: { body: { content_hash: string } }) =>
      makeApplication({ status: 'approved' }),
    );
    const client = createFakeApi({
      getApplication: async () => makeApplication(),
      approveApplication,
    });
    renderApp({ client, route: `/applications/${APPLICATION_ID}` });

    const button = await screen.findByRole('button', { name: 'Approve this packet' });
    await userEvent.click(button);

    await waitFor(() => expect(approveApplication).toHaveBeenCalled());
    expect(approveApplication.mock.calls[0]![0]).toMatchObject({
      body: { content_hash: 'c'.repeat(64), expected_revision: 2 },
    });
  });

  it('AT14: an unanswered required question is visible and blocks approval', async () => {
    const client = createFakeApi({
      getApplication: async () =>
        makeApplication({
          status: 'needs_input',
          current_packet: makePacket({
            answers: [
              {
                question_key: 'internal_referral_code',
                label: 'Internal referral code',
                answer: null,
                required: true,
                sensitivity: 'standard',
                provenance: 'user_entered',
                source_id: null,
              },
            ],
            unresolved_question_keys: ['internal_referral_code'],
          }),
        }),
    });
    renderApp({ client, route: `/applications/${APPLICATION_ID}` });

    const row = await screen.findByTestId('packet-answer');
    expect(row.dataset.missing).toBe('true');
    expect(within(row).getByTestId('answer-missing')).toBeTruthy();
    expect(screen.getByTestId('packet-unresolved')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Approve this packet' }).hasAttribute('disabled'),
    ).toBe(true);
  });

  it('says which change withdrew an approval rather than only that one did', async () => {
    const client = createFakeApi({
      getApplication: async () =>
        makeApplication({
          status: 'preparing',
          current_packet: makePacket({ staleness: ['profile_revision_changed'] }),
        }),
    });
    renderApp({ client, route: `/applications/${APPLICATION_ID}` });

    const staleness = await screen.findByTestId('packet-staleness');
    expect(staleness.textContent).toContain('Your profile changed');
    expect(
      screen.getByRole('button', { name: 'Approve this packet' }).hasAttribute('disabled'),
    ).toBe(true);
  });

  it('never stops saying that nothing is submitted', async () => {
    const client = createFakeApi({
      getApplication: async () => makeApplication({ status: 'awaiting_user_submit' }),
      listDevices: async () => ({ items: [makeDevice()], next_cursor: null }),
    });
    renderApp({ client, route: `/applications/${APPLICATION_ID}` });

    expect(await screen.findByTestId('fill-never-submits')).toBeTruthy();
    expect(screen.getByTestId('fill-awaiting-submit').textContent).toContain(
      'Nothing has been sent',
    );
  });

  it('offers no fill button when no runner is paired, and says what to do', async () => {
    const client = createFakeApi({
      getApplication: async () => makeApplication({ status: 'approved' }),
      listDevices: async () => ({ items: [], next_cursor: null }),
    });
    renderApp({ client, route: `/applications/${APPLICATION_ID}` });

    expect(await screen.findByTestId('fill-no-runner')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open the form and fill it' })).toBeNull();
  });

  it('shows who caused each event, not only that something happened', async () => {
    const client = createFakeApi({
      getApplication: async () => makeApplication(),
      listApplicationEvents: async () => ({
        items: [
          makeApplicationEvent(),
          makeApplicationEvent({
            id: '99999999-9999-4999-8999-999999999992',
            sequence: 2,
            type: 'approval_invalidated',
            actor: 'system',
            status_before: 'approved',
            status_after: 'preparing',
            reason: 'profile_revision_changed',
          }),
        ],
        next_cursor: null,
      }),
    });
    renderApp({ client, route: `/applications/${APPLICATION_ID}` });

    const events = await screen.findAllByTestId('timeline-event');
    expect(events).toHaveLength(2);
    expect(events[1]!.dataset.actor).toBe('system');
    expect(events[1]!.textContent).toContain('Approval withdrawn');
  });

  it('warns about another application for what may be the same posting', async () => {
    const client = createFakeApi({
      getApplication: async () =>
        makeApplication({
          possible_duplicate_application_ids: ['11111111-1111-4111-8111-111111111111'],
        }),
    });
    renderApp({ client, route: `/applications/${APPLICATION_ID}` });

    expect((await screen.findByTestId('duplicate-warning')).textContent).toContain('kept separate');
  });
});

describe('the answer editor', () => {
  it('marks a demographic question as never reused and offers no way to save it', async () => {
    const client = createFakeApi({
      getApplication: async () =>
        makeApplication({
          current_packet: makePacket({
            answers: [
              {
                question_key: 'gender',
                label: 'Gender',
                answer: null,
                required: true,
                sensitivity: 'never_reuse',
                provenance: 'user_entered',
                source_id: null,
              },
            ],
            unresolved_question_keys: ['gender'],
          }),
        }),
    });
    renderApp({ client, route: `/applications/${APPLICATION_ID}` });

    await screen.findByTestId('answer-editor');
    expect(screen.getByTestId('never-reuse-notice')).toBeTruthy();
    // No "remember this answer" control exists for it at all.
    expect(screen.queryByLabelText('Remember this answer')).toBeNull();
  });
});

describe('the tracker', () => {
  it('distinguishes a verified submission from one the user reported', async () => {
    const client = createFakeApi({
      listApplications: async () => ({
        items: [
          makeApplication({
            id: '11111111-1111-4111-8111-111111111111',
            status: 'submitted',
            submitted_at: '2026-09-21T12:00:00.000Z',
            submission_evidence: {
              evidence_type: 'adapter_observed',
              confirmation_text: 'Thanks for applying',
              reference: 'ACME-42',
              url: null,
              observed_at: '2026-09-21T12:00:00.000Z',
              screenshot_file_id: null,
              note: null,
            },
          }),
          makeApplication({
            id: '22222222-2222-4222-8222-222222222222',
            status: 'submitted',
            submitted_at: '2026-09-21T12:00:00.000Z',
            submission_evidence: {
              evidence_type: 'user_report',
              confirmation_text: null,
              reference: null,
              url: null,
              observed_at: null,
              screenshot_file_id: null,
              note: 'I sent it myself.',
            },
          }),
        ],
        next_cursor: null,
      }),
    });
    renderApp({ client, route: '/tracker' });

    await screen.findByRole('heading', { name: 'Tracker', level: 1 });
    expect(await screen.findByText('Submitted — verified')).toBeTruthy();
    expect(screen.getByText('Submitted — reported by you')).toBeTruthy();
  });

  it('records an outcome as a user report and says so before the button', async () => {
    const recordApplicationOutcome = vi.fn(async (_args: { body: { evidence_type: string } }) =>
      makeApplication({ status: 'rejected' }),
    );
    const client = createFakeApi({
      listApplications: async () => ({ items: [makeApplication()], next_cursor: null }),
      recordApplicationOutcome,
    });
    renderApp({ client, route: '/tracker' });

    await screen.findByRole('heading', { name: 'Tracker', level: 1 });
    expect((await screen.findByTestId('evidence-notice')).textContent).toContain('Reported by you');

    await userEvent.click(screen.getByRole('button', { name: 'Record it' }));
    await waitFor(() => expect(recordApplicationOutcome).toHaveBeenCalled());
    expect(recordApplicationOutcome.mock.calls[0]![0]).toMatchObject({
      body: { evidence_type: 'user_report' },
    });
  });

  it('never offers to claim that an adapter observed the confirmation', async () => {
    const client = createFakeApi({
      listApplications: async () => ({ items: [makeApplication()], next_cursor: null }),
    });
    renderApp({ client, route: '/tracker' });

    await screen.findByRole('heading', { name: 'Tracker', level: 1 });
    await screen.findByTestId('outcome-form');
    const options = screen.getAllByRole('option').map((option) => option.textContent);
    expect(options).not.toContain('Seen on the confirmation page');
  });
});

describe('device pairing', () => {
  it('shows the code once and never renders a token', async () => {
    const client = createFakeApi();
    renderApp({ client, route: '/settings/devices' });

    await screen.findByRole('heading', { name: 'Paired devices', level: 2 });
    await userEvent.type(screen.getByLabelText('Name this device'), 'Work laptop');
    await userEvent.click(screen.getByRole('button', { name: 'Create a pairing code' }));

    const code = await screen.findByTestId('pairing-code');
    expect(code.textContent).toBe('pairing-code-for-tests');
    expect(screen.getByText(/cannot be displayed again/)).toBeTruthy();
    // The pairing code is what is shown; the device token is a different
    // secret and this screen never receives one, so there is nothing rendering
    // it and nothing to copy out of the DOM.
    expect(client.createDevicePairing).toHaveBeenCalled();
    expect(screen.queryByTestId('device-token')).toBeNull();
  });

  it('keeps a revoked device visible rather than removing it', async () => {
    const client = createFakeApi({
      listDevices: async () => ({
        items: [makeDevice({ status: 'revoked', revoked_at: '2026-09-21T13:00:00.000Z' })],
        next_cursor: null,
      }),
    });
    renderApp({ client, route: '/settings/devices' });

    const row = await screen.findByTestId('device-row');
    expect(row.dataset.status).toBe('revoked');
    expect(within(row).getByText('Revoked')).toBeTruthy();
    expect(within(row).queryByRole('button', { name: 'Revoke' })).toBeNull();
  });
});
