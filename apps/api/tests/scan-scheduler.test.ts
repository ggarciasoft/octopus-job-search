/**
 * The bounded scan scheduler: one scan per due source, never a second while
 * one is in flight, interval plus jitter, Retry-After respected, and safe to
 * run from several replicas at once.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DISCOVERY_LIMITS } from '@job-getter/contracts';
import { scheduleDueScans } from '../src/discovery/scan-scheduler.js';
import { createScheduler } from '../src/tasks/scheduler.js';
import { createLogger } from '../src/logging.js';
import {
  authed,
  completeSetup,
  createHarness,
  type Harness,
  type Session,
} from './helpers/harness.js';
import {
  boardResult,
  claimTask,
  completeTask,
  createSource,
  deniedResult,
  normalizedJob,
  queueScan,
  runScan,
} from './helpers/discovery.js';

let harness: Harness;
let session: Session;

beforeAll(async () => {
  harness = await createHarness();
}, 180_000);

afterAll(async () => {
  await harness.close();
});

beforeEach(async () => {
  await harness.reset();
  session = await completeSetup(harness);
});

const HOUR_MS = 60 * 60 * 1000;
const JITTER_MS = DISCOVERY_LIMITS.scanIntervalJitterMinutes * 60 * 1000;

async function sourceRow(id: string) {
  return harness.db
    .selectFrom('sources')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
}

async function scansFor(id: string) {
  return harness.db.selectFrom('scans').selectAll().where('source_id', '=', id).execute();
}

async function makeDue(id: string, at: Date | null): Promise<void> {
  await harness.db
    .updateTable('sources')
    .set({ next_scan_after: at })
    .where('id', '=', id)
    .execute();
}

describe('scheduleDueScans', () => {
  it('queues exactly one scan per due source and none for the others', async () => {
    const due = await createSource(harness, session, { connector: 'greenhouse', board_key: 'due' });
    const later = await createSource(harness, session, {
      connector: 'greenhouse',
      board_key: 'later',
    });
    const disabled = await createSource(harness, session, { connector: 'lever', board_key: 'off' });
    await makeDue(later.id, new Date(Date.now() + HOUR_MS));
    await harness.app.inject(
      authed(session, {
        method: 'PATCH',
        url: `/api/v1/sources/${disabled.id}`,
        payload: { enabled: false },
      }),
    );

    const result = await scheduleDueScans(harness.db);
    expect(result.queued).toEqual([due.id]);

    expect(await scansFor(due.id)).toHaveLength(1);
    expect(await scansFor(later.id)).toHaveLength(0);
    expect(await scansFor(disabled.id)).toHaveLength(0);

    const tasks = await harness.db.selectFrom('tasks').selectAll().execute();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.type).toBe('fetch_board');
    expect(tasks[0]!.idempotency_key).toBeNull();

    // Running again immediately queues nothing: the source is no longer due
    // and its scan is in flight.
    expect((await scheduleDueScans(harness.db)).queued).toEqual([]);
  });

  it('sets next_scan_after to now plus the interval plus jitter, within the window', async () => {
    const source = await createSource(harness, session);
    const now = new Date('2026-09-20T10:00:00.000Z');

    await scheduleDueScans(harness.db, { now, random: () => 0 });
    let row = await sourceRow(source.id);
    expect(row.next_scan_after!.getTime()).toBe(now.getTime() + 24 * HOUR_MS);

    // Complete the scan, make it due again, and take the far end of the jitter.
    const claimed = await claimTask(harness, 'fetch_board');
    await completeTask(harness, claimed!.task_id, claimed!.lease_token, boardResult([]));
    await makeDue(source.id, now);
    await scheduleDueScans(harness.db, { now, random: () => 0.999 });
    row = await sourceRow(source.id);
    const offset = row.next_scan_after!.getTime() - now.getTime();
    expect(offset).toBeGreaterThan(24 * HOUR_MS);
    expect(offset).toBeLessThanOrEqual(24 * HOUR_MS + JITTER_MS);
  });

  it('uses the workspace scan_interval_hours preference', async () => {
    const preferences = (
      await harness.app.inject(authed(session, { method: 'GET', url: '/api/v1/preferences' }))
    ).json();
    await harness.app.inject(
      authed(session, {
        method: 'PUT',
        url: '/api/v1/preferences',
        payload: {
          expected_revision: preferences.revision,
          config: { ...preferences.config, scan_interval_hours: 6 },
        },
      }),
    );
    const source = await createSource(harness, session);
    const now = new Date();
    await scheduleDueScans(harness.db, { now, random: () => 0 });
    expect((await sourceRow(source.id)).next_scan_after!.getTime()).toBe(
      now.getTime() + 6 * HOUR_MS,
    );
  });

  it('never queues a second scan while one is in flight, even when overdue', async () => {
    const source = await createSource(harness, session);
    expect((await queueScan(harness, session, source.id)).statusCode).toBe(202);
    await makeDue(source.id, new Date(Date.now() - HOUR_MS));

    const result = await scheduleDueScans(harness.db);
    expect(result.queued).toEqual([]);
    expect(await scansFor(source.id)).toHaveLength(1);

    // Once the worker finishes it becomes eligible again.
    const claimed = await claimTask(harness, 'fetch_board');
    await completeTask(harness, claimed!.task_id, claimed!.lease_token, boardResult([]));
    await makeDue(source.id, new Date(Date.now() - HOUR_MS));
    expect((await scheduleDueScans(harness.db)).queued).toEqual([source.id]);
    expect(await scansFor(source.id)).toHaveLength(2);
  });

  it('skips a blocked source until the user re-enables it', async () => {
    const source = await createSource(harness, session);
    for (let i = 0; i < DISCOVERY_LIMITS.blockAfterConsecutiveDenials; i += 1) {
      await runScan(harness, session, source.id, deniedResult('ACCESS_DENIED'));
    }
    await makeDue(source.id, null);
    expect((await scheduleDueScans(harness.db)).queued).toEqual([]);

    await harness.app.inject(
      authed(session, {
        method: 'PATCH',
        url: `/api/v1/sources/${source.id}`,
        payload: { enabled: true },
      }),
    );
    expect((await scheduleDueScans(harness.db)).queued).toEqual([source.id]);
  });

  it('honours Retry-After: a rate-limited source is not due before it', async () => {
    const source = await createSource(harness, session);
    const retryAfterSeconds = 2 * 60 * 60;
    await runScan(harness, session, source.id, deniedResult('RATE_LIMITED', { retryAfterSeconds }));
    const row = await sourceRow(source.id);
    const earliest = row.last_error_at!.getTime() + retryAfterSeconds * 1000;
    expect(row.next_scan_after!.getTime()).toBeGreaterThanOrEqual(earliest);

    // Pretend the regular interval had already elapsed: Retry-After still wins.
    await makeDue(source.id, new Date(Date.now() + 60_000));
    await runScan(harness, session, source.id, boardResult([normalizedJob({ external_id: '1' })]));
    await harness.db
      .updateTable('sources')
      .set({ next_scan_after: new Date(Date.now() - 1000) })
      .where('id', '=', source.id)
      .execute();
    await runScan(harness, session, source.id, deniedResult('RATE_LIMITED', { retryAfterSeconds }));
    expect((await scheduleDueScans(harness.db)).queued).toEqual([]);
    expect(
      (await scheduleDueScans(harness.db, { now: new Date(Date.now() + 25 * HOUR_MS) })).queued,
    ).toEqual([source.id]);
  });

  it('divides due sources between concurrent runs without double-queueing', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      ids.push(
        (await createSource(harness, session, { connector: 'greenhouse', board_key: `b${i}` })).id,
      );
    }

    const runs = await Promise.all([
      scheduleDueScans(harness.db),
      scheduleDueScans(harness.db),
      scheduleDueScans(harness.db),
    ]);
    const queued = runs.flatMap((run) => run.queued).sort();
    expect(queued).toEqual([...ids].sort());

    const scans = await harness.db.selectFrom('scans').selectAll().execute();
    expect(scans).toHaveLength(6);
    expect(new Set(scans.map((scan) => scan.source_id)).size).toBe(6);
  });

  it('runs as part of the housekeeping scheduler', async () => {
    const source = await createSource(harness, session);
    const scheduler = createScheduler({
      db: harness.db,
      storage: harness.storage,
      logger: createLogger({ level: 'silent' }),
      random: () => 0,
    });
    await scheduler.runOnce();
    await scheduler.stop();
    expect(await scansFor(source.id)).toHaveLength(1);
  });
});
