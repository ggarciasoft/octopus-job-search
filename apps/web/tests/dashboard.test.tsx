import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createFakeApi, makeCapabilities, makeMe, renderApp } from './helpers';

describe('dashboard capability panel', () => {
  it('renders false flags as unavailable and never as available', async () => {
    const me = makeMe({
      capabilities: makeCapabilities({
        worker_online: false,
        ai_provider_configured: true,
        profile_import: false,
        job_discovery: false,
        cv_generation: false,
        applications: false,
        browser_filling: false,
        extension: false,
      }),
    });
    renderApp({ client: createFakeApi({ getMe: async () => me }), route: '/' });

    await screen.findByRole('heading', { name: 'Dashboard', level: 1 });

    const unavailableKeys = [
      'profile_import',
      'job_discovery',
      'cv_generation',
      'applications',
      'browser_filling',
      'extension',
    ];
    for (const key of unavailableKeys) {
      const row = screen.getByTestId(`capability-${key}`);
      expect(row.dataset.available).toBe('false');
      expect(within(row).getByText('Unavailable')).toBeTruthy();
      expect(within(row).queryByText('Available')).toBeNull();
    }

    const configured = screen.getByTestId('capability-ai_provider_configured');
    expect(configured.dataset.available).toBe('true');
    expect(within(configured).getByText('Available')).toBeTruthy();
  });

  it('shows an offline worker prominently and explains that queued work will not finish', async () => {
    const me = makeMe({ capabilities: makeCapabilities({ worker_online: false }) });
    renderApp({ client: createFakeApi({ getMe: async () => me }), route: '/' });

    await screen.findByRole('heading', { name: 'Dashboard', level: 1 });

    const status = screen.getByTestId('worker-status');
    expect(status.dataset.online).toBe('false');
    expect(status.textContent).toBe('No worker has claimed a task recently.');
    expect(screen.getByText(/Queued tasks stay queued until a worker comes back/)).toBeTruthy();
  });

  it('reports an unmeasured cost as unknown rather than zero', async () => {
    const me = makeMe();
    renderApp({ client: createFakeApi({ getMe: async () => me }), route: '/' });

    await screen.findByRole('heading', { name: 'Dashboard', level: 1 });
    expect(
      screen.getByText(/no rate card is configured, which is not the same as zero/),
    ).toBeTruthy();
  });

  it('distinguishes "Submitted — verified" from "Submitted — reported by you"', async () => {
    renderApp({ route: '/' });
    await screen.findByRole('heading', { name: 'Dashboard', level: 1 });

    const verified = screen.getByTestId('status-submitted_verified');
    const reported = screen.getByTestId('status-submitted_reported_by_you');

    expect(verified.dataset.evidence).toBe('verified');
    expect(reported.dataset.evidence).toBe('user_reported');

    expect(within(verified).getByText('Submitted — verified')).toBeTruthy();
    expect(within(reported).getByText('Submitted — reported by you')).toBeTruthy();

    // The user-reported state must never present itself as verified evidence.
    expect(within(reported).queryByText('Submitted — verified')).toBeNull();
    expect(reported.textContent).toContain('No evidence was captured');
    expect(verified.textContent).toContain('Evidence of the submission was captured');
    expect(verified.textContent).not.toBe(reported.textContent);
  });

  it('marks every navigable screen as built, because they now all are', async () => {
    renderApp({ route: '/' });
    await screen.findByRole('heading', { name: 'Dashboard', level: 1 });

    // This test used to assert the opposite for Applications and Tracker: that
    // they carried an "M4" badge and said "Not available yet". M4 landed, so
    // the assertion flipped rather than being deleted — the navigation must
    // never claim a screen exists before it does, and it must stop claiming
    // the reverse the moment it does.
    for (const [name, href] of [
      ['Discover', '/discover'],
      ['Jobs', '/jobs'],
      ['CV studio', '/cv-studio'],
      ['Applications', '/applications'],
      ['Tracker', '/tracker'],
      ['Profile', '/profile'],
    ] as const) {
      const link = screen.getByRole('link', { name });
      expect(link.getAttribute('href'), name).toBe(href);
      expect(link.textContent, name).not.toContain('Not available yet');
    }
  });

  it('shows profile_import as available when the API reports it', async () => {
    const me = makeMe({ capabilities: makeCapabilities({ profile_import: true }) });
    renderApp({ client: createFakeApi({ getMe: async () => me }), route: '/' });

    await screen.findByRole('heading', { name: 'Dashboard', level: 1 });
    const row = screen.getByTestId('capability-profile_import');
    expect(row.dataset.available).toBe('true');
    expect(within(row).getByText('Available')).toBeTruthy();
  });
});
