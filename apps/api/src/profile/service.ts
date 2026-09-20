/**
 * Profile persistence: read, optimistic-revision patch, and the shared helpers
 * the import-confirmation path reuses.
 *
 * Concurrency follows 03_DATA_MODEL.md ("Use optimistic revisions for profile,
 * preferences, packet and application mutations"). Every mutation:
 *
 *  1. locks the `profiles` row `FOR UPDATE` inside one transaction,
 *  2. compares `expected_revision` and rejects a mismatch with
 *     `409 STALE_REVISION`,
 *  3. validates *all* changes before writing any of them, so a rejected patch
 *     leaves no partial state,
 *  4. bumps `revision` exactly once, and sets `confirmed_revision` only when
 *     the set of confirmed facts actually changed.
 *
 * `confirmed_revision` is what downstream milestones snapshot: a CV or an
 * application packet may only be built from confirmed facts, so it has to be
 * possible to ask "which revision last changed anything I am allowed to use?"
 * without diffing the fact table.
 */
import type { Selectable } from 'kysely';
import {
  type ContactValue,
  type FactChange,
  type FactKind,
  type Locale,
  type Profile,
  type ProfileFact,
  type ProfilePatchRequest,
} from '@job-getter/contracts';
import type { DbTransaction } from '../db/pool.js';
import type { ProfileFactsTable, ProfilesTable } from '../db/types.js';
import { notFound, staleRevision } from '../errors.js';
import type { WorkspaceScope } from '../auth/scope.js';
import { assertFactValue } from './facts.js';

export type ProfileRow = Selectable<ProfilesTable>;
export type ProfileFactRow = Selectable<ProfileFactsTable>;

/**
 * Returns the workspace's profile row, creating the empty one if it is absent.
 *
 * Owner setup already inserts it, but a workspace provisioned another way (a
 * hosted tenant created by an operator script, or the second workspace the
 * isolation tests build directly) must not 404 on its own profile. The insert
 * is `ON CONFLICT DO NOTHING`, so two concurrent first reads converge on one
 * row rather than racing to a unique violation.
 */
export async function ensureProfile(
  scope: WorkspaceScope,
  locale: Locale = 'en',
): Promise<ProfileRow> {
  const existing = await scope.selectFrom('profiles').selectAll().executeTakeFirst();
  if (existing) return existing as ProfileRow;

  await scope
    .insertInto('profiles', { revision: 1, confirmed_revision: null, contact: null, locale })
    .onConflict((builder) => builder.column('workspace_id').doNothing())
    .execute();

  const created = await scope.selectFrom('profiles').selectAll().executeTakeFirst();
  if (!created) throw notFound('No profile exists for this workspace.');
  return created as ProfileRow;
}

/** Locks the profile row for the duration of a mutation. */
export async function lockProfile(scope: WorkspaceScope): Promise<ProfileRow> {
  const row = await scope.selectFrom('profiles').selectAll().forUpdate().executeTakeFirst();
  if (!row) throw notFound('No profile exists for this workspace.');
  return row as ProfileRow;
}

