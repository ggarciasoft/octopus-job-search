/**
 * Profile import: AT02 and AT04.
 *
 *   AT02 — "Text PDF/DOCX import → Editable extraction with provenance; no
 *           automatic confirmation."
 *   AT04 — "Conflicting profile import → Existing verified facts preserved
 *           until user resolves."
 *
 * The whole round trip is exercised against the real queue: the route enqueues
 * a `parse_profile` task, a worker claims it over `/internal/v1`, completes it
 * with a result that must satisfy the contract's closed output schema, and the
 * API applies that result to the import row inside the completing transaction.
 * Nothing here stubs the worker protocol.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Value } from '@sinclair/typebox/value';
import {
  PARSE_LIMITS,
  PROTOCOL_VERSION,
  ParseProfileInput,
  ProfileImportView,
  RESULT_SCHEMA_VERSION,
  type ClaimResponse,
  type DraftFact,
  type ImportWarning,
} from '@job-getter/contracts';
import { reclaimExpiredLeases } from '../src/tasks/queue.js';
import {
  asWorker,
  authed,
  completeSetup,
  createHarness,
  createSecondWorkspace,
  idempotencyKey,
  type Harness,
  type Session,
} from './helpers/harness.js';

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

const ACME_2020 = {
  employer: 'Acme Robotics',
  title: 'Senior Engineer',
  start_month: '2020-01',
  end_month: '2022-06',
  current: false,
  employment_type: 'full_time',
  bullets: [{ text: 'Shipped the gripper firmware.', evidence_reference: 'cv.pdf p1' }],
  skills: ['c++'],
} as const;

/** Same employer, overlapping dates, different title: a conflict, not a merge. */
const ACME_2020_CONFLICTING = {
  ...ACME_2020,
  title: 'Principal Engineer',
  end_month: '2023-01',
} as const;

const PASTED_TEXT = 'Ada Lovelace\nAcme Robotics, Senior Engineer, 2020-01 to 2022-06\n';

function draft(overrides: Partial<DraftFact> = {}): DraftFact {
  return {
    draft_id: 'd1',
    kind: 'experience',
    value: ACME_2020,
    source_excerpt: 'Acme Robotics, Senior Engineer, 2020-01 to 2022-06',
    source_locator: 'line 2',
    confidence: 0.82,
    ...overrides,
  } as DraftFact;
}

function parseResult(drafts: DraftFact[], warnings: ImportWarning[] = []) {
  return {
    draft_facts: drafts,
    warnings,
    extracted_chars: PASTED_TEXT.length,
    provider: { id: 'fake', model: 'fake-deterministic-1', input_tokens: 120, output_tokens: 60 },
  };
}

// ---------------------------------------------------------------------------
// Helpers driving the real routes
// ---------------------------------------------------------------------------

function createImport(
  payload: Record<string, unknown>,
  as: Session = session,
  key = idempotencyKey(),
) {
  return harness.app.inject(
    authed(as, {
      method: 'POST',
      url: '/api/v1/profile/imports',
      headers: { 'idempotency-key': key },
      payload,
    }),
  );
}

function readImport(id: string, as: Session = session) {
  return harness.app.inject(authed(as, { method: 'GET', url: `/api/v1/profile/imports/${id}` }));
}

function confirmImport(id: string, payload: Record<string, unknown>, as: Session = session) {
  return harness.app.inject(
    authed(as, { method: 'POST', url: `/api/v1/profile/imports/${id}/confirm`, payload }),
  );
}

function getProfile(as: Session = session) {
  return harness.app.inject(authed(as, { method: 'GET', url: '/api/v1/profile' }));
}

function patchProfile(payload: Record<string, unknown>, as: Session = session) {
  return harness.app.inject(authed(as, { method: 'PATCH', url: '/api/v1/profile', payload }));
}

async function claimParseProfile(): Promise<ClaimResponse> {
  const response = await harness.app.inject(
    asWorker({
      method: 'POST',
      url: '/internal/v1/tasks/claim',
      payload: {
        worker_id: 'worker-1',
        capabilities: ['parse_profile'],
        protocol_version: PROTOCOL_VERSION,
      },
    }),
  );
  expect(response.statusCode).toBe(200);
  return response.json() as ClaimResponse;
}

