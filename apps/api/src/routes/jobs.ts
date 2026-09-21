/**
 * POST /jobs/import, GET /jobs, GET /jobs/:id, PATCH /jobs/:id.
 *
 * What the list can and cannot filter on in M2:
 *
 *  * `query` is a plain case-insensitive substring match on title and
 *    company. Full-text search arrives with the index 03_DATA_MODEL.md
 *    reserves for it ("Add full-text index on jobs title/description when
 *    search is introduced").
 *  * `min_score` and `eligible` filter on the stored match (M3). A job with
 *    no match satisfies neither: "not checked" is not a score of 0 and not an
 *    eligibility of unknown, so an unchecked job is absent from a filtered
 *    page rather than being guessed into it. A job whose score is null
 *    (nothing was evaluable) likewise fails `min_score`, including
 *    `min_score=0`.
 *  * Excluded employers are hidden unless `include_excluded` is set
 *    (01_PRODUCT_REQUIREMENTS.md: "Excluded employers ... hide jobs by
 *    default; users can inspect exclusions"). The exclusion is evaluated
 *    against the *current* preferences on every read, so editing the list
 *    takes effect immediately and nothing is rewritten on the job rows.
 *
 * `GET /jobs/:id` additionally accepts the id of a `fetch_job` task and
 * answers 404 until the import it created has produced a job — the same
 * deviation, for the same reason, as `GET /profile/imports/:id`
 * (see `src/discovery/imports.ts`).
 */
import {
  URL_FETCH_POLICY,
  type AcceptedResponse,
  type FetchJobInput,
  type JobImportRequest,
  type JobView,
  type JobsListQuery,
  type MatchJobInput,
  type PatchJobRequest,
  type Preferences,
} from '@job-getter/contracts';
import { conflict, notFound, staleRevision, unprocessable } from '../errors.js';
import { recordAuditEvent, type WorkspaceScope } from '../auth/scope.js';
import type { JobRow } from '../db/types.js';
import { enqueueTask } from '../tasks/enqueue.js';
import { readIdempotencyKey, sendOutcome, withIdempotency } from '../tasks/idempotency.js';
import {
  NORMALIZED_COMPANY_SQL,
  buildJobDetailView,
  buildJobViews,
  excludedCompanies,
} from '../discovery/jobs.js';
import { type JobImportInput } from '../discovery/imports.js';
import { workspacePreferences } from '../discovery/scans.js';
import {
  buildMatchInput,
  readMatchContext,
  requireJob as requireJobRow,
} from '../matching/matches.js';
import { requireScope, requireSession, type RouteHandler } from './context.js';
import { decodeCursor, encodeCursor } from './tasks.js';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

// ---------------------------------------------------------------------------
// POST /jobs/import
// ---------------------------------------------------------------------------

/** The route-level half of the arbitrary-URL policy; the worker enforces the rest. */
function validateImportUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw unprocessable('url is not a valid URL.', { url: 'Not a URL.' });
  }
  if (URL_FETCH_POLICY.httpsOnly && url.protocol !== 'https:') {
    throw unprocessable('Only https URLs can be fetched.', { url: 'Must use https.' });
  }
  if (url.username !== '' || url.password !== '') {
    throw unprocessable('The URL may not carry credentials.', {
      url: 'Credentials are not allowed.',
    });
  }
  return url.toString();
}

