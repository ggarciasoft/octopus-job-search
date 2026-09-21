import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { JobGetterApi } from '../src/api/client';
import { LEVER_EU_BASE_URL } from '../src/discovery/BoardsPanel';
import {
  SCAN_ID,
  SOURCE_ID,
  TASK_ID,
  createFakeApi,
  makeCapabilities,
  makeMe,
  makeScan,
  makeSource,
  makeTask,
  renderApp,
} from './helpers';

function discoveryMe(overrides: { worker_online?: boolean } = {}) {
  return makeMe({
    capabilities: makeCapabilities({ job_discovery: true, ...overrides }),
  });
}

async function openDiscover(api: JobGetterApi) {
  renderApp({ client: api, route: '/discover' });
  await screen.findByRole('heading', { name: 'Discover', level: 1 });
}

describe('discover: boards', () => {
  it('states that discovery covers only registered boards and imported URLs', async () => {
    await openDiscover(createFakeApi({ getMe: async () => discoveryMe() }));
    const note = screen.getByTestId('coverage-note').textContent ?? '';
    expect(note).toContain('Nothing searches the whole internet');
    expect(note).toContain('only the boards registered here and the URLs you import');
  });

  it('adds a board with the chosen connector, key and the Lever EU base_url only when asked', async () => {
    const user = userEvent.setup();
    const createSource = vi.fn<JobGetterApi['createSource']>(async ({ body }) =>
      makeSource({ connector: body.connector, board_key: body.board_key }),
    );
    const api = createFakeApi({ getMe: async () => discoveryMe(), createSource });
    await openDiscover(api);

    // Greenhouse: no base_url at all, not even null.
    await user.type(screen.getByLabelText(/^Board key/), 'acme');
    expect(screen.getByText(/Greenhouse board token is the last part/)).toBeTruthy();
    expect(screen.getAllByText(/Only public boards work/).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Add board' }));
    await waitFor(() => expect(createSource).toHaveBeenCalledTimes(1));
    expect(createSource.mock.calls[0]?.[0].body).toEqual({
      connector: 'greenhouse',
      board_key: 'acme',
    });
    expect(await screen.findByText(/Board "acme" added/)).toBeTruthy();

    // Lever EU: the documented endpoint, sent only with the toggle on.
    await user.selectOptions(screen.getByLabelText(/^Connector/), 'lever');
    expect(screen.getByText(/Lever site slug is the part after jobs.lever.co/)).toBeTruthy();
    await user.type(screen.getByLabelText(/^Board key/), 'acme-eu');
    await user.click(screen.getByLabelText(/hosted in the EU region/));
    await user.click(screen.getByRole('button', { name: 'Add board' }));
    await waitFor(() => expect(createSource).toHaveBeenCalledTimes(2));
    expect(createSource.mock.calls[1]?.[0].body).toEqual({
      connector: 'lever',
      board_key: 'acme-eu',
      base_url: LEVER_EU_BASE_URL,
    });
  });

  it('rejects a malformed key locally, keeping the input, and never calls the API', async () => {
    const user = userEvent.setup();
    const createSource = vi.fn<JobGetterApi['createSource']>();
    await openDiscover(createFakeApi({ getMe: async () => discoveryMe(), createSource }));

    await user.type(screen.getByLabelText(/^Board key/), 'acme corp');
    await user.click(screen.getByRole('button', { name: 'Add board' }));
    expect(screen.getByRole('alert').textContent).toContain('Use only letters, digits');
    expect(createSource).not.toHaveBeenCalled();
    expect((screen.getByLabelText(/^Board key/) as HTMLInputElement).value).toBe('acme corp');
  });

  it('sends an Idempotency-Key on scan and reuses it on retry, then follows the task id', async () => {
    const user = userEvent.setup();
    const scanSource = vi
      .fn<JobGetterApi['scanSource']>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue({ task_id: TASK_ID, status: 'queued' });
    const getScan = vi.fn<JobGetterApi['getScan']>(async () =>
      makeScan({ status: 'running', started_at: '2026-01-01T00:00:01.000Z' }),
    );
    const api = createFakeApi({
      getMe: async () => discoveryMe(),
      listSources: async () => ({ items: [makeSource()], next_cursor: null }),
      scanSource,
      getScan,
    });
    await openDiscover(api);

    const scanButton = await screen.findByRole('button', { name: 'Scan now' });
    expect(scanButton.hasAttribute('disabled')).toBe(false);
    await user.click(scanButton);
    await screen.findByText(/did not complete/);
    await user.click(screen.getByRole('button', { name: 'Scan now' }));
    await waitFor(() => expect(scanSource).toHaveBeenCalledTimes(2));

    const first = scanSource.mock.calls[0]?.[0];
    const second = scanSource.mock.calls[1]?.[0];
    expect(first?.params).toEqual({ id: SOURCE_ID });
    expect(typeof first?.idempotencyKey).toBe('string');
    expect(first?.idempotencyKey.length).toBeGreaterThan(0);
    expect(second?.idempotencyKey).toBe(first?.idempotencyKey);

    // The accepted task id is what the scan panel follows.
    await waitFor(() => expect(getScan).toHaveBeenCalled());
    expect(getScan.mock.calls[0]?.[0].params).toEqual({ id: TASK_ID });
    expect((await screen.findByTestId('scan-status')).dataset.status).toBe('running');
  });

  it('disables "Scan now" for a blocked or disabled board and says why', async () => {
    const blocked = makeSource({
      id: SOURCE_ID,
      board_key: 'blocked-board',
      health: {
        state: 'blocked',
        consecutive_failures: 3,
        last_error_code: 'ACCESS_DENIED',
        last_error_at: '2026-01-01T00:00:00.000Z',
        detail: 'HTTP 403 three times',
      },
    });
    const disabled = makeSource({
      id: '99999999-9999-4999-8999-999999999999',
      board_key: 'off-board',
      enabled: false,
      health: {
        state: 'disabled',
        consecutive_failures: 0,
        last_error_code: null,
        last_error_at: null,
        detail: null,
      },
    });
    const scanSource = vi.fn<JobGetterApi['scanSource']>();
    await openDiscover(
      createFakeApi({
        getMe: async () => discoveryMe(),
        listSources: async () => ({ items: [blocked, disabled], next_cursor: null }),
        scanSource,
      }),
    );

    const blockedRow = (await screen.findByTestId('board-blocked-board')).closest(
      'tr',
    ) as HTMLElement;
    const blockedButton = within(blockedRow).getByRole('button', { name: 'Scan now' });
    expect(blockedButton.hasAttribute('disabled')).toBe(true);
    const blockedReason = within(blockedRow).getByTestId('scan-reason');
    expect(blockedReason.textContent).toContain('repeated refusals');
    expect(blockedButton.getAttribute('aria-describedby')).toBe(blockedReason.id);
    expect(within(blockedRow).getByTestId('source-health').dataset.state).toBe('blocked');
    expect(within(blockedRow).getByText('HTTP 403 three times')).toBeTruthy();
    expect(within(blockedRow).getByText('Last error: ACCESS_DENIED')).toBeTruthy();
    expect(within(blockedRow).getByRole('button', { name: 'Re-enable' })).toBeTruthy();

    const disabledRow = screen.getByTestId('board-off-board').closest('tr') as HTMLElement;
    expect(
      within(disabledRow).getByRole('button', { name: 'Scan now' }).hasAttribute('disabled'),
    ).toBe(true);
    expect(within(disabledRow).getByTestId('scan-reason').textContent).toContain(
      'board is disabled',
    );
    expect(within(disabledRow).getByRole('button', { name: 'Enable' })).toBeTruthy();

    expect(scanSource).not.toHaveBeenCalled();
  });

  it('asks before deleting and says the jobs are kept', async () => {
    const user = userEvent.setup();
    const deleteSource = vi.fn<JobGetterApi['deleteSource']>(async () => undefined);
    await openDiscover(
      createFakeApi({
        getMe: async () => discoveryMe(),
        listSources: async () => ({ items: [makeSource()], next_cursor: null }),
        deleteSource,
      }),
    );

    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByTestId('delete-body').textContent).toContain(
      'Jobs already found through it are kept',
    );
    expect(deleteSource).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Delete board, keep jobs' }));
    await waitFor(() => expect(deleteSource).toHaveBeenCalledTimes(1));
    expect(deleteSource.mock.calls[0]?.[0].params).toEqual({ id: SOURCE_ID });
  });

  it('disables every control with the reason when the API reports no job discovery', async () => {
    await openDiscover(
      createFakeApi({
        getMe: async () => makeMe(),
        listSources: async () => ({ items: [makeSource()], next_cursor: null }),
      }),
    );
    expect(screen.getByText('Job discovery is not available on this server')).toBeTruthy();
    expect((await screen.findByRole('button', { name: 'Scan now' })).hasAttribute('disabled')).toBe(
      true,
    );
    expect(screen.getByRole('button', { name: 'Add board' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Import' }).hasAttribute('disabled')).toBe(true);
  });
});

describe('discover: scan status', () => {
  const partialSource = makeSource({ last_scan_id: SCAN_ID, job_count: 42 });

  function fetchBoardTask(warnings: { code: string; message: string }[]) {
    return makeTask({
      type: 'fetch_board',
      state: 'succeeded',
      attempt: 1,
      result: {
        jobs: [],
        complete_snapshot: false,
        next_cursor: null,
        pages_fetched: 1,
        etag: null,
        last_modified: null,
        observed_health: { state: 'ok', http_status: 200, retry_after_seconds: null },
        warnings,
        fetched_at: '2026-01-01T00:00:05.000Z',
      },
    });
  }

  it('says plainly that a partial scan closed nothing', async () => {
    const user = userEvent.setup();
    await openDiscover(
      createFakeApi({
        getMe: async () => discoveryMe(),
        listSources: async () => ({ items: [partialSource], next_cursor: null }),
        getScan: async () =>
          makeScan({
            status: 'partial',
            complete_snapshot: false,
            counts: { fetched: 10, created: 2, updated: 1, unchanged: 7, closed: 0, pages: 1 },
            completed_at: '2026-01-01T00:00:05.000Z',
          }),
        getTask: async () =>
          fetchBoardTask([{ code: 'PAGE_LIMIT_REACHED', message: 'Stopped after 1 page.' }]),
      }),
    );

    await user.click(await screen.findByRole('button', { name: 'View last scan' }));
    const partial = await screen.findByTestId('scan-partial');
    expect(partial.textContent).toContain('Nothing was closed because of this scan');
    expect(screen.getByTestId('scan-status').dataset.status).toBe('partial');
    expect(screen.getByTestId('scan-count-closed').textContent).toBe('0');
    expect(screen.getByTestId('scan-count-created').textContent).toBe('2');
    expect(screen.queryByTestId('scan-unchanged')).toBeNull();
    // The worker's note is listed, human label plus the code.
    expect(screen.getByText('Stopped after 1 page.')).toBeTruthy();
    expect(screen.getByText('PAGE_LIMIT_REACHED')).toBeTruthy();
  });

  it('renders a 304 re-scan as unchanged since the last scan, not as a partial alarm', async () => {
    const user = userEvent.setup();
    await openDiscover(
      createFakeApi({
        getMe: async () => discoveryMe(),
        listSources: async () => ({ items: [partialSource], next_cursor: null }),
        getScan: async () =>
          makeScan({
            status: 'partial',
            complete_snapshot: false,
            counts: { fetched: 0, created: 0, updated: 0, unchanged: 0, closed: 0, pages: 0 },
            completed_at: '2026-01-01T00:00:05.000Z',
          }),
        getTask: async () => fetchBoardTask([{ code: 'NOT_MODIFIED', message: 'HTTP 304' }]),
      }),
    );

    await user.click(await screen.findByRole('button', { name: 'View last scan' }));
    const unchanged = await screen.findByTestId('scan-unchanged');
    expect(unchanged.textContent).toContain('The board reported no changes');
    expect(unchanged.textContent).toContain('42 jobs');
    expect(screen.queryByTestId('scan-partial')).toBeNull();
    expect(screen.queryByText(/Nothing was closed because of this scan/)).toBeNull();
    expect(screen.queryByText(/This scan was partial/)).toBeNull();
  });

  it('renders the same 304 re-scan as unchanged in Spanish', async () => {
    globalThis.localStorage.setItem('job-getter.locale', 'es');
    const user = userEvent.setup();
    await openDiscoverEs(
      createFakeApi({
        getMe: async () => discoveryMe(),
        listSources: async () => ({ items: [partialSource], next_cursor: null }),
        getScan: async () => makeScan({ status: 'partial', complete_snapshot: false }),
        getTask: async () => fetchBoardTask([{ code: 'NOT_MODIFIED', message: 'HTTP 304' }]),
      }),
    );
    await user.click(await screen.findByRole('button', { name: 'Ver último escaneo' }));
    const unchanged = await screen.findByTestId('scan-unchanged');
    expect(unchanged.textContent).toContain('El tablón informó de que no hay cambios');
    expect(screen.queryByTestId('scan-partial')).toBeNull();
  });

  it('renders a complete scan with its counts and a failed scan with its real error', async () => {
    const user = userEvent.setup();
    const getScan = vi
      .fn<JobGetterApi['getScan']>()
      .mockResolvedValueOnce(
        makeScan({
          status: 'succeeded',
          complete_snapshot: true,
          counts: { fetched: 5, created: 5, updated: 0, unchanged: 0, closed: 1, pages: 1 },
        }),
      )
      .mockResolvedValue(
        makeScan({
          id: '77777777-7777-4777-8777-777777777777',
          status: 'failed',
          error_code: 'TIMEOUT',
          error_message: 'No response within 20 s.',
        }),
      );
    await openDiscover(
      createFakeApi({
        getMe: async () => discoveryMe(),
        listSources: async () => ({ items: [partialSource], next_cursor: null }),
        getScan,
        getTask: async () => fetchBoardTask([]),
      }),
    );

    await user.click(await screen.findByRole('button', { name: 'View last scan' }));
    expect((await screen.findByTestId('scan-complete')).textContent).toContain('Complete snapshot');
    expect(screen.getByTestId('scan-count-closed').textContent).toBe('1');

    await user.click(screen.getByRole('button', { name: 'Stop following' }));
    expect(screen.getByText(/No scan is being followed/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'View last scan' }));
    expect((await screen.findByTestId('scan-error-code')).textContent).toBe('TIMEOUT');
    expect(screen.getByTestId('scan-error-message').textContent).toContain(
      'No response within 20 s.',
    );
    expect(screen.queryByTestId('scan-partial')).toBeNull();
    expect(screen.queryByTestId('scan-complete')).toBeNull();
  });

  it('says a queued scan will not run while the API reports no worker', async () => {
    const user = userEvent.setup();
    await openDiscover(
      createFakeApi({
        getMe: async () => discoveryMe({ worker_online: false }),
        listSources: async () => ({ items: [makeSource()], next_cursor: null }),
        getScan: async () => makeScan({ status: 'queued' }),
      }),
    );
    expect(screen.getByText(/A scan or import queued now stays queued/)).toBeTruthy();
    await user.click(await screen.findByRole('button', { name: 'Scan now' }));
    const explanation = (await screen.findByTestId('scan-queued-no-worker')).textContent ?? '';
    expect(explanation).toContain('no worker online');
    expect(explanation).toContain('you do not need to queue it again');
  });
});

async function openDiscoverEs(api: JobGetterApi) {
  renderApp({ client: api, route: '/discover' });
  await screen.findByRole('heading', { name: 'Descubrir', level: 1 });
}