async function completeTask(taskId: string, leaseToken: string, result: unknown) {
  return harness.app.inject(
    asWorker({
      method: 'POST',
      url: `/internal/v1/tasks/${taskId}/complete`,
      payload: {
        lease_token: leaseToken,
        result_schema_version: RESULT_SCHEMA_VERSION,
        result,
      },
    }),
  );
}

/** Creates an import from pasted text and delivers a worker result for it. */
async function importWithDrafts(
  drafts: DraftFact[],
  warnings: ImportWarning[] = [],
): Promise<{ importId: string; taskId: string }> {
  const created = await createImport({ pasted_text: PASTED_TEXT });
  expect(created.statusCode).toBe(202);
  const taskId = created.json().task_id as string;

  const claimed = await claimParseProfile();
  expect(claimed.task_id).toBe(taskId);
  const completed = await completeTask(taskId, claimed.lease_token, parseResult(drafts, warnings));
  expect(completed.statusCode).toBe(200);

  const view = await readImport(taskId);
  expect(view.statusCode).toBe(200);
  return { importId: view.json().id as string, taskId };
}

/** Seeds a confirmed fact directly through the public PATCH route. */
async function seedConfirmedExperience(value: unknown = ACME_2020): Promise<string> {
  const profile = await getProfile();
  const response = await patchProfile({
    expected_revision: profile.json().revision,
    changes: [{ op: 'upsert', kind: 'experience', value, confirmed: true }],
  });
  expect(response.statusCode).toBe(200);
  return response.json().facts[0].id as string;
}

// ---------------------------------------------------------------------------

