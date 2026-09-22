import { ApiError } from '@job-getter/api-client';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DELETION_ID, createAnonymousApi, createFakeApi, makeDeletion, renderApp } from './helpers';

/**
 * Deleting a workspace from Settings → Privacy, and the receipt page (AT26).
 *
 * The API half is asserted in apps/api/tests/workspace-deletion.test.ts. What
 * this file owns is the part a person touches: that the button cannot be
 * pressed by accident, that a wrong password leaves them where they were, and
 * that the receipt says plainly whether the erasure finished.
 */

async function fillForm(word: string, password: string) {
  await userEvent.type(await screen.findByLabelText(/to confirm/), word);
  await userEvent.type(screen.getByLabelText('Your password'), password);
}

describe('Settings → Privacy: deleting the workspace', () => {
  it('says what will happen, and keeps the button disabled until the word and password are in', async () => {
    renderApp({ route: '/settings/privacy' });

    const section = await screen.findByTestId('delete-workspace');
    expect(section.textContent).toContain('Access ends at once');
    expect(section.textContent).toContain('create an export above first');

    const button = screen.getByRole('button', { name: 'Delete my workspace' });
    expect((button as HTMLButtonElement).disabled).toBe(true);

    await userEvent.type(screen.getByLabelText('Type DELETE to confirm'), 'delete');
    await userEvent.type(screen.getByLabelText('Your password'), 'secret');
    // Case matters: "delete" is not the word.
    expect((button as HTMLButtonElement).disabled).toBe(true);

    await userEvent.clear(screen.getByLabelText('Type DELETE to confirm'));
    await userEvent.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it('sends the literal confirmation and the password, then shows the receipt', async () => {
    const deleteWorkspace = vi.fn(async () => makeDeletion({ files_erased: 3 }));
    const { api } = renderApp({
      client: createFakeApi({ deleteWorkspace }),
      route: '/settings/privacy',
    });

    await fillForm('DELETE', 'correct horse');
    await userEvent.click(screen.getByRole('button', { name: 'Delete my workspace' }));

    expect(deleteWorkspace).toHaveBeenCalledWith({
      body: { confirm: true, password: 'correct horse' },
    });
    expect((await screen.findByTestId('deletion-completed')).textContent).toContain('3 file(s)');
    expect(screen.getByTestId('deletion-id').textContent).toBe(DELETION_ID);
    expect(screen.getByRole('link', { name: 'Set up this installation again' })).toBeTruthy();
    // The API was not asked to log out a session it had already ended.
    expect(api.logout).not.toHaveBeenCalled();
  });

  it('stays on the page after a wrong password, with the password cleared', async () => {
    const deleteWorkspace = vi.fn(async () => {
      throw new ApiError({
        status: 403,
        code: 'FORBIDDEN',
        message: 'That password is not correct. Nothing was deleted.',
        requestId: '44444444-4444-4444-8444-444444444444',
      });
    });
    renderApp({ client: createFakeApi({ deleteWorkspace }), route: '/settings/privacy' });

    await fillForm('DELETE', 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Delete my workspace' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Nothing was deleted');
    expect((screen.getByLabelText('Your password') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Type DELETE to confirm') as HTMLInputElement).value).toBe(
      'DELETE',
    );
    expect(screen.getByTestId('delete-workspace')).toBeTruthy();
  });
});

describe('the deletion receipt page', () => {
  it('is readable without a session', async () => {
    renderApp({ client: createAnonymousApi(), route: `/deleted/${DELETION_ID}` });
    expect(await screen.findByTestId('deletion-completed')).toBeTruthy();
  });

  it('says access is revoked while erasure is still running, and updates by itself', async () => {
    const getWorkspaceDeletion = vi
      .fn()
      .mockResolvedValueOnce(makeDeletion({ state: 'erasing', completed_at: null }))
      .mockResolvedValue(makeDeletion());
    renderApp({
      client: createAnonymousApi({ getWorkspaceDeletion }),
      route: `/deleted/${DELETION_ID}`,
    });

    expect((await screen.findByTestId('deletion-erasing')).textContent).toContain(
      'Nobody can sign in',
    );
    await waitFor(() => expect(screen.getByTestId('deletion-completed')).toBeTruthy(), {
      timeout: 5_000,
    });
  });

  it('says so plainly when erasure failed, with the reference to give an operator', async () => {
    renderApp({
      client: createAnonymousApi({
        getWorkspaceDeletion: vi.fn(async () =>
          makeDeletion({ state: 'failed', completed_at: null, failure_code: 'erasure_failed' }),
        ),
      }),
      route: `/deleted/${DELETION_ID}`,
    });

    expect((await screen.findByTestId('deletion-failed')).textContent).toContain(
      'Access was revoked',
    );
    expect(screen.getByTestId('deletion-id').textContent).toBe(DELETION_ID);
    expect(screen.queryByRole('link', { name: 'Set up this installation again' })).toBeNull();
  });
});
