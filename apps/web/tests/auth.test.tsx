import { ApiError } from '@job-getter/api-client';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createAnonymousApi, makeMe, renderApp } from './helpers';

async function fillSignIn(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText(/Email/), 'owner@example.test');
  await user.type(screen.getByLabelText(/Password/), 'correct horse battery');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('sign in', () => {
  it('reports bad credentials without revealing whether the account exists', async () => {
    const user = userEvent.setup();
    const login = vi.fn(async () => {
      throw new ApiError({
        status: 401,
        code: 'UNAUTHENTICATED',
        message: 'Invalid email or password',
        requestId: '55555555-5555-4555-8555-555555555555',
      });
    });
    renderApp({ client: createAnonymousApi({ login }), route: '/login' });

    await fillSignIn(user);

    expect(
      await screen.findByText(/That email and password combination was not accepted/),
    ).toBeTruthy();
    const body = document.body.textContent ?? '';
    expect(body).not.toMatch(/no such account|unknown email|account does not exist/i);

    // The request id is still available for support without leaking anything.
    expect(screen.getByText(/55555555-5555-4555-8555-555555555555/)).toBeTruthy();
  });

  it('keeps what the user typed after a failed attempt', async () => {
    const user = userEvent.setup();
    const login = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    renderApp({ client: createAnonymousApi({ login }), route: '/login' });

    await fillSignIn(user);

    expect(await screen.findByText(/The API could not be reached/)).toBeTruthy();
    expect(screen.getByText(/Nothing you typed was cleared/)).toBeTruthy();
    expect((screen.getByLabelText(/Email/) as HTMLInputElement).value).toBe('owner@example.test');
    expect((screen.getByLabelText(/Password/) as HTMLInputElement).value).toBe(
      'correct horse battery',
    );
  });

  it('explains a rate limit and when to try again', async () => {
    const user = userEvent.setup();
    const login = vi.fn(async () => {
      throw new ApiError({
        status: 429,
        code: 'QUOTA_EXCEEDED',
        message: 'Too many requests',
      });
    });
    renderApp({ client: createAnonymousApi({ login }), route: '/login' });

    await fillSignIn(user);

    expect(await screen.findByText(/wait about a minute before trying again/)).toBeTruthy();
  });

  it('signs in and lands on the dashboard without a second round trip', async () => {
    const user = userEvent.setup();
    const me = makeMe();
    const getMe = vi.fn(async () => {
      throw new ApiError({ status: 401, code: 'UNAUTHENTICATED', message: 'Unauthenticated' });
    });
    const login = vi.fn(async () => me);
    renderApp({ client: createAnonymousApi({ getMe, login }), route: '/login' });

    await fillSignIn(user);

    expect(await screen.findByRole('heading', { name: 'Dashboard', level: 1 })).toBeTruthy();
    expect(login).toHaveBeenCalledWith({
      body: { email: 'owner@example.test', password: 'correct horse battery' },
    });
    expect(screen.getByText('Signed in as owner@example.test')).toBeTruthy();
  });

  it('sends an unauthenticated visitor from a protected screen to sign in', async () => {
    renderApp({ client: createAnonymousApi(), route: '/diagnostics' });
    expect(await screen.findByRole('heading', { name: 'Sign in', level: 1 })).toBeTruthy();
  });
});

describe('one-time setup', () => {
  it('says setup is closed and shows no form when an owner already exists', async () => {
    const { container } = renderApp({
      client: createAnonymousApi({
        getSetupStatus: vi.fn(async () => ({
          mode: 'local' as const,
          setup_required: false,
          registration_open: false,
        })),
      }),
      route: '/setup',
    });

    expect(await screen.findByText('Setup is already closed')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toBeTruthy();
    expect(container.querySelectorAll('form')).toHaveLength(0);
    expect(screen.queryByLabelText(/Setup token/)).toBeNull();
  });

  it('collects the one-time token and explains where it came from', async () => {
    const user = userEvent.setup();
    const completeSetup = vi.fn(async () => makeMe());
    renderApp({
      client: createAnonymousApi({
        getSetupStatus: vi.fn(async () => ({
          mode: 'local' as const,
          setup_required: true,
          registration_open: false,
        })),
        completeSetup,
      }),
      route: '/setup',
    });

    expect(await screen.findByText('Create the owner account')).toBeTruthy();
    expect(screen.getByText(/Printed once to the terminal or container log/)).toBeTruthy();
    expect(screen.getByText(/Creating one closes this route permanently/)).toBeTruthy();
    // Local and hosted are both explained before the account is created.
    expect(screen.getByText(/Local: everything runs on this machine/)).toBeTruthy();
    expect(
      screen.getByText(/Hosted: the API, worker, database and files run on a server/),
    ).toBeTruthy();
    expect(screen.getByText('This API reports that it is running in Local mode.')).toBeTruthy();
    // Provider configuration and profile import are named as absent, not faked.
    expect(screen.getByText(/Those arrive with M1 and are deliberately absent/)).toBeTruthy();

    await user.type(screen.getByLabelText(/Setup token/), 'token-from-the-terminal');
    await user.type(screen.getByLabelText(/Email/), 'owner@example.test');
    await user.type(screen.getByLabelText(/Password/), 'a-very-long-password');
    await user.click(screen.getByRole('button', { name: 'Create owner account' }));

    expect(completeSetup).toHaveBeenCalledWith({
      body: {
        setup_token: 'token-from-the-terminal',
        email: 'owner@example.test',
        password: 'a-very-long-password',
        locale: 'en',
      },
    });
  });

  it('refuses a password the contract would reject, before calling the API', async () => {
    const user = userEvent.setup();
    const completeSetup = vi.fn(async () => makeMe());
    renderApp({
      client: createAnonymousApi({
        getSetupStatus: vi.fn(async () => ({
          mode: 'local' as const,
          setup_required: true,
          registration_open: false,
        })),
        completeSetup,
      }),
      route: '/setup',
    });

    await user.type(await screen.findByLabelText(/Setup token/), 'token');
    await user.type(screen.getByLabelText(/Email/), 'owner@example.test');
    await user.type(screen.getByLabelText(/Password/), 'short');
    await user.click(screen.getByRole('button', { name: 'Create owner account' }));

    expect(completeSetup).not.toHaveBeenCalled();
    expect(screen.getByText('Use at least 12 characters.')).toBeTruthy();
  });
});
