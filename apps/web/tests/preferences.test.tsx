import { ApiError } from '@job-getter/api-client';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { JobGetterApi } from '../src/api/client';
import { createFakeApi, makePreferencesView, renderApp, staleRevisionError } from './helpers';

async function openPreferences(client = createFakeApi()) {
  const result = renderApp({ client, route: '/settings/preferences' });
  await screen.findByRole('button', { name: 'Save preferences' });
  return result;
}

describe('preferences screen', () => {
  it('blocks saving while the weights do not sum to 100 and allows it at exactly 100', async () => {
    const user = userEvent.setup();
    const putPreferences = vi.fn<JobGetterApi['putPreferences']>(async () =>
      makePreferencesView({ revision: 3 }),
    );
    await openPreferences(createFakeApi({ putPreferences }));

    const save = screen.getByRole('button', { name: 'Save preferences' }) as HTMLButtonElement;
    const sum = screen.getByTestId('weight-sum');
    expect(save.disabled).toBe(false);
    expect(sum.dataset.valid).toBe('true');
    expect(sum.textContent).toContain('Current sum: 100.');

    const skills = screen.getByLabelText(/^Skills/) as HTMLInputElement;
    await user.clear(skills);
    await user.type(skills, '50');
    expect(sum.textContent).toContain('Current sum: 110.');
    expect(sum.textContent).toContain('must sum to exactly 100');
    expect(sum.getAttribute('role')).toBe('alert');
    expect(save.disabled).toBe(true);
    expect(
      screen.getByText('Saving is blocked until the weights sum to exactly 100.'),
    ).toBeTruthy();

    const industry = screen.getByLabelText(/^Industry/) as HTMLInputElement;
    await user.clear(industry);
    await user.type(industry, '0');
    expect(sum.textContent).toContain('Current sum: 100.');
    expect(save.disabled).toBe(false);

    await user.click(save);
    expect(putPreferences).toHaveBeenCalledTimes(1);
    expect(putPreferences.mock.calls[0]?.[0]).toMatchObject({
      body: {
        expected_revision: 2,
        config: {
          settings_version: 1,
          match_weights: {
            skills: 50,
            role_title: 20,
            seniority: 15,
            work_arrangement: 15,
            industry: 0,
          },
        },
      },
    });
    expect(await screen.findByText('Saved. Preferences are now at revision 3.')).toBeTruthy();
  });

  it('surfaces an unknown-key rejection from the API as a field error', async () => {
    const user = userEvent.setup();
    const putPreferences = vi.fn(async () => {
      throw new ApiError({
        status: 400,
        code: 'VALIDATION_ERROR',
        message: 'Review highlighted fields',
        fields: { 'config.unknown_key': 'Unexpected property' },
        requestId: '88888888-8888-4888-8888-888888888888',
      });
    });
    await openPreferences(createFakeApi({ putPreferences }));

    await user.click(screen.getByRole('button', { name: 'Save preferences' }));

    const notice = await screen.findByText('Fields the server rejected');
    const alert = notice.closest('[role="alert"]') as HTMLElement;
    expect(within(alert).getByText('config.unknown_key')).toBeTruthy();
    expect(alert.textContent).toContain('Unexpected property');
    expect(alert.textContent).toContain('VALIDATION_ERROR');
    expect(alert.textContent).toContain('Nothing you typed was cleared');
  });

  it('attaches a known field rejection to its control', async () => {
    const user = userEvent.setup();
    const putPreferences = vi.fn(async () => {
      throw new ApiError({
        status: 422,
        code: 'UNPROCESSABLE',
        message: 'Scan interval out of range',
        fields: { 'config.scan_interval_hours': 'Must be between 1 and 168.' },
      });
    });
    await openPreferences(createFakeApi({ putPreferences }));

    await user.click(screen.getByRole('button', { name: 'Save preferences' }));

    const field = await screen.findByLabelText(/^Scan interval/);
    expect(field.getAttribute('aria-invalid')).toBe('true');
    const describedBy = field.getAttribute('aria-describedby') ?? '';
    const linked = describedBy
      .split(' ')
      .map((id) => document.getElementById(id))
      .find((node) => node?.getAttribute('role') === 'alert');
    expect(linked?.textContent).toBe('Must be between 1 and 168.');
  });

  it('renders every policy as an explicit choice, with unknown sponsorship as the stored default', async () => {
    await openPreferences();

    const sponsorship = screen.getByRole('group', { name: 'Sponsorship policy' });
    expect((within(sponsorship).getByLabelText('Unknown') as HTMLInputElement).checked).toBe(true);
    expect((within(sponsorship).getByLabelText('Allow') as HTMLInputElement).checked).toBe(false);
    expect((within(sponsorship).getByLabelText('Avoid') as HTMLInputElement).checked).toBe(false);

    const eligibility = screen.getByRole('group', { name: 'When eligibility is unknown' });
    expect(
      (within(eligibility).getByLabelText('Show for review') as HTMLInputElement).checked,
    ).toBe(true);
    expect(within(eligibility).getByLabelText('Hide')).toBeTruthy();

    // Salary is explicit about currency and period and says no conversion happens.
    expect(screen.getByText(/No currency or period conversion happens/)).toBeTruthy();
    // Pilot defaults are visible next to the operational limits.
    expect(screen.getByLabelText(/^AI requests per day/).getAttribute('value')).toBe('50');
    expect(screen.getAllByText('Pilot default: 50.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Pilot default: 10.').length).toBeGreaterThan(0);
    // The prompt suffix is labelled as style only.
    expect(screen.getByLabelText(/Style suffix \(style only\)/)).toBeTruthy();
    expect(screen.getByText(/cannot override factual constraints/)).toBeTruthy();
  });

  it('sends a salary with explicit currency and period when enabled', async () => {
    const user = userEvent.setup();
    const putPreferences = vi.fn<JobGetterApi['putPreferences']>(async () =>
      makePreferencesView({ revision: 3 }),
    );
    await openPreferences(createFakeApi({ putPreferences }));

    await user.click(screen.getByLabelText('Set a minimum salary'));
    await user.type(screen.getByLabelText(/^Minimum/), '60000');
    await user.type(screen.getByLabelText(/^Currency/), 'eur');
    await user.selectOptions(screen.getByLabelText(/^Period/), 'month');
    await user.click(screen.getByRole('button', { name: 'Save preferences' }));

    expect(putPreferences.mock.calls[0]?.[0]).toMatchObject({
      body: { config: { salary: { minimum: 60000, currency: 'EUR', period: 'month' } } },
    });
  });

  it('shows the stale-revision message and a reload on a 409 without clearing the form', async () => {
    const user = userEvent.setup();
    const putPreferences = vi.fn(async () => {
      throw staleRevisionError('Preferences are at revision 3, not 2.');
    });
    await openPreferences(createFakeApi({ putPreferences }));

    const titles = screen.getByLabelText(/^Target job titles/) as HTMLTextAreaElement;
    await user.type(titles, 'Staff Engineer');
    await user.click(screen.getByRole('button', { name: 'Save preferences' }));

    expect(await screen.findByText('STALE_REVISION')).toBeTruthy();
    expect(screen.getByText('Preferences are at revision 3, not 2.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Reload preferences/ })).toBeTruthy();
    expect((screen.getByLabelText(/^Target job titles/) as HTMLTextAreaElement).value).toBe(
      'Staff Engineer',
    );
  });
});
