/**
 * POST /profile/imports, GET /profile/imports/:id, POST /profile/imports/:id/confirm.
 *
 * The import pipeline is a *proposal* pipeline. Creating an import queues a
 * `parse_profile` task in the same transaction as the domain row; the worker's
 * result becomes drafts; and only an explicit confirmation — naming each
 * accepted field — writes a confirmed fact.
 *
 * AT04 is the rule the confirmation step exists to protect: "Existing verified
 * facts preserved until user resolves". An accepted draft that collides with a
 * confirmed fact is added *alongside* it unless the user set
 * `supersedes_fact_id`, and even then the superseded row is kept (marked
 * unconfirmed) so the history survives.
 *
 * ## Deliberate deviation: `GET /profile/imports/:id` also accepts the task id
 *
 * `POST /profile/imports` is declared in the contract as returning
 * `AcceptedResponse` — `{task_id, status}` — and the contract declares no
 * route that lists imports. A client following the contract literally would
 * therefore hold a task id and have no way to reach the import it created.
 * Rather than inventing an undeclared response field or an undeclared list
 * route, this handler resolves the path parameter as an import id *or* as the
 * id of the task that produced an import. Both lookups go through the
 * workspace scope, so the fallback reaches nothing a client could not already
 * reach, and a foreign id is still an ordinary 404.
 */
import {
  PARSE_LIMITS,
  type AcceptedResponse,
  type AcceptedField,
  type ConfirmImportRequest,
  type CreateProfileImportRequest,
  type DraftFact,
  type ContactValue,
  type Profile,
  type ProfileImportFormatHint,
  type ParseProfileInput,
} from '@job-getter/contracts';
import { conflict, notFound, unprocessable } from '../errors.js';
import { recordAuditEvent } from '../auth/scope.js';
import { enqueueTask } from '../tasks/enqueue.js';
import { readIdempotencyKey, sendOutcome, withIdempotency } from '../tasks/idempotency.js';
import { assertFactValue } from '../profile/facts.js';
import {
  computeConflicts,
  readExtractedDraft,
  toImportView,
  type ExtractedDraft,
  type ProfileImportRow,
} from '../profile/imports.js';
import {
  assertProfileRevision,
  buildProfileView,
  ensureProfile,
  loadFacts,
  lockProfile,
  syncConfirmedContact,
  type ProfileFactRow,
} from '../profile/service.js';
import type { WorkspaceScope } from '../auth/scope.js';
import { requireScope, requireSession, type RouteHandler } from './context.js';

/** Purposes a document may have to be a profile import source. */
const IMPORTABLE_PURPOSES: readonly string[] = ['cv_original', 'profile_text'];

const FORMAT_BY_MIME: Readonly<Record<string, ProfileImportFormatHint>> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/plain': 'plain_text',
};

// ---------------------------------------------------------------------------
// POST /profile/imports
// ---------------------------------------------------------------------------

