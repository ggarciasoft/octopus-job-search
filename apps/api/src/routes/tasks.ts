/**
 * Public task routes: GET /tasks/:id, GET /tasks, POST /tasks/:id/cancel.
 *
 * Every query goes through `WorkspaceScope`, so a task id belonging to another
 * workspace produces exactly the same 404 as an id that does not exist at all
 * (AT19 / 09_SECURITY_PRIVACY.md).
 */
import { notFound } from '../errors.js';
import type { TaskRow } from '../db/types.js';
import { cancelTask, toTaskView } from '../tasks/queue.js';
import { requireScope, type RouteHandler } from './context.js';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

export const getTask: RouteHandler = async (context, request, reply) => {
  const scope = requireScope(context, request);
  const { id } = request.params as { id: string };

  const row = (await scope
    .selectFrom('tasks')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst()) as TaskRow | undefined;

  if (!row) throw notFound('No such task.');
  return reply.status(200).send(toTaskView(row));
};

/**
 * Cursor pagination per 04_API_CONTRACTS.md: `{items, next_cursor}`, limit
 * default 25 / max 100. The cursor is an opaque, workspace-scoped encoding of
 * `created_at|id`; it is only ever used as a filter *inside* the scope, so a
 * forged cursor cannot reach another workspace's rows.
 */
interface Cursor {
  readonly createdAt: string;
  readonly id: string;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.createdAt}|${cursor.id}`, 'utf8').toString('base64url');
}

export function decodeCursor(value: string): Cursor | null {
  try {
    const [createdAt, id] = Buffer.from(value, 'base64url').toString('utf8').split('|');
    if (!createdAt || !id || Number.isNaN(Date.parse(createdAt))) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

export const listTasks: RouteHandler = async (context, request, reply) => {
  const scope = requireScope(context, request);
  const query = request.query as { cursor?: string; limit?: number };
  const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

  let builder = scope
    .selectFrom('tasks')
    .selectAll()
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(limit + 1);

  if (query.cursor) {
    const cursor = decodeCursor(query.cursor);
    // An unreadable cursor yields the first page rather than an error: the UI
    // recovers instead of dead-ending on a stale bookmark.
    if (cursor) {
      builder = builder.where((eb) =>
        eb.or([
          eb('created_at', '<', new Date(cursor.createdAt)),
          eb.and([eb('created_at', '=', new Date(cursor.createdAt)), eb('id', '<', cursor.id)]),
        ]),
      );
    }
  }

  const rows = (await builder.execute()) as TaskRow[];
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const nextCursor =
    rows.length > limit && last
      ? encodeCursor({ createdAt: last.created_at.toISOString(), id: last.id })
      : null;

  return reply.status(200).send({
    items: page.map(toTaskView),
    next_cursor: nextCursor,
  });
};

export const cancelTaskRoute: RouteHandler = async (context, request, reply) => {
  const scope = requireScope(context, request);
  const { id } = request.params as { id: string };

  // Scope check first so a foreign id is a 404 before any state is touched.
  const existing = await scope
    .selectFrom('tasks')
    .select('id')
    .where('id', '=', id)
    .executeTakeFirst();
  if (!existing) throw notFound('No such task.');

  const row = await cancelTask(context.db, scope.workspaceId, id);
  return reply.status(200).send(toTaskView(row));
};
