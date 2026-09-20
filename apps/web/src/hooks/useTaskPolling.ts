import type { TaskState, TaskView } from '@job-getter/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from '../api/ApiProvider';
import { isApiError } from '../api/errors';

/**
 * 02_ARCHITECTURE.md, data flow step 8: "UI polls tasks every two seconds
 * while active, backs off to 15 seconds while idle."
 */
export const ACTIVE_POLL_INTERVAL_MS = 2_000;
export const IDLE_POLL_INTERVAL_MS = 15_000;

/** From the contract's task state union; no parallel list is declared here. */
const TERMINAL_STATES: readonly TaskState[] = ['succeeded', 'failed', 'cancelled'];

export function isTerminalTaskState(state: TaskState): boolean {
  return TERMINAL_STATES.includes(state);
}

/**
 * The polling cadence for a set of watched task states. Shared with list
 * screens so every screen in every milestone uses the same two numbers.
 * An empty set, or a set where everything has finished, is "idle".
 */
export function pollIntervalFor(states: readonly TaskState[]): number {
  return states.some((state) => !isTerminalTaskState(state))
    ? ACTIVE_POLL_INTERVAL_MS
    : IDLE_POLL_INTERVAL_MS;
}

export interface UseTaskPollingOptions {
  /** The task to follow. `null` polls nothing; the hook is generic over ids. */
  readonly taskId: string | null;
  readonly enabled?: boolean;
  /**
   * Stop once the task reaches a terminal state (the default). Set false to
   * keep a finished task fresh at the idle cadence, which is what a list of
   * mixed tasks wants.
   */
  readonly stopWhenIdle?: boolean;
  readonly onTerminal?: (task: TaskView) => void;
}

export interface UseTaskPollingResult {
  readonly task: TaskView | null;
  readonly error: unknown;
  readonly isLoading: boolean;
  /** True while a timer is scheduled: the UI can say when it stopped watching. */
  readonly isPolling: boolean;
  /** True when polling is suspended because the tab is hidden. */
  readonly isPaused: boolean;
  readonly refresh: () => void;
}

/**
 * Follows one task through the queue.
 *
 * Guarantees, all of them tested in `tests/useTaskPolling.test.tsx`:
 *  - one request in flight at a time, scheduled with `setTimeout` after the
 *    previous response, so a slow API cannot pile requests up;
 *  - polling stops on a terminal state, on unmount and while the tab is hidden
 *    (Page Visibility API) and resumes when it becomes visible again;
 *  - the in-flight request is aborted on unmount, so no state update or extra
 *    call happens after the component is gone.
 */
export function useTaskPolling({
  taskId,
  enabled = true,
  stopWhenIdle = true,
  onTerminal,
}: UseTaskPollingOptions): UseTaskPollingResult {
  const api = useApi();
  const [task, setTask] = useState<TaskView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isPolling, setIsPolling] = useState<boolean>(false);
  const [isVisible, setIsVisible] = useState<boolean>(
    () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
  );
  const [refreshToken, setRefreshToken] = useState(0);

  const onTerminalRef = useRef(onTerminal);
  onTerminalRef.current = onTerminal;

  const refresh = useCallback(() => setRefreshToken((value) => value + 1), []);

  useEffect(() => {
    const onVisibilityChange = () => setIsVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  // Reset when the watched task changes, so a previous task's result is never
  // shown under a new id.
  useEffect(() => {
    setTask(null);
    setError(null);
  }, [taskId]);

  useEffect(() => {
    if (taskId === null || !enabled || !isVisible) {
      setIsPolling(false);
      return;
    }

    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();

    const schedule = (delayMs: number) => {
      if (disposed) return;
      setIsPolling(true);
      timer = setTimeout(() => {
        void poll();
      }, delayMs);
    };

    const poll = async (): Promise<void> => {
      setIsLoading(true);
      try {
        const next = await api.getTask({ params: { id: taskId }, signal: controller.signal });
        if (disposed) return;
        setTask(next);
        setError(null);

        if (isTerminalTaskState(next.state)) {
          onTerminalRef.current?.(next);
          if (stopWhenIdle) {
            setIsPolling(false);
            return;
          }
        }
        schedule(pollIntervalFor([next.state]));
      } catch (caught) {
        if (disposed) return;
        setError(caught);
        // A task that is gone, or a session that ended, will not start
        // working again by asking repeatedly.
        const fatal = isApiError(caught) && [401, 403, 404].includes(caught.status);
        if (fatal) {
          setIsPolling(false);
          return;
        }
        schedule(IDLE_POLL_INTERVAL_MS);
      } finally {
        if (!disposed) setIsLoading(false);
      }
    };

    void poll();

    return () => {
      disposed = true;
      controller.abort();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [api, taskId, enabled, isVisible, stopWhenIdle, refreshToken]);

  return {
    task,
    error,
    isLoading,
    isPolling,
    isPaused: !isVisible && taskId !== null && enabled,
    refresh,
  };
}