export const createProfileImport: RouteHandler = async (context, request, reply) => {
  const principal = requireSession(request);
  const scope = requireScope(context, request);
  const body = request.body as CreateProfileImportRequest;
  const idempotencyKey = readIdempotencyKey(request);

  const hasFile = typeof body.file_id === 'string';
  const hasText = typeof body.pasted_text === 'string' && body.pasted_text.trim().length > 0;

  // Exactly one source. Accepting both would leave the worker to choose, and
  // whichever it chose would be a silent decision about whose text became the
  // user's employment history.
  if (hasFile && hasText) {
    throw unprocessable('Provide either file_id or pasted_text, not both.', {
      file_id: 'Mutually exclusive with pasted_text.',
      pasted_text: 'Mutually exclusive with file_id.',
    });
  }
  if (!hasFile && !hasText) {
    throw unprocessable('Provide either file_id or pasted_text.', {
      file_id: 'One of file_id or pasted_text is required.',
    });
  }

  const profile = await ensureProfile(scope);

  let formatHint: ProfileImportFormatHint = body.format_hint ?? 'auto';
  let fileId: string | null = null;

  if (hasFile) {
    const file = await scope
      .selectFrom('files')
      .select(['id', 'mime', 'state', 'purpose'])
      .where('id', '=', body.file_id as string)
      .executeTakeFirst();

    // Absent, or another workspace's: identical 404 either way.
    if (!file) throw notFound('No such file.');
    if (file.state !== 'ready') {
      throw unprocessable('That upload is not ready to be imported.', {
        file_id: `File state is "${file.state}".`,
      });
    }
    if (!IMPORTABLE_PURPOSES.includes(file.purpose)) {
      throw unprocessable(
        `A profile import needs a file uploaded with purpose ${IMPORTABLE_PURPOSES.join(' or ')}.`,
        { file_id: `Unsupported purpose "${file.purpose}".` },
      );
    }
    fileId = file.id;
    if (formatHint === 'auto') formatHint = FORMAT_BY_MIME[file.mime] ?? 'auto';
  } else if (formatHint === 'auto') {
    formatHint = 'plain_text';
  }

  const outcome = await withIdempotency<AcceptedResponse>(
    context.db,
    scope,
    request,
    'POST /profile/imports',
    async () => {
      try {
        const task = await context.db.transaction().execute(async (trx) => {
          const scoped = scope.withExecutor(trx);

          // The domain row first: its id is part of the task input, so the
          // worker can name the import it is working on without the API
          // having to correlate by task id later.
          const created = await scoped
            .insertInto('profile_imports', {
              file_id: fileId,
              text_file_id: null,
              task_id: null,
              status: 'queued',
              format_hint: formatHint,
              extracted_draft: null,
              warnings: JSON.stringify([]),
            })
            .returning(['id'])
            .executeTakeFirstOrThrow();

          const payload: ParseProfileInput = {
            profile_import_id: created.id,
            profile_revision: profile.revision,
            format_hint: formatHint,
            locale: profile.locale,
            // Pasted text travels in the task input rather than becoming a
            // file: the contract models it as `inline_text`, and storing the
            // same bytes twice would mean two retention lifecycles for one
            // piece of user data.
            inline_text: hasFile ? null : (body.pasted_text as string),
            source_file_id: fileId,
            limits: {
              max_pdf_pages: PARSE_LIMITS.maxPdfPages,
              max_extracted_chars: PARSE_LIMITS.maxExtractedChars,
            },
          };

          // Domain mutation and task row in one transaction
          // (02_ARCHITECTURE.md step 2). `enqueueTask` validates the payload
          // against the contract's closed `ParseProfileInput` schema, and
          // `inputFileIds` is the *only* declaration that lets the worker
          // download the document — nothing else in the workspace is
          // reachable from this task.
          const enqueued = await enqueueTask(trx, {
            workspaceId: scope.workspaceId,
            type: 'parse_profile',
            payload,
            idempotencyKey,
            inputFileIds: fileId === null ? [] : [fileId],
          });

          await scoped
            .updateTable('profile_imports')
            .set({ task_id: enqueued.id, updated_at: new Date() })
            .where('id', '=', created.id)
            .execute();

          await recordAuditEvent(scoped, {
            action: 'profile_import.queued',
            actorId: principal.userId,
            objectId: created.id,
            objectType: 'profile_import',
            // No document text, no filename: size class and shape only.
            metadata: {
              format_hint: formatHint,
              source: hasFile ? 'file' : 'pasted_text',
              pasted_chars: hasFile ? 0 : (body.pasted_text as string).length,
            },
          });

          return enqueued;
        });

        return {
          status: 202,
          body: { task_id: task.id, status: 'queued' } satisfies AcceptedResponse,
        };
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          (error as { code?: string }).code === '23505'
        ) {
          throw conflict('An import with this Idempotency-Key already exists for this workspace.');
        }
        throw error;
      }
    },
  );

  return sendOutcome(reply, outcome);
};

