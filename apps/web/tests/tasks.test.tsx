import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createFakeApi, makeTask, renderApp } from './helpers';

describe('tasks list', () => {
  it('lists real tasks with their state, progress and attempt', async () => {
    const listTasks = vi.fn(async () => ({
      items: [
        makeTask({
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          state: 'leased' as const,
          attempt: 1,
          progress: { stage: 'parsing', percent: 30 },
        }),
        makeTask({
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          state: 'failed' as const,
          attempt: 3,
          error: { code: 'TIMEOUT', message: 'Lease expired', retryable: true },
        }),
      ],
      next_cursor: null,
    }));
    renderApp({ client: createFakeApi({ listTasks }), route: '/tasks' });

    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row');
    // One header row plus two task rows; nothing invented.
    expect(rows).toHaveLength(3);
    expect(within(table).getByText('Leased')).toBeTruthy();
    expect(within(table).getByText('Failed')).toBeTruthy();
    expect(within(table).getByText(/parsing/)).toBeTruthy();
    expect(within(table).getByText('Not reported')).toBeTruthy();
    expect(screen.getByText('That is every task the API returned.')).toBeTruthy();
  });

  it('follows the cursor when loading another page', async () => {
    const user = userEvent.setup();
    const listTasks = vi
      .fn()
      .mockResolvedValueOnce({
        items: [makeTask({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })],
        next_cursor: 'cursor-2',
      })
      .mockResolvedValueOnce({
        items: [makeTask({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' })],
        next_cursor: null,
      });
    renderApp({ client: createFakeApi({ listTasks }), route: '/tasks' });

    await user.click(await screen.findByRole('button', { name: 'Load more' }));

    expect(listTasks).toHaveBeenCalledTimes(2);
    expect(listTasks.mock.calls[1]?.[0]).toMatchObject({
      query: { cursor: 'cursor-2', limit: 25 },
    });
    expect(await screen.findByText('That is every task the API returned.')).toBeTruthy();
  });

  it('explains a failure to load instead of showing an empty list', async () => {
    const listTasks = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    renderApp({ client: createFakeApi({ listTasks }), route: '/tasks' });

    expect(await screen.findByText('The task list could not be loaded.')).toBeTruthy();
    expect(screen.queryByText('No tasks have run yet')).toBeTruthy();
  });
});
