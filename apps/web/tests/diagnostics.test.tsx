import { ApiError } from '@job-getter/api-client';
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TASK_ID, createFakeApi, makeCapabilities, makeMe, makeTask, renderApp } from './helpers';

/** Advances fake timers and flushes the promises they release. */
async function advance(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function succeededTask() {
  return makeTask({
    state: 'succeeded',
    attempt: 1,
    progress: { stage: 'done', percent: 100 },
    updated_at: '2026-01-01T00:00:05.000Z',
    result: {
      echoed: 'hola mundo',
      worker_id: 'worker-7',
      worker_runtime: 'python 3.12.8',
      processed_at: '2026-01-01T00:00:05.000Z',
    },
  });
}

async function queueProbe(message = 'hola mundo'): Promise<void> {
  fireEvent.change(screen.getByLabelText(/Message to echo/), { target: { value: message } });
  fireEvent.click(screen.getByRole('button', { name: /Queue probe task/ }));
  await advance();
}

describe('diagnostics screen', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('drives a task from queued through leased to succeeded and shows the real result', async () => {
    const getTask = vi
      .fn()
      .mockResolvedValueOnce(makeTask({ state: 'queued', attempt: 0 }))
      .mockResolvedValueOnce(
        makeTask({ state: 'leased', attempt: 1, progress: { stage: 'echoing', percent: 40 } }),
      )
      .mockResolvedValue(succeededTask());
    const api = createFakeApi({ getTask });

    renderApp({ client: api, route: '/diagnostics' });
    await advance();

    await queueProbe();

    // queued
    expect(screen.getByTestId('task-state').dataset.state).toBe('queued');
    expect(screen.getByText('Queued', { selector: '[aria-current="step"]' })).toBeTruthy();
    expect(screen.queryByText('Task succeeded')).toBeNull();

    // leased, with the progress the worker reported
    await advance(2_000);
    expect(screen.getByTestId('task-state').dataset.state).toBe('leased');
    expect(screen.getByText('echoing')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('40');
    expect(screen.getByText('Attempt 1 of 3')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Cancel task/ })).toBeTruthy();

    // succeeded
    await advance(2_000);
    expect(screen.getByTestId('task-state').dataset.state).toBe('succeeded');
    expect(screen.getByText('Task succeeded')).toBeTruthy();
    expect(screen.getByText('worker-7')).toBeTruthy();
    expect(screen.getByText('python 3.12.8')).toBeTruthy();
    // The echoed message is the user's own text, shown back verbatim.
    expect(screen.getAllByText('hola mundo').length).toBeGreaterThan(0);
    // Raw result JSON is available for inspection.
    expect(screen.getByText(/"worker_id": "worker-7"/)).toBeTruthy();
    // A finished task offers no cancel control.
    expect(screen.queryByRole('button', { name: /Cancel task/ })).toBeNull();

    // Polling stopped on the terminal state.
    expect(getTask).toHaveBeenCalledTimes(3);
    await advance(30_000);
    expect(getTask).toHaveBeenCalledTimes(3);
  });

  it('says plainly that a queued task will not run while no worker is online', async () => {
    // The M0 exit criterion with the worker still being built: the task is
    // accepted and stays queued forever. The screen must say nothing is
    // processing it, not imply progress.
    const getTask = vi.fn().mockResolvedValue(makeTask({ state: 'queued', attempt: 0 }));
    const api = createFakeApi({
      getMe: vi.fn(async () =>
        makeMe({ capabilities: makeCapabilities({ worker_online: false }) }),
      ),
      getTask,
    });

    const { container } = renderApp({ client: api, route: '/diagnostics' });
    await advance();

    // Warned before queueing anything.
    expect(
      screen.getByText(/A probe queued now will stay queued until a worker starts/),
    ).toBeTruthy();

    await queueProbe();

    expect(screen.getByTestId('task-state').dataset.state).toBe('queued');
    const explanation = screen.getByTestId('queued-no-worker').textContent ?? '';
    expect(explanation).toContain('no worker online');
    expect(explanation).toContain('It is not running slowly — it is not running at all.');
    expect(explanation).toContain('you do not need to queue it again');

    // Nothing on screen animates as though work were happening.
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(container.querySelectorAll('[aria-busy="true"]')).toHaveLength(0);
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(0);
    expect(container.querySelectorAll('.animate-spin')).toHaveLength(0);
    expect(screen.getByText('The worker has not reported progress yet.')).toBeTruthy();

    // No outcome is claimed in either direction.
    expect(screen.queryByText('Task succeeded')).toBeNull();
    expect(screen.queryByText('Task failed')).toBeNull();

    // Still queued, still honest, minutes later — and polling continues so it
    // will notice the moment a worker does start.
    await advance(10_000);
    expect(getTask.mock.calls.length).toBeGreaterThanOrEqual(5);
    expect(screen.getByTestId('task-state').dataset.state).toBe('queued');
    expect(screen.getByTestId('queued-no-worker')).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('renders the real failure code and message, and no success state', async () => {
    const getTask = vi.fn().mockResolvedValue(
      makeTask({
        state: 'failed',
        attempt: 3,
        error: {
          code: 'PROVIDER_UNAVAILABLE',
          message: 'The worker could not reach the configured provider.',
          retryable: true,
        },
      }),
    );
    const api = createFakeApi({ getTask });

    renderApp({ client: api, route: '/diagnostics' });
    await advance();
    await queueProbe();

    expect(screen.getByText('Task failed')).toBeTruthy();
    expect(screen.getByTestId('failure-code').textContent).toBe('PROVIDER_UNAVAILABLE');
    expect(screen.getByTestId('failure-message').textContent).toContain(
      'The worker could not reach the configured provider.',
    );
    expect(screen.getByText('The server considers this failure retryable.')).toBeTruthy();

    // Nothing anywhere claims success.
    expect(screen.queryByText('Task succeeded')).toBeNull();
    expect(screen.queryByText(/web → API → queue → worker/)).toBeNull();
  });

  it('cancels through the API and reflects cancel_requested', async () => {
    const getTask = vi
      .fn()
      .mockResolvedValue(
        makeTask({ state: 'leased', attempt: 1, progress: { stage: 'working', percent: 10 } }),
      );
    const cancelTask = vi
      .fn()
      .mockResolvedValue(makeTask({ state: 'leased', attempt: 1, cancel_requested: true }));
    const api = createFakeApi({ getTask, cancelTask });

    renderApp({ client: api, route: '/diagnostics' });
    await advance();
    await queueProbe();

    fireEvent.click(screen.getByRole('button', { name: /Cancel task/ }));
    await advance();

    expect(cancelTask).toHaveBeenCalledTimes(1);
    expect(cancelTask.mock.calls[0]?.[0]).toMatchObject({ params: { id: TASK_ID } });
    expect(screen.getByText(/Cancellation requested\./)).toBeTruthy();
    // Still no success claim: a cancel request is not a result.
    expect(screen.queryByText('Task succeeded')).toBeNull();
  });

  it('reuses one idempotency key when the same request is retried', async () => {
    const createDiagnosticTask = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiError({ status: 503, code: 'INTERNAL_ERROR', message: 'Temporarily unavailable' }),
      )
      .mockResolvedValue({ task_id: TASK_ID, status: 'queued' as const });
    const api = createFakeApi({ createDiagnosticTask });

    renderApp({ client: api, route: '/diagnostics' });
    await advance();

    await queueProbe('retry me');

    // The failure is reported, and the typed message is still in the form.
    expect(screen.getByText('That did not work')).toBeTruthy();
    expect((screen.getByLabelText(/Message to echo/) as HTMLInputElement).value).toBe('retry me');

    fireEvent.click(screen.getByRole('button', { name: /Queue probe task/ }));
    await advance();

    expect(createDiagnosticTask).toHaveBeenCalledTimes(2);
    const firstKey = createDiagnosticTask.mock.calls[0]?.[0]?.idempotencyKey;
    const secondKey = createDiagnosticTask.mock.calls[1]?.[0]?.idempotencyKey;
    expect(typeof firstKey).toBe('string');
    expect(secondKey).toBe(firstKey);
  });
});
