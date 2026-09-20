import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACTIVE_POLL_INTERVAL_MS,
  IDLE_POLL_INTERVAL_MS,
  pollIntervalFor,
  useTaskPolling,
} from '../src/hooks/useTaskPolling';
import { TASK_ID, createFakeApi, makeTask, renderWithProviders } from './helpers';

async function advance(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function Harness({
  taskId = TASK_ID as string | null,
  stopWhenIdle = true,
}: {
  readonly taskId?: string | null;
  readonly stopWhenIdle?: boolean;
}) {
  const { task, isPolling, isPaused } = useTaskPolling({ taskId, stopWhenIdle });
  return (
    <div>
      <span data-testid="state">{task?.state ?? 'none'}</span>
      <span data-testid="polling">{String(isPolling)}</span>
      <span data-testid="paused">{String(isPaused)}</span>
    </div>
  );
}

describe('pollIntervalFor', () => {
  it('uses 2 s while anything is running and 15 s when nothing is', () => {
    expect(pollIntervalFor(['queued'])).toBe(ACTIVE_POLL_INTERVAL_MS);
    expect(pollIntervalFor(['leased'])).toBe(ACTIVE_POLL_INTERVAL_MS);
    expect(pollIntervalFor(['succeeded', 'leased'])).toBe(ACTIVE_POLL_INTERVAL_MS);
    expect(pollIntervalFor(['succeeded'])).toBe(IDLE_POLL_INTERVAL_MS);
    expect(pollIntervalFor(['failed', 'cancelled'])).toBe(IDLE_POLL_INTERVAL_MS);
    expect(pollIntervalFor([])).toBe(IDLE_POLL_INTERVAL_MS);
  });
});

describe('useTaskPolling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('polls an active task every two seconds', async () => {
    const getTask = vi.fn().mockResolvedValue(makeTask({ state: 'leased' }));
    renderWithProviders(<Harness />, { client: createFakeApi({ getTask }) });

    await advance();
    expect(getTask).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('state').textContent).toBe('leased');

    await advance(1_999);
    expect(getTask).toHaveBeenCalledTimes(1);

    await advance(1);
    expect(getTask).toHaveBeenCalledTimes(2);

    await advance(2_000);
    expect(getTask).toHaveBeenCalledTimes(3);
  });

  it('backs off to fifteen seconds once nothing is running', async () => {
    const getTask = vi.fn().mockResolvedValue(makeTask({ state: 'succeeded' }));
    renderWithProviders(<Harness stopWhenIdle={false} />, {
      client: createFakeApi({ getTask }),
    });

    await advance();
    expect(getTask).toHaveBeenCalledTimes(1);

    // Well past the active cadence, still nothing: the task is finished.
    await advance(ACTIVE_POLL_INTERVAL_MS * 3);
    expect(getTask).toHaveBeenCalledTimes(1);

    await advance(IDLE_POLL_INTERVAL_MS - ACTIVE_POLL_INTERVAL_MS * 3);
    expect(getTask).toHaveBeenCalledTimes(2);
  });

  it('stops entirely on a terminal state', async () => {
    const getTask = vi.fn().mockResolvedValue(makeTask({ state: 'succeeded' }));
    renderWithProviders(<Harness />, { client: createFakeApi({ getTask }) });

    await advance();
    expect(getTask).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('polling').textContent).toBe('false');

    await advance(60_000);
    expect(getTask).toHaveBeenCalledTimes(1);
  });

  it('stops on unmount and makes no further calls', async () => {
    const getTask = vi.fn().mockResolvedValue(makeTask({ state: 'leased' }));
    const { unmount } = renderWithProviders(<Harness />, { client: createFakeApi({ getTask }) });

    await advance();
    expect(getTask).toHaveBeenCalledTimes(1);

    unmount();
    await advance(60_000);
    expect(getTask).toHaveBeenCalledTimes(1);
  });

  it('pauses while the tab is hidden and resumes when it is visible again', async () => {
    const getTask = vi.fn().mockResolvedValue(makeTask({ state: 'leased' }));
    let visibility: DocumentVisibilityState = 'visible';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    });

    renderWithProviders(<Harness />, { client: createFakeApi({ getTask }) });
    await advance();
    expect(getTask).toHaveBeenCalledTimes(1);

    visibility = 'hidden';
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await advance(30_000);
    expect(getTask).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('paused').textContent).toBe('true');

    visibility = 'visible';
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await advance();
    expect(getTask).toHaveBeenCalledTimes(2);
  });

  it('polls nothing when there is no task id', async () => {
    const getTask = vi.fn().mockResolvedValue(makeTask());
    renderWithProviders(<Harness taskId={null} />, { client: createFakeApi({ getTask }) });

    await advance(60_000);
    expect(getTask).not.toHaveBeenCalled();
    expect(screen.getByTestId('state').textContent).toBe('none');
  });
});