// ---------------------------------------------------------------------------
// GET /profile/imports/:id
// ---------------------------------------------------------------------------

async function findImport(scope: WorkspaceScope, id: string): Promise<ProfileImportRow> {
  const byId = await scope
    .selectFrom('profile_imports')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (byId) return byId as ProfileImportRow;

  const byTask = await scope
    .selectFrom('profile_imports')
    .selectAll()
    .where('task_id', '=', id)
    .executeTakeFirst();
  if (byTask) return byTask as ProfileImportRow;

  throw notFound('No such profile import.');
}

async function confirmedFacts(scope: WorkspaceScope, profileId: string): Promise<ProfileFactRow[]> {
  const facts = await loadFacts(scope, profileId);
  return facts.filter((fact) => fact.confirmed);
}

export const getProfileImport: RouteHandler = async (context, request, reply) => {
  const scope = requireScope(context, request);
  const { id } = request.params as { id: string };

  const row = await findImport(scope, id);
  const profile = await ensureProfile(scope);
  const draft = readExtractedDraft(row);

  // Conflicts are computed on read rather than stored: the confirmed facts can
  // change between extraction and review, and a stale conflict list would hide
  // a collision the user needs to resolve.
  const conflicts =
    draft === null
      ? []
      : computeConflicts(draft.draft_facts, await confirmedFacts(scope, profile.id));

  return reply.status(200).send(toImportView(row, conflicts));
};

// ---------------------------------------------------------------------------
// POST /profile/imports/:id/confirm
// ---------------------------------------------------------------------------

interface PromotedField {
  readonly draft: DraftFact;
  readonly value: unknown;
  readonly supersedesId: string | null;
}

