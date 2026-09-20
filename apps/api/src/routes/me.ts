/**
 * GET /me — identity, workspace and *honest* capability flags.
 *
 * Invariant 10: "No unsupported website may be presented as a working
 * integration", and more generally the UI must not offer a control that
 * silently does nothing. Every flag below therefore reports what this build
 * actually does:
 *
 *  * `implemented_task_types` is the intersection of the contract's
 *    IMPLEMENTED_TASK_TYPES and the task types this build can actually
 *    enqueue. A worker handler alone is not enough: if no route can create
 *    the task, advertising it would offer the user a capability with no way
 *    to reach it. The intersection is computed rather than listed, so a task
 *    type becomes visible exactly when its route stops being deferred.
 *  * `worker_online` is derived from an observed worker poll inside the last
 *    90 seconds, not assumed from configuration.
 *  * Every milestone not yet built reports `false`. They become true in the
 *    milestone that implements them, not before.
 */
import {
  DEFAULT_OPERATIONAL_LIMITS,
  type Capabilities,
  type Locale,
  type MeResponse,
  type UsageSummary,
  type WorkspaceMode,
} from '@job-getter/contracts';
import { notFound } from '../errors.js';
import type { WorkspaceScope } from '../auth/scope.js';
import { isWorkerOnline } from '../tasks/queue.js';
import { enqueueableTaskTypes } from './capabilities.js';
import { requireScope, requireSession, type RouteContext, type RouteHandler } from './context.js';

export interface MeSubject {
  readonly id: string;
  readonly email: string;
  readonly verified_at: Date | null;
  readonly workspaceId: string;
  readonly mode: WorkspaceMode;
  readonly locale: Locale;
}

/**
 * Usage for M0.
 *
 * No provider adapter exists yet, so no inference has happened and the counts
 * are genuinely zero. Cost is `null` rather than `0`: without a rate card the
 * cost is *unknown*, and reporting unknown as zero would be a lie the budget
 * logic would later inherit (04_API_CONTRACTS.md).
 */
async function buildUsage(scope: WorkspaceScope): Promise<UsageSummary> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await scope
    .selectFrom('usage_ledger')
    .select(['input_tokens', 'output_tokens', 'measured_cost', 'currency'])
    .where('created_at', '>=', since)
    .where('status', '!=', 'released')
    .execute();

  let inputTokens = 0;
  let outputTokens = 0;
  let measuredCost: number | null = null;
  let currency: string | null = null;

  for (const row of rows) {
    inputTokens += row.input_tokens;
    outputTokens += row.output_tokens;
    if (row.measured_cost !== null) {
      measuredCost = (measuredCost ?? 0) + Number(row.measured_cost);
      currency = row.currency;
    }
  }

  return {
    ai_requests_today: rows.length,
    ai_requests_per_day_limit: DEFAULT_OPERATIONAL_LIMITS.ai_requests_per_day,
    input_tokens_today: inputTokens,
    output_tokens_today: outputTokens,
    measured_cost_today: measuredCost,
    currency,
    daily_cost_budget: null,
  };
}

async function buildCapabilities(
  context: RouteContext,
  scope: WorkspaceScope,
): Promise<Capabilities> {
  const provider = await scope
    .selectFrom('provider_settings')
    .select(['provider'])
    .executeTakeFirst();

  return {
    implemented_task_types: [...enqueueableTaskTypes()],
    // A row can only exist once M1 writes one; until then this is false, and
    // it stays false for the `none` provider by definition.
    ai_provider_configured: provider !== undefined && provider.provider !== 'none',
    // Milestone flags. Each becomes true in the milestone that implements it.
    // M1 landed: the import routes are registered, the `parse_profile` task
    // can be created from a session, and the worker's result is applied to the
    // import row. `implemented_task_types` above reports `parse_profile` for
    // the same reason, computed rather than asserted.
    profile_import: true, // M1
    job_discovery: false, // M2
    cv_generation: false, // M3
    applications: false, // M4
    browser_filling: false, // M4 (local runner) / M5 (extension)
    extension: false, // M5
    worker_online: await isWorkerOnline(context.db),
  };
}

export async function buildMeResponse(
  context: RouteContext,
  scope: WorkspaceScope,
  subject: MeSubject,
): Promise<MeResponse> {
  const [capabilities, usage] = await Promise.all([
    buildCapabilities(context, scope),
    buildUsage(scope),
  ]);

  return {
    user: {
      id: subject.id,
      email: subject.email,
      verified_at: subject.verified_at === null ? null : subject.verified_at.toISOString(),
    },
    workspace: {
      id: subject.workspaceId,
      mode: subject.mode,
      locale: subject.locale,
      role: 'owner',
    },
    mode: subject.mode,
    capabilities,
    usage,
  };
}

export const getMe: RouteHandler = async (context, request, reply) => {
  const principal = requireSession(request);
  const scope = requireScope(context, request);

  const row = await context.db
    .selectFrom('users')
    .innerJoin('workspaces', 'workspaces.id', 'workspaces.id')
    .select([
      'users.id as user_id',
      'users.email',
      'users.verified_at',
      'workspaces.id as workspace_id',
      'workspaces.mode',
      'workspaces.locale',
    ])
    .where('users.id', '=', principal.userId)
    .where('workspaces.id', '=', principal.workspaceId)
    .executeTakeFirst();

  if (!row) throw notFound();

  const me = await buildMeResponse(context, scope, {
    id: row.user_id,
    email: row.email,
    verified_at: row.verified_at,
    workspaceId: row.workspace_id,
    mode: row.mode,
    locale: row.locale,
  });

  return reply.status(200).send(me);
};
