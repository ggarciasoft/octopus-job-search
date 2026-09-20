/**
 * Session login and logout.
 *
 * Login failures are deliberately uniform: the same status, the same message
 * and (via `verifyAgainstDummy`) roughly the same duration whether the account
 * is unknown, disabled or the password is wrong. Anything else turns the login
 * form into an account-enumeration oracle.
 */
import type { LoginRequest, MeResponse } from '@job-getter/contracts';
import { unauthenticated } from '../errors.js';
import { normalizeEmail, verifyAgainstDummy, verifyPassword } from '../auth/password.js';
import {
  clearSessionCookies,
  createSession,
  revokeSession,
  setSessionCookies,
} from '../auth/sessions.js';
import { WorkspaceScope } from '../auth/scope.js';
import { buildMeResponse } from './me.js';
import { requireSession, type RouteHandler } from './context.js';

const UNIFORM_LOGIN_FAILURE = 'Email or password is incorrect.';

export const login: RouteHandler = async (context, request, reply) => {
  const body = request.body as LoginRequest;
  const normalized = normalizeEmail(body.email);

  const user = await context.db
    .selectFrom('users')
    .selectAll()
    .where('normalized_email', '=', normalized)
    .executeTakeFirst();

  if (!user) {
    // Burn comparable CPU so timing does not reveal that the account is absent.
    await verifyAgainstDummy(body.password);
    throw unauthenticated(UNIFORM_LOGIN_FAILURE);
  }

  const passwordOk = await verifyPassword(user.password_hash, body.password);
  if (!passwordOk) throw unauthenticated(UNIFORM_LOGIN_FAILURE);
  if (user.disabled_at !== null) throw unauthenticated(UNIFORM_LOGIN_FAILURE);
  // Hosted beta requires a verified address; local mode has no email channel
  // and marks the owner verified at setup.
  if (context.config.isHosted && user.verified_at === null) {
    throw unauthenticated(UNIFORM_LOGIN_FAILURE);
  }

  const membership = await context.db
    .selectFrom('memberships')
    .innerJoin('workspaces', 'workspaces.id', 'memberships.workspace_id')
    .select([
      'workspaces.id as workspace_id',
      'workspaces.mode',
      'workspaces.locale',
      'workspaces.deletion_state',
    ])
    .where('memberships.user_id', '=', user.id)
    .where('memberships.role', '=', 'owner')
    .executeTakeFirst();

  if (!membership || membership.deletion_state !== 'active') {
    throw unauthenticated(UNIFORM_LOGIN_FAILURE);
  }

  const session = await createSession(context.db, context.config, {
    userId: user.id,
    workspaceId: membership.workspace_id,
  });
  setSessionCookies(reply, context.config, session);

  const scope = WorkspaceScope.forTaskWorkspace(context.db, membership.workspace_id);
  const me: MeResponse = await buildMeResponse(context, scope, {
    id: user.id,
    email: user.email,
    verified_at: user.verified_at,
    workspaceId: membership.workspace_id,
    mode: membership.mode,
    locale: membership.locale,
  });

  context.logger.info(
    { request_id: request.id, workspace_id: membership.workspace_id },
    'session established',
  );

  return reply.status(200).send(me);
};

export const logout: RouteHandler = async (context, request, reply) => {
  const principal = requireSession(request);
  await revokeSession(context.db, principal.sessionId);
  clearSessionCookies(reply, context.config);
  return reply.status(204).send();
};