export const confirmProfileImport: RouteHandler = async (context, request, reply) => {
  const principal = requireSession(request);
  const scope = requireScope(context, request);
  const { id } = request.params as { id: string };
  const body = request.body as ConfirmImportRequest;

  const importRow = await findImport(scope, id);
  if (importRow.status === 'confirmed') {
    throw conflict('This import has already been confirmed.');
  }
  if (importRow.status !== 'ready_for_review') {
    throw conflict(`This import is "${importRow.status}" and has nothing to confirm yet.`);
  }

  const stored = readExtractedDraft(importRow);
  if (stored === null) {
    throw conflict('This import has no extracted drafts to confirm.');
  }

  await ensureProfile(scope);

  const updatedProfile = await context.db.transaction().execute(async (trx) => {
    const scoped = scope.withExecutor(trx);
    const profile = await lockProfile(scoped);
    assertProfileRevision(profile, body.expected_profile_revision);

    const draftsById = new Map(stored.draft_facts.map((draft) => [draft.draft_id, draft]));
    const existingFacts = await loadFacts(scoped, profile.id);
    const factsById = new Map(existingFacts.map((fact) => [fact.id, fact]));

    // --- validate the whole batch before writing anything ------------------
    const promoted: PromotedField[] = [];
    const seen = new Set<string>();

    body.accepted_fields.forEach((field: AcceptedField, index) => {
      if (seen.has(field.draft_id)) {
        throw unprocessable('The same draft was accepted twice.', {
          [`accepted_fields.${index}.draft_id`]: 'Duplicate draft_id.',
        });
      }
      seen.add(field.draft_id);

      const draft = draftsById.get(field.draft_id);
      if (draft === undefined) {
        throw unprocessable('That draft is not part of this import.', {
          [`accepted_fields.${index}.draft_id`]: 'Unknown draft_id.',
        });
      }

      // A user edit is still untrusted input: it is validated against the
      // draft's kind exactly like the model's own value was.
      const value = 'edited_value' in field ? field.edited_value : draft.value;
      assertFactValue(draft.kind, value, `accepted_fields.${index}.edited_value`);

      let supersedesId: string | null = null;
      if (field.supersedes_fact_id != null) {
        const target = factsById.get(field.supersedes_fact_id);
        // Absent, or another workspace's fact: the same 404 either way.
        if (target === undefined) throw notFound('No such profile fact.');
        if (target.kind !== draft.kind) {
          throw unprocessable('A fact can only supersede another fact of the same kind.', {
            [`accepted_fields.${index}.supersedes_fact_id`]: 'Kind mismatch.',
          });
        }
        supersedesId = target.id;
      }

      promoted.push({ draft, value, supersedesId });
    });

    if (promoted.length === 0) {
      // Nothing was accepted: the import is closed and every draft discarded,
      // but the profile did not change, so its revision must not move.
      await closeImport(scoped, importRow.id, stored, []);
      await recordAuditEvent(scoped, {
        action: 'profile_import.confirmed',
        actorId: principal.userId,
        objectId: importRow.id,
        objectType: 'profile_import',
        metadata: { promoted: 0, discarded: stored.draft_facts.length, superseded: 0 },
      });
      return profile;
    }

    const nextRevision = profile.revision + 1;
    let latestContact: ContactValue | null = null;
    let supersededCount = 0;

    for (const entry of promoted) {
      await scoped
        .insertInto('profile_facts', {
          profile_id: profile.id,
          kind: entry.draft.kind,
          value: JSON.stringify(entry.value),
          // Provenance: which document this came from, and the excerpt that
          // supports it (06_AI_PROFILE_AND_CV.md).
          source_file_id: importRow.file_id,
          source_excerpt: entry.draft.source_excerpt,
          confirmed: true,
          revision: nextRevision,
          supersedes_id: entry.supersedesId,
        })
        .execute();

      if (entry.supersedesId !== null) {
        // AT04: the superseded row is *kept*. Only its `confirmed` flag is
        // cleared, so it stops being usable evidence while remaining in the
        // history the new fact points back to through `supersedes_id`.
        await scoped
          .updateTable('profile_facts')
          .set({ confirmed: false, updated_at: new Date() })
          .where('id', '=', entry.supersedesId)
          .execute();
        supersededCount += 1;
      }

      if (entry.draft.kind === 'contact') latestContact = entry.value as ContactValue;
    }

    await scoped
      .updateTable('profiles')
      .set({
        revision: nextRevision,
        confirmed_revision: nextRevision,
        updated_at: new Date(),
      })
      .where('id', '=', profile.id)
      .execute();

    if (latestContact !== null) {
      await syncConfirmedContact(trx, scope, profile.id, latestContact);
    }

    await closeImport(
      scoped,
      importRow.id,
      stored,
      promoted.map((entry) => entry.draft),
    );

    await recordAuditEvent(scoped, {
      action: 'profile_import.confirmed',
      actorId: principal.userId,
      objectId: importRow.id,
      objectType: 'profile_import',
      metadata: {
        revision: nextRevision,
        promoted: promoted.length,
        discarded: stored.draft_facts.length - promoted.length,
        superseded: supersededCount,
      },
    });

    return lockProfile(scoped);
  });

  const view: Profile = await buildProfileView(scope, updatedProfile);
  return reply.status(200).send(view);
};

/**
 * Closes an import.
 *
 * Only the accepted drafts are retained, because they are the provenance of
 * the facts that now exist. Unaccepted drafts are discarded: keeping a
 * rejected proposal around invites it being re-applied later by a UI that
 * forgot the user had already said no.
 */
async function closeImport(
  scope: WorkspaceScope,
  importId: string,
  stored: ExtractedDraft,
  keep: readonly DraftFact[],
): Promise<void> {
  const remaining: ExtractedDraft = {
    draft_facts: [...keep],
    extracted_chars: stored.extracted_chars,
    provider: stored.provider,
    dropped_invalid: stored.dropped_invalid,
  };
  await scope
    .updateTable('profile_imports')
    .set({
      status: 'confirmed',
      extracted_draft: JSON.stringify(remaining),
      updated_at: new Date(),
    })
    .where('id', '=', importId)
    .execute();
}