export const importJob: RouteHandler = async (context, request, reply) => {
  const principal = requireSession(request);
  const scope = requireScope(context, request);
  const body = request.body as JobImportRequest;
  const idempotencyKey = readIdempotencyKey(request);

  const hasUrl = typeof body.url === 'string' && body.url.trim().length > 0;
  const hasText = typeof body.description_text === 'string' && body.description_text.trim() !== '';

  if (hasUrl && hasText) {
    throw unprocessable('Provide either url or description_text, not both.', {
      url: 'Mutually exclusive with description_text.',
      description_text: 'Mutually exclusive with url.',
    });
  }
  if (!hasUrl && !hasText) {
    throw unprocessable('Provide either url or description_text.', {
      url: 'One of url or description_text is required.',
    });
  }

  const url = hasUrl ? validateImportUrl(body.url as string) : null;
  const applyUrlHint =
    typeof body.apply_url === 'string' && body.apply_url.trim() !== ''
      ? validateImportUrl(body.apply_url)
      : null;

  const outcome = await withIdempotency<AcceptedResponse>(
    context.db,
    scope,
    request,
    'POST /jobs/import',
    async () => {
      try {
        const task = await context.db.transaction().execute(async (trx) => {
          const scoped = scope.withExecutor(trx);

          const input: JobImportInput = {
            url,
            description_chars: hasText ? (body.description_text as string).length : 0,
            company: body.company ?? null,
            title: body.title ?? null,
            apply_url: applyUrlHint,
          };

          const created = await scoped
            .insertInto('job_imports', {
              task_id: null,
              status: 'queued',
              input: JSON.stringify(input),
              job_id: null,
              candidates: JSON.stringify([]),
              warnings: JSON.stringify([]),
            })
            .returning(['id'])
            .executeTakeFirstOrThrow();

          const payload: FetchJobInput = {
            job_import_id: created.id,
            url,
            // Pasted text travels in the task payload only (see M1 imports).
            description_text: hasText ? (body.description_text as string) : null,
            company_hint: body.company ?? null,
            title_hint: body.title ?? null,
            apply_url_hint: applyUrlHint,
            policy: {
              max_redirects: URL_FETCH_POLICY.maxRedirects,
              max_html_bytes: URL_FETCH_POLICY.maxHtmlBytes,
              timeout_seconds: URL_FETCH_POLICY.timeoutSeconds,
            },
          };

          const enqueued = await enqueueTask(trx, {
            workspaceId: scope.workspaceId,
            type: 'fetch_job',
            payload,
            idempotencyKey,
          });

          await scoped
            .updateTable('job_imports')
            .set({ task_id: enqueued.id, updated_at: new Date() })
            .where('id', '=', created.id)
            .execute();

          await recordAuditEvent(scoped, {
            action: 'job_import.queued',
            actorId: principal.userId,
            objectId: created.id,
            objectType: 'job_import',
            // Shape only: no URL, no text.
            metadata: {
              source: hasUrl ? 'url' : 'description_text',
              description_chars: input.description_chars,
              has_hints: input.company !== null || input.title !== null,
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
// GET /jobs
// ---------------------------------------------------------------------------

/** `%` and `_` are LIKE metacharacters; a user typing them means the characters. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export const listJobs: RouteHandler = async (context, request, reply) => {
  const scope = requireScope(context, request);
  const query = request.query as JobsListQuery;
  const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const preferences: Preferences = await workspacePreferences(scope);
  const matchContext = await readMatchContext(scope, preferences);

  let builder = scope
    .selectFrom('jobs')
    .selectAll()
    .orderBy('last_seen_at', 'desc')
    .orderBy('id', 'desc')
    .limit(limit + 1);

  // Filtering on the match means filtering on the newest one per job. A job
  // with no match at all drops out, which is the honest reading of "not
  // checked": it is not a low score and not an unknown eligibility.
  if (query.min_score !== undefined || query.eligible !== undefined) {
    const minScore = query.min_score;
    const eligible = query.eligible;
    builder = builder.where((eb) =>
      eb.exists(
        eb
          .selectFrom('matches')
          .select('matches.id')
          .whereRef('matches.job_id', '=', 'jobs.id')
          .where('matches.workspace_id', '=', scope.workspaceId)
          .$if(minScore !== undefined, (inner) =>
            // A null score is "nothing was evaluable", so it passes no
            // threshold at all - not even zero.
            inner.where('matches.score', '>=', minScore as number),
          )
          .$if(eligible !== undefined, (inner) =>
            inner.where('matches.eligible', '=', eligible as NonNullable<typeof eligible>),
          ),
      ),
    );
  }

  if (query.status !== undefined) builder = builder.where('status', '=', query.status);
  if (query.saved !== undefined) builder = builder.where('saved', '=', query.saved);

  if (query.query !== undefined && query.query.trim() !== '') {
    const pattern = `%${escapeLike(query.query.trim())}%`;
    builder = builder.where((eb) =>
      eb.or([eb('title', 'ilike', pattern), eb('company', 'ilike', pattern)]),
    );
  }

  if (query.include_excluded !== true) {
    builder = builder.where('excluded_reason', 'is', null);
    const excluded = [...excludedCompanies(preferences)];
    if (excluded.length > 0) {
      builder = builder.where(NORMALIZED_COMPANY_SQL, 'not in', excluded);
    }
  }

  if (query.cursor) {
    const cursor = decodeCursor(query.cursor);
    // The cursor encodes `last_seen_at|id`; the helper's field name is
    // generic. An unreadable cursor yields the first page, as for tasks.
    if (cursor) {
      builder = builder.where((eb) =>
        eb.or([
          eb('last_seen_at', '<', new Date(cursor.createdAt)),
          eb.and([eb('last_seen_at', '=', new Date(cursor.createdAt)), eb('id', '<', cursor.id)]),
        ]),
      );
    }
  }

  const rows = (await builder.execute()) as JobRow[];
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const nextCursor =
    rows.length > limit && last
      ? encodeCursor({ createdAt: last.last_seen_at.toISOString(), id: last.id })
      : null;

  return reply.status(200).send({
    items: await buildJobViews(scope, page, preferences, {
      profileRevision: matchContext.profileRevision,
      preferencesRevision: matchContext.preferencesRevision,
    }),
    next_cursor: nextCursor,
  });
};

// ---------------------------------------------------------------------------
// GET /jobs/:id
// ---------------------------------------------------------------------------

async function findJob(scope: WorkspaceScope, id: string): Promise<JobRow> {
  const byId = await scope.selectFrom('jobs').selectAll().where('id', '=', id).executeTakeFirst();
  if (byId) return byId as JobRow;

  // A `fetch_job` task id: reachable only once its import produced a job.
  const viaImport = await scope
    .selectFrom('job_imports')
    .select('job_id')
    .where('task_id', '=', id)
    .where('job_id', 'is not', null)
    .executeTakeFirst();
  if (viaImport?.job_id) {
    const row = await scope
      .selectFrom('jobs')
      .selectAll()
      .where('id', '=', viaImport.job_id)
      .executeTakeFirst();
    if (row) return row as JobRow;
  }

  throw notFound('No such job.');
}

export const getJob: RouteHandler = async (context, request, reply) => {
  const scope = requireScope(context, request);
  const { id } = request.params as { id: string };
  const row = await findJob(scope, id);
  const preferences = await workspacePreferences(scope);
  const matchContext = await readMatchContext(scope, preferences);
  return reply.status(200).send(
    await buildJobDetailView(scope, row, preferences, {
      profileRevision: matchContext.profileRevision,
      preferencesRevision: matchContext.preferencesRevision,
    }),
  );
};

// ---------------------------------------------------------------------------
// PATCH /jobs/:id
// ---------------------------------------------------------------------------

export const patchJob: RouteHandler = async (context, request, reply) => {
  const principal = requireSession(request);
  const scope = requireScope(context, request);
  const { id } = request.params as { id: string };
  const body = request.body as PatchJobRequest;

  const updated = await context.db.transaction().execute(async (trx) => {
    const scoped = scope.withExecutor(trx);
    const row = (await scoped
      .selectFrom('jobs')
      .selectAll()
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst()) as JobRow | undefined;
    if (!row) throw notFound('No such job.');

    if (row.revision !== body.expected_revision) {
      throw staleRevision(
        `The job is at revision ${row.revision}, not ${body.expected_revision}. Reload and retry.`,
      );
    }

    const closing = body.status === 'closed' && row.status !== 'closed';
    const now = new Date();
    // A correction is only a correction when it changes something: re-sending
    // the same words must not claim the source's wording as the user's, or
    // every save of an unrelated field would quietly freeze the title.
    const retitled = body.title !== undefined && body.title !== row.title;
    const recompanied = body.company !== undefined && body.company !== row.company;
    await scoped
      .updateTable('jobs')
      .set({
        saved: body.saved === undefined ? row.saved : body.saved,
        // Explicit user closure is immediate and is not undone by the board
        // still listing the posting (see upsertNormalizedJob).
        ...(closing ? { status: 'closed', closed_at: now, closed_reason: 'user' } : {}),
        // The user's words, and the record that they are the user's: without
        // the timestamp the next fetch would put the source's back.
        ...(retitled ? { title: body.title, title_edited_at: now } : {}),
        ...(recompanied ? { company: body.company, company_edited_at: now } : {}),
        revision: row.revision + 1,
        updated_at: now,
      })
      .where('id', '=', row.id)
      .execute();

    await recordAuditEvent(scoped, {
      action: 'job.updated',
      actorId: principal.userId,
      objectId: row.id,
      objectType: 'job',
      metadata: {
        revision: row.revision + 1,
        saved: body.saved ?? null,
        closed: closing,
        // Shape only: the corrected words themselves are job content, and the
        // audit log records what happened, not what a posting says.
        corrected: [...(recompanied ? ['company'] : []), ...(retitled ? ['title'] : [])],
      },
    });

    return (await scoped
      .selectFrom('jobs')
      .selectAll()
      .where('id', '=', row.id)
      .executeTakeFirstOrThrow()) as JobRow;
  });

  const preferences = await workspacePreferences(scope);
  const matchContext = await readMatchContext(scope, preferences);
  const [view] = await buildJobViews(scope, [updated], preferences, {
    profileRevision: matchContext.profileRevision,
    preferencesRevision: matchContext.preferencesRevision,
  });
  return reply.status(200).send(view as JobView);
};

// ---------------------------------------------------------------------------
// POST /jobs/:id/match
// ---------------------------------------------------------------------------

/**
 * Queue a fit score for one job.
 *
 * Scoring is cheap and deterministic, so this does not refuse to re-run when a
 * current match already exists: the user asked, and re-scoring unchanged
 * inputs rewrites the same row rather than accumulating history (the revision
 * tuple is unique). What it will not do is score silently in the background —
 * every match in the system was asked for.
 *
 * No provider is involved, so this consumes no AI budget and works on an
 * installation with no model configured at all.
 */
export const matchJob: RouteHandler = async (context, request, reply) => {
  const scope = requireScope(context, request);
  const principal = requireSession(request);
  const { id } = request.params as { id: string };
  const idempotencyKey = readIdempotencyKey(request);

  const job = await requireJobRow(scope, id);
  const preferences = await workspacePreferences(scope);
  const matchContext = await readMatchContext(scope, preferences);
  const payload: MatchJobInput = buildMatchInput(job, matchContext);

  const outcome = await withIdempotency<AcceptedResponse>(
    context.db,
    scope,
    request,
    `POST /jobs/${id}/match`,
    async () => {
      const task = await context.db.transaction().execute(async (trx) => {
        const enqueued = await enqueueTask(trx, {
          workspaceId: scope.workspaceId,
          type: 'match_job',
          payload,
          idempotencyKey,
        });

        await recordAuditEvent(scope.withExecutor(trx), {
          action: 'job.match_queued',
          actorId: principal.userId,
          objectId: job.id,
          objectType: 'job',
          // Shape only: counts, never the facts themselves.
          metadata: {
            job_revision: job.revision,
            profile_revision: matchContext.profileRevision,
            preferences_revision: matchContext.preferencesRevision,
            confirmed_fact_count: matchContext.confirmedFacts.length,
          },
        });

        return enqueued;
      });

      return {
        status: 202,
        body: { task_id: task.id, status: 'queued' } satisfies AcceptedResponse,
      };
    },
  );

  return sendOutcome(reply, outcome);
};
