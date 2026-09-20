import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { JobGetterApi } from '../src/api/client';
import {
  FACT_ID,
  FACT_ID_2,
  createFakeApi,
  makeFact,
  makeProfile,
  renderApp,
  staleRevisionError,
} from './helpers';

describe('profile screen', () => {
  it('renders a draft and a confirmed fact as visibly different things', async () => {
    const profile = makeProfile({
      confirmed_revision: 2,
      facts: [
        makeFact({ id: FACT_ID, kind: 'skill', confirmed: true }),
        makeFact({
          id: FACT_ID_2,
          kind: 'experience',
          confirmed: false,
          source_excerpt: 'Acme Corp — Engineer, 2020 to present',
          value: {
            employer: 'Acme Corp',
            title: 'Engineer',
            start_month: '2020-01',
            end_month: null,
            current: true,
            employment_type: 'full_time',
            location: null,
            bullets: [],
            skills: [],
          },
        }),
      ],
    });
    renderApp({ client: createFakeApi({ getProfile: async () => profile }), route: '/profile' });

    await screen.findByRole('heading', { name: 'Profile', level: 1 });

    const cards = screen.getAllByTestId('fact');
    expect(cards).toHaveLength(2);
    const confirmedCard = cards.find((card) => card.dataset.kind === 'skill') as HTMLElement;
    const draftCard = cards.find((card) => card.dataset.kind === 'experience') as HTMLElement;

    const confirmedBadge = within(confirmedCard).getByTestId('fact-state');
    const draftBadge = within(draftCard).getByTestId('fact-state');
    expect(confirmedBadge.dataset.confirmed).toBe('true');
    expect(draftBadge.dataset.confirmed).toBe('false');
    expect(confirmedBadge.textContent).toBe('Confirmed');
    expect(draftBadge.textContent).toContain('Draft — ready for review');
    expect(draftBadge.textContent).not.toContain('Confirmed');
    // The draft uses the shared "ready for review" status, not a success tone.
    expect(draftBadge.querySelector('[data-status="ready_for_review"]')).toBeTruthy();
    expect(confirmedBadge.querySelector('[data-status]')).toBeNull();

    // Only the draft offers a confirm action; the source excerpt is verbatim.
    expect(within(draftCard).getByRole('button', { name: 'Confirm as accurate' })).toBeTruthy();
    expect(within(confirmedCard).queryByRole('button', { name: 'Confirm as accurate' })).toBeNull();
    expect(within(draftCard).getByText('Acme Corp — Engineer, 2020 to present')).toBeTruthy();
    // User content is shown as typed, and the enum gets a label.
    expect(within(draftCard).getByText('Acme Corp')).toBeTruthy();
    expect(within(draftCard).getByText('Full time')).toBeTruthy();
  });

  it('confirms a draft through PATCH with the current revision, never silently', async () => {
    const user = userEvent.setup();
    const profile = makeProfile({ revision: 3, facts: [makeFact({ confirmed: false })] });
    const patchProfile = vi.fn<JobGetterApi['patchProfile']>(async () =>
      makeProfile({ revision: 4, facts: [makeFact({ confirmed: true, revision: 4 })] }),
    );
    renderApp({
      client: createFakeApi({ getProfile: async () => profile, patchProfile }),
      route: '/profile',
    });

    await user.click(await screen.findByRole('button', { name: 'Confirm as accurate' }));

    expect(patchProfile).toHaveBeenCalledTimes(1);
    expect(patchProfile.mock.calls[0]?.[0]).toMatchObject({
      body: {
        expected_revision: 3,
        changes: [{ op: 'upsert', id: FACT_ID, kind: 'skill', confirmed: true }],
      },
    });
    expect(await screen.findByText('Saved. The profile is now at revision 4.')).toBeTruthy();
    expect(screen.getByTestId('fact-state').dataset.confirmed).toBe('true');
  });

  it('offers authorization as two independent tri-states that default to unknown, never yes', async () => {
    const user = userEvent.setup();
    const patchProfile = vi.fn<JobGetterApi['patchProfile']>(async () =>
      makeProfile({ revision: 4 }),
    );
    renderApp({ client: createFakeApi({ patchProfile }), route: '/profile' });

    await user.click(await screen.findByRole('button', { name: 'Add Work authorization' }));

    const authorized = screen.getByRole('group', { name: 'Authorized to work in this country' });
    const sponsorship = screen.getByRole('group', { name: 'Sponsorship required' });

    for (const group of [authorized, sponsorship]) {
      const yes = within(group).getByLabelText('Yes') as HTMLInputElement;
      const no = within(group).getByLabelText('No') as HTMLInputElement;
      const unknown = within(group).getByLabelText('Unknown') as HTMLInputElement;
      expect(yes.checked).toBe(false);
      expect(no.checked).toBe(false);
      expect(unknown.checked).toBe(true);
      expect(unknown.disabled).toBe(false);
    }
    expect(within(authorized).getByText(/Unknown never counts as yes/)).toBeTruthy();

    // Answering one question leaves the other one unknown.
    await user.click(within(authorized).getByLabelText('No'));
    await user.type(screen.getByLabelText(/^Country/), 'us');
    await user.click(screen.getByRole('button', { name: 'Save fact' }));

    expect(patchProfile).toHaveBeenCalledTimes(1);
    expect(patchProfile.mock.calls[0]?.[0]).toMatchObject({
      body: {
        expected_revision: 3,
        changes: [
          {
            op: 'upsert',
            kind: 'authorization',
            confirmed: true,
            value: { country: 'US', authorized: 'no', sponsorship_required: 'unknown', note: null },
          },
        ],
      },
    });
    expect(patchProfile.mock.calls[0]?.[0]?.body.changes[0]).not.toHaveProperty('id');
  });

  it('offers "Not declared" for skill proficiency and starts there', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/profile' });

    await user.click(await screen.findByRole('button', { name: 'Add Skill' }));

    const proficiency = screen.getByLabelText(
      /Proficiency \(declared by you\)/,
    ) as HTMLSelectElement;
    expect(proficiency.value).toBe('');
    expect(within(proficiency).getByRole('option', { name: 'Not declared' })).toBeTruthy();
    expect(within(proficiency).getByRole('option', { name: 'Expert' })).toBeTruthy();
  });

  it('blocks an experience that is current and also has an end month', async () => {
    const user = userEvent.setup();
    const patchProfile = vi.fn<JobGetterApi['patchProfile']>(async () =>
      makeProfile({ revision: 4 }),
    );
    renderApp({ client: createFakeApi({ patchProfile }), route: '/profile' });

    await user.click(await screen.findByRole('button', { name: 'Add Experience' }));
    await user.type(screen.getByLabelText(/^Employer/), 'Acme');
    await user.type(screen.getByLabelText(/^Job title/), 'Engineer');
    await user.type(screen.getByLabelText(/^Start month/), '2020-01');
    const endMonth = screen.getByLabelText(/^End month/);
    await user.type(endMonth, '2021-06');
    await user.click(screen.getByLabelText('This is my current role'));
    await user.click(screen.getByRole('button', { name: 'Save fact' }));

    expect(patchProfile).not.toHaveBeenCalled();
    const alerts = screen.getAllByRole('alert').map((node) => node.textContent);
    expect(alerts).toContain(
      'A current role cannot also have an end month. Clear the end month or untick "current".',
    );
    // The error is linked to the end-month control, not just floating nearby.
    expect(endMonth.getAttribute('aria-invalid')).toBe('true');
    const describedBy = endMonth.getAttribute('aria-describedby') ?? '';
    const linked = describedBy
      .split(' ')
      .map((id) => document.getElementById(id))
      .find((node) => node?.getAttribute('role') === 'alert');
    expect(linked?.textContent).toContain('A current role cannot also have an end month');

    // Fix it: clearing the end month lets the save through with end_month null.
    await user.clear(endMonth);
    await user.click(screen.getByRole('button', { name: 'Save fact' }));
    expect(patchProfile).toHaveBeenCalledTimes(1);
    expect(patchProfile.mock.calls[0]?.[0]).toMatchObject({
      body: {
        changes: [
          {
            op: 'upsert',
            kind: 'experience',
            value: {
              employer: 'Acme',
              title: 'Engineer',
              start_month: '2020-01',
              end_month: null,
              current: true,
            },
          },
        ],
      },
    });
  });

  it('rejects an end month before the start month before calling the API', async () => {
    const user = userEvent.setup();
    const patchProfile = vi.fn<JobGetterApi['patchProfile']>(async () =>
      makeProfile({ revision: 4 }),
    );
    renderApp({ client: createFakeApi({ patchProfile }), route: '/profile' });

    await user.click(await screen.findByRole('button', { name: 'Add Experience' }));
    await user.type(screen.getByLabelText(/^Employer/), 'Acme');
    await user.type(screen.getByLabelText(/^Job title/), 'Engineer');
    await user.type(screen.getByLabelText(/^Start month/), '2021-06');
    await user.type(screen.getByLabelText(/^End month/), '2020-01');
    await user.click(screen.getByRole('button', { name: 'Save fact' }));

    expect(patchProfile).not.toHaveBeenCalled();
    expect(screen.getAllByRole('alert').map((node) => node.textContent)).toContain(
      'The end month cannot be earlier than the start month.',
    );
  });

  it('keeps the typed value on a 409 and retries against the reloaded revision', async () => {
    const user = userEvent.setup();
    const getProfile = vi
      .fn()
      .mockResolvedValueOnce(makeProfile({ revision: 3, facts: [makeFact()] }))
      .mockResolvedValue(makeProfile({ revision: 4, facts: [makeFact({ revision: 4 })] }));
    const patchProfile = vi
      .fn()
      .mockRejectedValueOnce(staleRevisionError())
      .mockResolvedValue(makeProfile({ revision: 5, facts: [makeFact({ revision: 5 })] }));
    renderApp({ client: createFakeApi({ getProfile, patchProfile }), route: '/profile' });

    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const name = screen.getByLabelText(/^Skill name/) as HTMLInputElement;
    await user.clear(name);
    await user.type(name, 'TypeScript 5');
    await user.click(screen.getByRole('button', { name: 'Save fact' }));

    // The stale-revision message, with the real code, and the edit still there.
    expect(
      await screen.findByText(/Reload to get the current version, then reapply your change/),
    ).toBeTruthy();
    expect(screen.getByText('STALE_REVISION')).toBeTruthy();
    expect(screen.getByText('The profile is at revision 4, not 3.')).toBeTruthy();
    expect((screen.getByLabelText(/^Skill name/) as HTMLInputElement).value).toBe('TypeScript 5');
    expect(patchProfile.mock.calls[0]?.[0]).toMatchObject({ body: { expected_revision: 3 } });

    // Reload keeps the form open with the typed value and picks up revision 4.
    await user.click(screen.getByRole('button', { name: /Reload the profile/ }));
    expect(getProfile).toHaveBeenCalledTimes(2);
    expect((screen.getByLabelText(/^Skill name/) as HTMLInputElement).value).toBe('TypeScript 5');

    await user.click(screen.getByRole('button', { name: 'Save fact' }));
    expect(patchProfile).toHaveBeenCalledTimes(2);
    expect(patchProfile.mock.calls[1]?.[0]).toMatchObject({
      body: {
        expected_revision: 4,
        changes: [
          { op: 'upsert', id: FACT_ID, kind: 'skill', value: { canonical_name: 'TypeScript 5' } },
        ],
      },
    });
    expect(await screen.findByText('Saved. The profile is now at revision 5.')).toBeTruthy();
  });

  it('deletes a fact only after an explicit confirmation dialog', async () => {
    const user = userEvent.setup();
    const patchProfile = vi.fn<JobGetterApi['patchProfile']>(async () =>
      makeProfile({ revision: 4, facts: [] }),
    );
    renderApp({
      client: createFakeApi({
        getProfile: async () => makeProfile({ facts: [makeFact()] }),
        patchProfile,
      }),
      route: '/profile',
    });

    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(patchProfile).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'Delete this fact?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete fact' }));

    expect(patchProfile).toHaveBeenCalledTimes(1);
    expect(patchProfile.mock.calls[0]?.[0]).toMatchObject({
      body: { expected_revision: 3, changes: [{ op: 'delete', id: FACT_ID }] },
    });
    expect(await screen.findByText(/No Skills recorded yet/)).toBeTruthy();
  });

  it('labels every control on the experience form', async () => {
    const user = userEvent.setup();
    const { container } = renderApp({ route: '/profile' });

    await user.click(await screen.findByRole('button', { name: 'Add Experience' }));
    await user.click(screen.getByRole('button', { name: 'Add bullet' }));

    const controls = container.querySelectorAll<HTMLElement>(
      'form input, form select, form textarea',
    );
    expect(controls.length).toBeGreaterThan(8);
    for (const control of controls) {
      const id = control.getAttribute('id');
      const labelled =
        (id !== null && container.querySelector(`label[for="${id}"]`) !== null) ||
        control.getAttribute('aria-label') !== null ||
        control.getAttribute('aria-labelledby') !== null;
      expect({ id, labelled }).toEqual({ id, labelled: true });
    }
  });
});
