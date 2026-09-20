/**
 * One-time local bootstrap.
 *
 * 09_SECURITY_PRIVACY.md: "Local bootstrap requires a single-use setup secret
 * shown only in local logs/terminal, binding setup to loopback. Generate an
 * owner password with Argon2id hashing."
 *
 * Three properties matter and are each tested:
 *
 *  1. The route closes *permanently*. Closure is recorded in `system_flags`,
 *     not inferred from "a user exists", so deleting the owner row cannot
 *     reopen the bootstrap path.
 *  2. The closed check runs *before* the token check, so a correct token on a
 *     closed installation still returns SETUP_CLOSED and never becomes an
 *     oracle for whether the token was right.
 *  3. The token is compared in constant time.
 *
 * Source-address binding: 10_DEPLOYMENT.md publishes the web edge on
 * 127.0.0.1:3000 and keeps the API unpublished, so in Compose the request
 * reaches this service from the reverse proxy's container address, not from
 * loopback. Requiring literal loopback here would make the documented
 * deployment unusable. The rule implemented is therefore: the connection must
 * originate from loopback or a private/link-local address; a public source
 * address is refused. The loopback binding itself is enforced at the edge.
 */
import type { FastifyRequest } from 'fastify';
import {
  DEFAULT_PREFERENCES,
  type MeResponse,
  type SetupRequest,
  type SetupStatus,
} from '@job-getter/contracts';
import { forbidden, setupClosed, unauthenticated } from '../errors.js';
import { constantTimeEqual } from '../util/crypto.js';
import { hashPassword, normalizeEmail } from '../auth/password.js';
import { createSession, setSessionCookies } from '../auth/sessions.js';
import { WorkspaceScope } from '../auth/scope.js';
import { buildMeResponse } from './me.js';
import type { RouteContext, RouteHandler } from './context.js';

export const SETUP_COMPLETED_FLAG = 'setup_completed';

export async function isSetupClosed(context: RouteContext): Promise<boolean> {
  const flag = await context.db
    .selectFrom('system_flags')
    .select('key')
    .where('key', '=', SETUP_COMPLETED_FLAG)
    .executeTakeFirst();
  return flag !== undefined;
}

const PRIVATE_IPV4 =
  /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/;

/** Loopback, RFC1918, link-local, or IPv6 loopback/ULA/link-local. */
export function isTrustedSetupSource(address: string | undefined): boolean {
  if (!address) return false;
  const normalised = address.replace(/^::ffff:/i, '').toLowerCase();
  if (normalised === '::1' || normalised === 'localhost') return true;
  if (PRIVATE_IPV4.test(normalised)) return true;
  // fc00::/7 unique-local and fe80::/10 link-local.
  if (/^f[cd][0-9a-f]{2}:/.test(normalised)) return true;
  if (/^fe[89ab][0-9a-f]:/.test(normalised)) return true;
  return false;
}

function assertTrustedSource(request: FastifyRequest): void {
  if (!isTrustedSetupSource(request.ip)) {
    throw forbidden(
      'One-time setup can only be completed from the machine or private network running Job Getter.',
    );
  }
}

export const getSetupStatus: RouteHandler = async (context, _request, reply) => {
  const closed = await isSetupClosed(context);
  const status: SetupStatus = {
    mode: context.config.appMode,
    // Setup is offered only in local mode and only while it is still open.
    setup_required: !closed && !context.config.isHosted,
    // Hosted invitation signup is milestone M6 and is not implemented, so the
    // honest answer is always false (invariant 10).
    registration_open: false,
  };
  return reply.status(200).send(status);
};

export const completeSetup: RouteHandler = async (context, request, reply) => {
  if (context.config.isHosted) {
    // Hosted installations bootstrap through operator provisioning, not
    // through a shared setup token. Saying "closed" avoids implying that a
    // hosted signup path exists.
    throw setupClosed();
  }

  assertTrustedSource(request);

  // Closure is checked first, so a correct token cannot be distinguished from
  // an incorrect one once setup is finished.
  if (await isSetupClosed(context)) throw setupClosed();

  const body = request.body as SetupRequest;
  const expected = context.config.setupToken;
  if (expected === null || !constantTimeEqual(body.setup_token, expected)) {
    throw unauthenticated('The setup token is not valid.');
  }

  const passwordHash = await hashPassword(body.password);
  const locale = body.locale ?? 'en';

  const created = await context.db.transaction().execute(async (trx) => {
    // Re-check inside the transaction: two concurrent setup requests must not
    // both create an owner. The primary key on system_flags is the real
    // guard — the second transaction fails with a unique violation.
    await trx
      .insertInto('system_flags')
      .values({
        key: SETUP_COMPLETED_FLAG,
        value: JSON.stringify({ completed_at: new Date().toISOString() }),
      })
      .execute();

    const user = await trx
      .insertInto('users')
      .values({
        normalized_email: normalizeEmail(body.email),
        email: body.email.trim(),
        password_hash: passwordHash,
        // The local owner is the operator; there is no email channel to
        // verify against, and 10_DEPLOYMENT.md adds verification in hosted.
        verified_at: new Date(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    const workspace = await trx
      .insertInto('workspaces')
      .values({ owner_user_id: user.id, mode: 'local', locale })
      .returningAll()
      .executeTakeFirstOrThrow();

    await trx
      .insertInto('memberships')
      .values({ workspace_id: workspace.id, user_id: user.id, role: 'owner' })
      .execute();

    // Empty profile and preferences rows so M1 has somewhere to write without
    // a special "first write" path. No facts, no invented content.
    await trx
      .insertInto('profiles')
      .values({ workspace_id: workspace.id, revision: 1, contact: null, locale })
      .execute();

    await trx
      .insertInto('preferences')
      .values({
        workspace_id: workspace.id,
        revision: 1,
        config: JSON.stringify({ ...DEFAULT_PREFERENCES, cv_language: locale }),
      })
      .execute();

    const session = await createSession(trx, context.config, {
      userId: user.id,
      workspaceId: workspace.id,
    });

    await trx
      .insertInto('audit_events')
      .values({
        workspace_id: workspace.id,
        actor_id: user.id,
        action: 'setup.completed',
        object_id: workspace.id,
        object_type: 'workspace',
        metadata: JSON.stringify({ locale, mode: 'local' }),
      })
      .execute();

    return { user, workspace, session };
  });

  setSessionCookies(reply, context.config, created.session);

  const scope = WorkspaceScope.forTaskWorkspace(context.db, created.workspace.id);
  const me: MeResponse = await buildMeResponse(context, scope, {
    id: created.user.id,
    email: created.user.email,
    verified_at: created.user.verified_at,
    workspaceId: created.workspace.id,
    mode: created.workspace.mode,
    locale: created.workspace.locale,
  });

  context.logger.info(
    { request_id: request.id, workspace_id: created.workspace.id },
    'one-time setup completed; the setup route is now permanently closed',
  );

  return reply.status(201).send(me);
};