describe('POST /profile/imports', () => {
  it('requires exactly one of file_id and pasted_text', async () => {
    const neither = await createImport({});
    expect(neither.statusCode).toBe(422);
    expect(neither.json().error.code).toBe('UNPROCESSABLE');

    const both = await createImport({ pasted_text: PASTED_TEXT, file_id: randomUUID() });
    expect(both.statusCode).toBe(422);

    expect(await harness.db.selectFrom('profile_imports').selectAll().execute()).toEqual([]);
    expect(await harness.db.selectFrom('tasks').selectAll().execute()).toEqual([]);
  });

  it('requires an Idempotency-Key', async () => {
    const response = await harness.app.inject(
      authed(session, {
        method: 'POST',
        url: '/api/v1/profile/imports',
        payload: { pasted_text: PASTED_TEXT },
      }),
    );
    expect(response.statusCode).toBe(400);
    expect(response.json().error.fields).toHaveProperty('idempotency-key');
  });

  it('reports an unknown file_id as absent without creating anything', async () => {
    const response = await createImport({ file_id: randomUUID() });
    expect(response.statusCode).toBe(404);
    expect(await harness.db.selectFrom('profile_imports').selectAll().execute()).toEqual([]);
  });

  /** AT02, first half: the enqueued task is a real, contract-valid task. */
  it('enqueues a parse_profile task whose input satisfies ParseProfileInput', async () => {
    const response = await createImport({ pasted_text: PASTED_TEXT });
    expect(response.statusCode).toBe(202);
    expect(response.json().status).toBe('queued');

    const task = await harness.db
      .selectFrom('tasks')
      .selectAll()
      .where('id', '=', response.json().task_id)
      .executeTakeFirstOrThrow();

    expect(task.type).toBe('parse_profile');
    expect(task.state).toBe('queued');
    expect(task.capability).toBe('parse_profile');
    expect(Value.Check(ParseProfileInput, task.payload)).toBe(true);

    const payload = task.payload as typeof ParseProfileInput.static;
    expect(payload.inline_text).toBe(PASTED_TEXT);
    expect(payload.source_file_id).toBeNull();
    expect(payload.format_hint).toBe('plain_text');
    expect(payload.profile_revision).toBe(1);
    expect(payload.limits).toEqual({
      max_pdf_pages: PARSE_LIMITS.maxPdfPages,
      max_extracted_chars: PARSE_LIMITS.maxExtractedChars,
    });

    // The import row and the task were committed together.
    const imported = await harness.db
      .selectFrom('profile_imports')
      .selectAll()
      .executeTakeFirstOrThrow();
    expect(imported.task_id).toBe(task.id);
    expect(imported.id).toBe(payload.profile_import_id);
    expect(imported.status).toBe('queued');
  });

  it('declares the uploaded document as a task input so the worker may fetch it', async () => {
    const file = await harness.db
      .insertInto('files')
      .values({
        workspace_id: session.workspaceId,
        storage_key: `ws/${randomUUID()}`,
        original_name: 'cv.pdf',
        mime: 'application/pdf',
        bytes: 1024,
        sha256: 'a'.repeat(64),
        state: 'ready',
        purpose: 'cv_original',
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const response = await createImport({ file_id: file.id });
    expect(response.statusCode).toBe(202);

    const task = await harness.db
      .selectFrom('tasks')
      .selectAll()
      .where('id', '=', response.json().task_id)
      .executeTakeFirstOrThrow();

    expect(task.input_file_ids).toEqual([file.id]);
    const payload = task.payload as typeof ParseProfileInput.static;
    expect(payload.source_file_id).toBe(file.id);
    expect(payload.inline_text).toBeNull();
    // The mime resolved the "auto" hint rather than leaving the worker to guess.
    expect(payload.format_hint).toBe('pdf');
  });

  it('replays the same Idempotency-Key instead of queueing a second import', async () => {
    const key = idempotencyKey();
    const first = await createImport({ pasted_text: PASTED_TEXT }, session, key);
    const second = await createImport({ pasted_text: PASTED_TEXT }, session, key);

    expect(second.statusCode).toBe(202);
    expect(second.json()).toEqual(first.json());
    expect(await harness.db.selectFrom('profile_imports').selectAll().execute()).toHaveLength(1);
  });
});

describe('applying the worker result (AT02)', () => {
  it('moves the import to ready_for_review with drafts and provenance intact', async () => {
    const { importId, taskId } = await importWithDrafts([
      draft(),
      draft({
        draft_id: 'd2',
        kind: 'skill',
        value: {
          canonical_name: 'C++',
          aliases: ['cpp'],
          user_declared_proficiency: null,
          years: null,
        },
        source_excerpt: 'Skills: C++',
        source_locator: 'line 4',
        confidence: 0.6,
      }),
    ]);

    const view = await readImport(importId);
    expect(view.statusCode).toBe(200);
    const body = view.json();
    expect(Value.Check(ProfileImportView, body)).toBe(true);
    expect(body.status).toBe('ready_for_review');
    expect(body.task_id).toBe(taskId);
    expect(body.draft_facts).toHaveLength(2);

    // Provenance survives the round trip: excerpt and locator, per draft.
    expect(body.draft_facts[0].source_excerpt).toBe(
      'Acme Robotics, Senior Engineer, 2020-01 to 2022-06',
    );
    expect(body.draft_facts[0].source_locator).toBe('line 2');
    expect(body.draft_facts[1].source_locator).toBe('line 4');
  });

  it('confirms nothing automatically', async () => {
    await importWithDrafts([draft()]);

    const profile = await getProfile();
    expect(profile.json().facts).toEqual([]);
    expect(profile.json().revision).toBe(1);
    expect(profile.json().confirmed_revision).toBeNull();

    const facts = await harness.db.selectFrom('profile_facts').selectAll().execute();
    expect(facts).toEqual([]);
  });

  it('marks the import failed when the sweep gives up on an abandoned lease', async () => {
    const created = await createImport({ pasted_text: PASTED_TEXT });
    const taskId = created.json().task_id as string;
    await claimParseProfile();

    // A worker that took the lease and never came back, with no retries left.
    await harness.pool.query(
      `UPDATE tasks
          SET lease_expires_at = now() - interval '1 second', attempt = max_attempts
        WHERE id = $1`,
      [taskId],
    );

    const swept = await reclaimExpiredLeases(harness.db);
    expect(swept.failed).toContain(taskId);

    const body = (await readImport(taskId)).json();
    expect(body.status).toBe('failed');
    expect(body.error?.code).toBe('TIMEOUT');
  });

  it('carries the worker warnings through to the review view', async () => {
    const { importId } = await importWithDrafts(
      [draft()],
      [{ code: 'DATE_AMBIGUOUS', message: 'Two dates could be read as the start month.' }],
    );

    const body = (await readImport(importId)).json();
    expect(body.warnings).toContainEqual({
      code: 'DATE_AMBIGUOUS',
      message: 'Two dates could be read as the start month.',
    });
  });

  it('discards a draft whose value does not match its kind, and says so', async () => {
    const { importId } = await importWithDrafts([
      draft(),
      // Declared as an experience, but shaped like a skill.
      draft({
        draft_id: 'bad',
        kind: 'experience',
        value: {
          canonical_name: 'TypeScript',
          aliases: [],
          user_declared_proficiency: null,
          years: null,
        },
      }),
      // A structurally valid experience that is internally inconsistent.
      draft({
        draft_id: 'inconsistent',
        kind: 'experience',
        value: { ...ACME_2020, current: true, end_month: '2022-06' },
      }),
    ]);

    const body = (await readImport(importId)).json();
    expect(body.draft_facts.map((item: DraftFact) => item.draft_id)).toEqual(['d1']);
    const dropped = body.warnings.filter(
      (warning: ImportWarning) => warning.code === 'FIELD_DROPPED_INVALID',
    );
    expect(dropped).toHaveLength(2);

    // The discarded drafts cannot be confirmed either: they are not offered.
    const rejected = await confirmImport(importId, {
      expected_profile_revision: 1,
      accepted_fields: [{ draft_id: 'bad' }],
    });
    expect(rejected.statusCode).toBe(422);
  });

  it('marks the import failed when its task fails terminally', async () => {
    const created = await createImport({ pasted_text: PASTED_TEXT });
    const taskId = created.json().task_id as string;
    const claimed = await claimParseProfile();

    const failed = await harness.app.inject(
      asWorker({
        method: 'POST',
        url: `/internal/v1/tasks/${taskId}/fail`,
        payload: {
          lease_token: claimed.lease_token,
          code: 'ENCRYPTED_DOCUMENT',
          retryable: false,
          redacted_message: 'The document is password protected.',
        },
      }),
    );
    expect(failed.statusCode).toBe(200);

    const body = (await readImport(taskId)).json();
    expect(body.status).toBe('failed');
    expect(body.error).toEqual({
      code: 'ENCRYPTED_DOCUMENT',
      message: 'The document is password protected.',
    });
  });
});

describe('conflicts and confirmation (AT04)', () => {
  it('reports a conflict between a draft and an existing confirmed fact', async () => {
    const existingId = await seedConfirmedExperience();
    const { importId } = await importWithDrafts([draft({ value: ACME_2020_CONFLICTING })]);

    const body = (await readImport(importId)).json();
    expect(body.conflicts).toHaveLength(1);
    expect(body.conflicts[0]).toMatchObject({ draft_id: 'd1', existing_fact_id: existingId });
    expect(body.conflicts[0].reason).toContain('Acme Robotics');
  });

  it('does not report a conflict for a role at a different employer', async () => {
    await seedConfirmedExperience();
    const { importId } = await importWithDrafts([
      draft({ value: { ...ACME_2020, employer: 'Other Corp' } }),
    ]);
    expect((await readImport(importId)).json().conflicts).toEqual([]);
  });

  it('does not report a conflict when the dates do not overlap', async () => {
    await seedConfirmedExperience();
    const { importId } = await importWithDrafts([
      draft({ value: { ...ACME_2020, start_month: '2023-01', end_month: '2024-01' } }),
    ]);
    expect((await readImport(importId)).json().conflicts).toEqual([]);
  });

  /** The headline: confirming a conflict without naming a victim harms nothing. */
  it('leaves the existing confirmed fact untouched without supersedes_fact_id', async () => {
    const existingId = await seedConfirmedExperience();
    const { importId } = await importWithDrafts([draft({ value: ACME_2020_CONFLICTING })]);

    const before = await harness.db
      .selectFrom('profile_facts')
      .selectAll()
      .where('id', '=', existingId)
      .executeTakeFirstOrThrow();

    const profile = await getProfile();
    const response = await confirmImport(importId, {
      expected_profile_revision: profile.json().revision,
      accepted_fields: [{ draft_id: 'd1' }],
    });
    expect(response.statusCode).toBe(200);

    const after = await harness.db
      .selectFrom('profile_facts')
      .selectAll()
      .where('id', '=', existingId)
      .executeTakeFirstOrThrow();

    // Byte-for-byte the same row: same value, still confirmed, same revision.
    expect(after.value).toEqual(before.value);
    expect(after.confirmed).toBe(true);
    expect(after.revision).toBe(before.revision);
    expect(after.supersedes_id).toBeNull();

    // The accepted draft arrived alongside it, not on top of it.
    const facts = response.json().facts;
    expect(facts).toHaveLength(2);
    const added = facts.find((fact: { id: string }) => fact.id !== existingId);
    expect(added.value.title).toBe('Principal Engineer');
    expect(added.confirmed).toBe(true);
    expect(added.supersedes_id).toBeNull();
    expect(added.source_excerpt).toBe('Acme Robotics, Senior Engineer, 2020-01 to 2022-06');
  });

  it('supersedes the named fact and preserves it as history', async () => {
    const existingId = await seedConfirmedExperience();
    const { importId } = await importWithDrafts([draft({ value: ACME_2020_CONFLICTING })]);

    const profile = await getProfile();
    const response = await confirmImport(importId, {
      expected_profile_revision: profile.json().revision,
      accepted_fields: [{ draft_id: 'd1', supersedes_fact_id: existingId }],
    });
    expect(response.statusCode).toBe(200);

    const facts = response.json().facts;
    expect(facts).toHaveLength(2);

    const superseded = facts.find((fact: { id: string }) => fact.id === existingId);
    const replacement = facts.find((fact: { id: string }) => fact.id !== existingId);

    // The old row still exists, with its original value and provenance: it is
    // history, not a deletion.
    expect(superseded).toBeDefined();
    expect(superseded.value.title).toBe('Senior Engineer');
    expect(superseded.confirmed).toBe(false);

    // The new row points back at what it replaced.
    expect(replacement.confirmed).toBe(true);
    expect(replacement.supersedes_id).toBe(existingId);
    expect(replacement.value.title).toBe('Principal Engineer');

    expect(response.json().confirmed_revision).toBe(response.json().revision);
  });

  it('refuses to supersede a fact of a different kind', async () => {
    const existingId = await seedConfirmedExperience();
    const { importId } = await importWithDrafts([
      draft({
        draft_id: 'd1',
        kind: 'skill',
        value: {
          canonical_name: 'C++',
          aliases: [],
          user_declared_proficiency: null,
          years: null,
        },
      }),
    ]);

    const profile = await getProfile();
    const response = await confirmImport(importId, {
      expected_profile_revision: profile.json().revision,
      accepted_fields: [{ draft_id: 'd1', supersedes_fact_id: existingId }],
    });
    expect(response.statusCode).toBe(422);
  });

  it("reports another workspace's fact id as absent rather than superseding it", async () => {
    const other = await createSecondWorkspace(harness);
    const foreign = await harness.app.inject(
      authed(other, {
        method: 'PATCH',
        url: '/api/v1/profile',
        payload: {
          expected_revision: 1,
          changes: [{ op: 'upsert', kind: 'experience', value: ACME_2020, confirmed: true }],
        },
      }),
    );
    const foreignFactId = foreign.json().facts[0].id;

    const { importId } = await importWithDrafts([draft()]);
    const response = await confirmImport(importId, {
      expected_profile_revision: 1,
      accepted_fields: [{ draft_id: 'd1', supersedes_fact_id: foreignFactId }],
    });
    expect(response.statusCode).toBe(404);

    const stillThere = await harness.app.inject(
      authed(other, { method: 'GET', url: '/api/v1/profile' }),
    );
    expect(stillThere.json().facts[0].confirmed).toBe(true);
  });
});

describe('POST /profile/imports/:id/confirm', () => {
  it('promotes only the accepted drafts and discards the rest', async () => {
    const { importId } = await importWithDrafts([
      draft({ draft_id: 'keep' }),
      draft({
        draft_id: 'drop',
        value: { ...ACME_2020, employer: 'Ignored Ltd', title: 'Intern' },
      }),
    ]);

    const response = await confirmImport(importId, {
      expected_profile_revision: 1,
      accepted_fields: [{ draft_id: 'keep' }],
    });
    expect(response.statusCode).toBe(200);

    const facts = response.json().facts;
    expect(facts).toHaveLength(1);
    expect(facts[0].value.employer).toBe('Acme Robotics');
    expect(response.json().revision).toBe(2);
    expect(response.json().confirmed_revision).toBe(2);

    const after = (await readImport(importId)).json();
    expect(after.status).toBe('confirmed');
    expect(after.draft_facts.map((item: DraftFact) => item.draft_id)).toEqual(['keep']);
  });

  it('applies an edited_value in place of the extracted one', async () => {
    const { importId } = await importWithDrafts([draft()]);

    const response = await confirmImport(importId, {
      expected_profile_revision: 1,
      accepted_fields: [
        { draft_id: 'd1', edited_value: { ...ACME_2020, title: 'Robotics Engineer' } },
      ],
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().facts[0].value.title).toBe('Robotics Engineer');
  });

  it('rejects an edited_value that is invalid for the draft kind', async () => {
    const { importId } = await importWithDrafts([draft()]);

    const wrongShape = await confirmImport(importId, {
      expected_profile_revision: 1,
      accepted_fields: [
        {
          draft_id: 'd1',
          edited_value: {
            canonical_name: 'TypeScript',
            aliases: [],
            user_declared_proficiency: null,
            years: null,
          },
        },
      ],
    });
    expect(wrongShape.statusCode).toBe(422);

    const inconsistent = await confirmImport(importId, {
      expected_profile_revision: 1,
      accepted_fields: [
        { draft_id: 'd1', edited_value: { ...ACME_2020, current: true, end_month: '2022-06' } },
      ],
    });
    expect(inconsistent.statusCode).toBe(422);
    expect(inconsistent.json().error.code).toBe('UNPROCESSABLE');

    // Nothing was promoted and the import is still reviewable.
    expect((await getProfile()).json().facts).toEqual([]);
    expect((await readImport(importId)).json().status).toBe('ready_for_review');
  });

  it('rejects a stale expected_profile_revision with 409 STALE_REVISION', async () => {
    const { importId } = await importWithDrafts([draft()]);

    // Someone else edits the profile between review and confirmation.
    await patchProfile({ expected_revision: 1, changes: [] });

    const response = await confirmImport(importId, {
      expected_profile_revision: 1,
      accepted_fields: [{ draft_id: 'd1' }],
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('STALE_REVISION');
    expect((await getProfile()).json().facts).toEqual([]);
  });

  it('rejects an unknown draft_id', async () => {
    const { importId } = await importWithDrafts([draft()]);
    const response = await confirmImport(importId, {
      expected_profile_revision: 1,
      accepted_fields: [{ draft_id: 'never-extracted' }],
    });
    expect(response.statusCode).toBe(422);
  });

  it('cannot be confirmed twice', async () => {
    const { importId } = await importWithDrafts([draft()]);
    expect(
      (await confirmImport(importId, { expected_profile_revision: 1, accepted_fields: [] }))
        .statusCode,
    ).toBe(200);

    const again = await confirmImport(importId, {
      expected_profile_revision: 1,
      accepted_fields: [],
    });
    expect(again.statusCode).toBe(409);
  });

  it('cannot confirm an import that is still queued', async () => {
    const created = await createImport({ pasted_text: PASTED_TEXT });
    const response = await confirmImport(created.json().task_id, {
      expected_profile_revision: 1,
      accepted_fields: [],
    });
    expect(response.statusCode).toBe(409);
  });

  it('mirrors a confirmed contact draft into the profile contact block', async () => {
    const { importId } = await importWithDrafts([
      draft({
        draft_id: 'c1',
        kind: 'contact',
        value: { full_name: 'Ada Lovelace', email: 'ada@example.invalid' },
      }),
    ]);

    const response = await confirmImport(importId, {
      expected_profile_revision: 1,
      accepted_fields: [{ draft_id: 'c1' }],
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().contact).toEqual({
      full_name: 'Ada Lovelace',
      email: 'ada@example.invalid',
    });
  });
});

describe('workspace isolation', () => {
  it("reports another workspace's import as absent", async () => {
    const { importId, taskId } = await importWithDrafts([draft()]);
    const other = await createSecondWorkspace(harness);

    expect((await readImport(importId, other)).statusCode).toBe(404);
    expect((await readImport(taskId, other)).statusCode).toBe(404);

    const confirm = await confirmImport(
      importId,
      { expected_profile_revision: 1, accepted_fields: [{ draft_id: 'd1' }] },
      other,
    );
    expect(confirm.statusCode).toBe(404);

    // And the owner's import is untouched.
    expect((await readImport(importId)).json().status).toBe('ready_for_review');
  });

  it('is indistinguishable from an id that never existed', async () => {
    const other = await createSecondWorkspace(harness);
    const { importId } = await importWithDrafts([draft()]);

    const foreign = await readImport(importId, other);
    const absent = await readImport(randomUUID(), other);
    expect(foreign.statusCode).toBe(absent.statusCode);
    expect(foreign.json().error.message).toBe(absent.json().error.message);
  });
});

describe('GET /me', () => {
  it('reports parse_profile now that the route that creates it is registered', async () => {
    const response = await harness.app.inject(
      authed(session, { method: 'GET', url: '/api/v1/me' }),
    );
    expect(response.statusCode).toBe(200);
    expect(response.json().capabilities.implemented_task_types).toContain('parse_profile');
    expect(response.json().capabilities.profile_import).toBe(true);
  });
});

/**
 * AT21 — "Cloud provider unavailable → No surprise provider switch; local/draft
 * work preserved."
 *
 * The provider-switch half is the worker's (`build_provider` returns exactly
 * one provider and nothing looks for a second; asserted in
 * `services/worker/tests/test_budget_and_availability.py`). What the API owes is
 * the second half, and it is the one a user would actually notice: an import
 * that could not reach a model must cost them nothing they already had.
 */
describe('AT21: an unreachable provider preserves the work already done', () => {
  async function failParse(code: string, message: string) {
    const created = await createImport({ pasted_text: PASTED_TEXT });
    expect(created.statusCode).toBe(202);
    const taskId = created.json().task_id as string;
    const claimed = await claimParseProfile();

    const failed = await harness.app.inject(
      asWorker({
        method: 'POST',
        url: `/internal/v1/tasks/${taskId}/fail`,
        payload: {
          lease_token: claimed.lease_token,
          code,
          retryable: false,
          redacted_message: message,
        },
      }),
    );
    expect(failed.statusCode).toBe(200);
    return taskId;
  }

  it('keeps every confirmed fact the user had already approved', async () => {
    const factId = await seedConfirmedExperience();
    await failParse('PROVIDER_UNAVAILABLE', 'The configured provider did not answer.');

    const profile = await getProfile();
    expect(profile.statusCode).toBe(200);
    const facts = profile.json().facts as Array<{ id: string; confirmed: boolean }>;
    expect(facts.map((fact) => fact.id)).toContain(factId);
    expect(facts.find((fact) => fact.id === factId)!.confirmed).toBe(true);
  });

  it('leaves an earlier import and its drafts untouched', async () => {
    const { importId } = await importWithDrafts([draft()]);
    const before = await readImport(importId);
    expect(before.json().status).toBe('ready_for_review');

    await failParse('PROVIDER_UNAVAILABLE', 'The configured provider did not answer.');

    // A second import failing is not a reason to lose the first one's drafts,
    // which the user may still be part-way through reviewing.
    const after = await readImport(importId);
    expect(after.json().status).toBe('ready_for_review');
    expect(after.json().draft_facts).toEqual(before.json().draft_facts);
  });

  it('says what happened instead of reporting an empty extraction', async () => {
    const taskId = await failParse(
      'PROVIDER_UNAVAILABLE',
      'The configured provider did not answer.',
    );
    const view = await readImport(taskId);
    expect(view.statusCode).toBe(200);

    // "Failed, because the model could not be reached" and "your CV contains
    // nothing" are very different claims. Only the first one is true.
    expect(view.json().status).toBe('failed');
    expect(view.json().error.code).toBe('PROVIDER_UNAVAILABLE');
    expect(view.json().error.message).toContain('did not answer');
    expect(view.json().draft_facts).toEqual([]);
  });

  it('is the same for a budget refusal (AT22)', async () => {
    const factId = await seedConfirmedExperience();
    const taskId = await failParse(
      'BUDGET_EXHAUSTED',
      "The day's model requests are spent. Reviewing and exporting still work.",
    );

    const view = await readImport(taskId);
    expect(view.json().status).toBe('failed');
    expect(view.json().error.code).toBe('BUDGET_EXHAUSTED');
    expect(view.json().error.message).toContain('exporting still work');

    const facts = profileFactIds(await getProfile());
    expect(facts).toContain(factId);
  });

  function profileFactIds(response: { json: () => { facts: Array<{ id: string }> } }): string[] {
    return response.json().facts.map((fact) => fact.id);
  }
});