export function toProfileFact(row: ProfileFactRow): ProfileFact {
  return {
    id: row.id,
    kind: row.kind as FactKind,
    value: row.value,
    source_file_id: row.source_file_id,
    source_excerpt: row.source_excerpt,
    confirmed: row.confirmed,
    revision: row.revision,
    supersedes_id: row.supersedes_id,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

export async function loadFacts(
  scope: WorkspaceScope,
  profileId: string,
): Promise<ProfileFactRow[]> {
  const rows = await scope
    .selectFrom('profile_facts')
    .selectAll()
    .where('profile_id', '=', profileId)
    .orderBy('created_at', 'asc')
    .orderBy('id', 'asc')
    .execute();
  return rows as ProfileFactRow[];
}

export async function buildProfileView(scope: WorkspaceScope, row: ProfileRow): Promise<Profile> {
  const facts = await loadFacts(scope, row.id);
  return {
    id: row.id,
    revision: row.revision,
    confirmed_revision: row.confirmed_revision,
    contact: (row.contact as ContactValue | null) ?? null,
    locale: row.locale,
    facts: facts.map(toProfileFact),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

/** Rejects a mutation whose caller read an older revision (AT20). */
export function assertProfileRevision(row: ProfileRow, expected: number): void {
  if (row.revision !== expected) {
    throw staleRevision(
      `The profile is at revision ${row.revision}, not ${expected}. Reload and reapply your changes.`,
    );
  }
}

export interface ApplyPatchResult {
  readonly revision: number;
  readonly confirmedChanged: boolean;
}

/**
 * Applies a validated `PATCH /profile` body inside an open transaction.
 *
 * The caller has already locked the profile row and checked the revision.
 * Validation of every change happens before the first write: a single invalid
 * change rejects the whole patch, which is what "expected_revision" semantics
 * imply — the client reapplies the batch, not a mystery subset of it.
 */
export async function applyProfilePatch(
  trx: DbTransaction,
  scope: WorkspaceScope,
  profile: ProfileRow,
  body: ProfilePatchRequest,
): Promise<ApplyPatchResult> {
  const scoped = scope.withExecutor(trx);
  const nextRevision = profile.revision + 1;

  // --- validate everything first -------------------------------------------
  const existingById = new Map<string, ProfileFactRow>();
  const referenced = body.changes
    .map((change) => (change.op === 'upsert' ? change.id : change.id))
    .filter((id): id is string => typeof id === 'string');

  if (referenced.length > 0) {
    const rows = await scoped
      .selectFrom('profile_facts')
      .selectAll()
      .where('profile_id', '=', profile.id)
      .where('id', 'in', referenced)
      .execute();
    for (const row of rows as ProfileFactRow[]) existingById.set(row.id, row);
  }

  body.changes.forEach((change: FactChange, index) => {
    if (change.op === 'upsert') {
      if (change.id !== undefined && !existingById.has(change.id)) {
        // Absent or another workspace's id: identical rejection either way.
        throw notFound('No such profile fact.');
      }
      assertFactValue(change.kind, change.value, `changes.${index}`);
      return;
    }
    if (!existingById.has(change.id)) throw notFound('No such profile fact.');
  });

  // --- apply ---------------------------------------------------------------
  let confirmedChanged = false;

  if (body.contact !== undefined) {
    // The contact block is typed by the user through this route, so it is
    // confirmed content by definition.
    confirmedChanged = true;
  }

  for (const change of body.changes) {
    if (change.op === 'delete') {
      const existing = existingById.get(change.id);
      if (existing?.confirmed) confirmedChanged = true;
      await scoped.deleteFrom('profile_facts').where('id', '=', change.id).execute();
      continue;
    }

    if (change.id === undefined) {
      if (change.confirmed) confirmedChanged = true;
      await scoped
        .insertInto('profile_facts', {
          profile_id: profile.id,
          kind: change.kind,
          value: JSON.stringify(change.value),
          source_file_id: change.source_file_id ?? null,
          source_excerpt: change.source_excerpt ?? null,
          confirmed: change.confirmed,
          revision: nextRevision,
          supersedes_id: null,
        })
        .execute();
      continue;
    }

    const existing = existingById.get(change.id) as ProfileFactRow;
    if (change.confirmed || existing.confirmed) confirmedChanged = true;
    await scoped
      .updateTable('profile_facts')
      .set({
        kind: change.kind,
        value: JSON.stringify(change.value),
        source_file_id:
          change.source_file_id === undefined ? existing.source_file_id : change.source_file_id,
        source_excerpt:
          change.source_excerpt === undefined ? existing.source_excerpt : change.source_excerpt,
        confirmed: change.confirmed,
        revision: nextRevision,
        updated_at: new Date(),
      })
      .where('id', '=', change.id)
      .execute();
  }

  await scoped
    .updateTable('profiles')
    .set({
      revision: nextRevision,
      confirmed_revision: confirmedChanged ? nextRevision : profile.confirmed_revision,
      contact: body.contact === undefined ? undefined : JSON.stringify(body.contact),
      locale: body.locale === undefined ? undefined : body.locale,
      updated_at: new Date(),
    })
    .where('id', '=', profile.id)
    .execute();

  return { revision: nextRevision, confirmedChanged };
}

/**
 * Mirrors a confirmed `contact` fact into `profiles.contact`.
 *
 * 03_DATA_MODEL.md: "Store contact in profiles and reference its revision in
 * packet snapshots." The fact row keeps the provenance (which document, which
 * excerpt); the profile column is the single current value that a CV or an
 * application packet reads, so the two must not drift.
 */
export async function syncConfirmedContact(
  trx: DbTransaction,
  scope: WorkspaceScope,
  profileId: string,
  contact: ContactValue,
): Promise<void> {
  await scope
    .withExecutor(trx)
    .updateTable('profiles')
    .set({ contact: JSON.stringify(contact), updated_at: new Date() })
    .where('id', '=', profileId)
    .execute();
}
