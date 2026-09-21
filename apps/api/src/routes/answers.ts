/**
 * GET /answer-bank, PUT /answer-bank, DELETE /answer-bank/:id.
 *
 * PUT rather than POST because the identity of a stored answer is the triple
 * (question_key, scope, scope_id), not a row id. Answering "notice period"
 * again for the same company replaces the answer instead of accumulating a
 * second one — two answers to one question is how the older one eventually
 * gets sent.
 *
 * `confirmed` defaults to true: a PUT from the settings screen is the user
 * stating their own answer. Passing `confirmed: false` stores a value they
 * have not stood behind yet, and the packet routes refuse to reuse it.
 */
import type {
  AnswerBankEntry,
  AnswerBankListQuery,
  AnswerBankPutRequest,
  AnswerScope,
} from '@job-getter/contracts';
import { notFound } from '../errors.js';
import { recordAuditEvent } from '../auth/scope.js';
import type { AnswerBankRow } from '../db/types.js';
import { normalizeAnswerScope, toAnswerBankEntry } from '../applications/answers.js';
import { recordDeletion } from '../privacy/ledger.js';
import { requireScope, requireSession, type RouteHandler } from './context.js';
import { decodeCursor, encodeCursor } from './tasks.js';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

export const listAnswerBank: RouteHandler = async (context, request, reply) => {
  const scope = requireScope(context, request);
  const query = request.query as AnswerBankListQuery;
  const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

  let builder = scope
    .selectFrom('answer_bank')
    .selectAll()
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(limit + 1);

  if (query.question_key !== undefined) {
    builder = builder.where('question_key', '=', query.question_key);
  }
  if (query.scope !== undefined) builder = builder.where('scope', '=', query.scope);
  if (query.cursor) {
    const cursor = decodeCursor(query.cursor);
    // An unreadable cursor yields the first page rather than an error.
    if (cursor) {
      builder = builder.where((eb) =>
        eb.or([
          eb('created_at', '<', new Date(cursor.createdAt)),
          eb.and([eb('created_at', '=', new Date(cursor.createdAt)), eb('id', '<', cursor.id)]),
        ]),
      );
    }
  }

  const rows = (await builder.execute()) as AnswerBankRow[];
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const nextCursor =
    rows.length > limit && last
      ? encodeCursor({ createdAt: last.created_at.toISOString(), id: last.id })
      : null;

  return reply.status(200).send({ items: page.map(toAnswerBankEntry), next_cursor: nextCursor });
};

export const putAnswerBankEntry: RouteHandler = async (context, request, reply) => {
  const scope = requireScope(context, request);
  const principal = requireSession(request);
  const body = request.body as AnswerBankPutRequest;

  const answerScope: AnswerScope = body.scope ?? 'general';
  const scopeId = normalizeAnswerScope(answerScope, body.scope_id);
  const confirmed = body.confirmed ?? true;
  const now = new Date();

  const row = await context.db.transaction().execute(async (trx) => {
    const scoped = scope.withExecutor(trx);
    const upserted = await scoped
      .insertInto('answer_bank', {
        question_key: body.question_key,
        label: body.label ?? null,
        answer: JSON.stringify(body.answer),
        sensitivity: body.sensitivity ?? 'standard',
        scope: answerScope,
        scope_id: scopeId,
        confirmed_at: confirmed ? now : null,
        expires_at:
          body.expires_at === undefined || body.expires_at === null
            ? null
            : new Date(body.expires_at),
      })
      .onConflict((builder) =>
        builder.columns(['workspace_id', 'question_key', 'scope', 'scope_id']).doUpdateSet({
          label: body.label ?? null,
          answer: JSON.stringify(body.answer),
          sensitivity: body.sensitivity ?? 'standard',
          // Re-stating an answer re-confirms it; storing it unconfirmed
          // clears any previous confirmation rather than leaving a stale one.
          confirmed_at: confirmed ? now : null,
          expires_at:
            body.expires_at === undefined || body.expires_at === null
              ? null
              : new Date(body.expires_at),
          updated_at: now,
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();

    await recordAuditEvent(scoped, {
      action: 'answer_bank.stored',
      actorId: principal.userId,
      objectId: upserted.id,
      objectType: 'answer_bank',
      // The question and its scope, never the answer itself.
      metadata: {
        question_key: body.question_key,
        scope: answerScope,
        sensitivity: body.sensitivity ?? 'standard',
        confirmed,
      },
    });
    return upserted as AnswerBankRow;
  });

  return reply.status(200).send(toAnswerBankEntry(row) satisfies AnswerBankEntry);
};

export const deleteAnswerBankEntry: RouteHandler = async (context, request, reply) => {
  const scope = requireScope(context, request);
  const principal = requireSession(request);
  const { id } = request.params as { id: string };

  const existing = await scope
    .selectFrom('answer_bank')
    .select(['id', 'question_key'])
    .where('id', '=', id)
    .executeTakeFirst();
  if (!existing) throw notFound('No such stored answer.');

  await context.db.transaction().execute(async (trx) => {
    const scoped = scope.withExecutor(trx);
    await scoped.deleteFrom('answer_bank').where('id', '=', id).execute();
    // Recorded so a restore of an older backup cannot bring the answer back
    // (03_DATA_MODEL.md, "Privacy lifecycle").
    await recordDeletion(trx, {
      workspaceId: scope.workspaceId,
      kind: 'answer_bank',
      objectId: id,
    });
    await recordAuditEvent(scoped, {
      action: 'answer_bank.deleted',
      actorId: principal.userId,
      objectId: id,
      objectType: 'answer_bank',
      metadata: { question_key: existing.question_key },
    });
  });

  return reply.status(204).send();
};
