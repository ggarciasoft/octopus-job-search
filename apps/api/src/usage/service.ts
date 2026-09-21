/**
 * The daily AI budget, and the ledger that makes it real.
 *
 * `06_AI_PROFILE_AND_CV.md`:
 *
 *     Reserve estimated token/cost budget before requests; settle actual usage
 *     if reported. Track unknown price as unknown, never zero. A cost cap
 *     requires a configured rate card; otherwise enforce token/request caps.
 *
 * Two properties matter more than the arithmetic.
 *
 * **The ledger is the database, not a counter inside a worker.** A worker
 * process builds a fresh budget for every task, so a per-process counter starts
 * at zero each time: it can refuse a single request larger than the whole day's
 * allowance, and nothing else. A day of ordinary requests would never exhaust
 * anything, and `GET /me` would report the usage as zero forever. The
 * reservation therefore happens here, against `usage_ledger`, over a rolling
 * 24-hour window.
 *
 * **The reservation happens before the request.** A budget checked afterwards
 * is not a budget; the money is already spent. `reserveUsage` writes a
 * `reserved` row and returns, the worker sends its request, and `settleUsage`
 * replaces the estimate with what the provider actually reported. A request
 * that was never sent is `released` and stops counting.
 *
 * Unreported usage is *not* free: settling with nulls leaves the estimate
 * standing as the charge. An unknown *price* stays null all the way through, so
 * nothing downstream adds it up as zero.
 */
import { sql } from 'kysely';
import type {
  ProviderId,
  RateCard,
  UsageReserveResponse,
  UsageSettleResponse,
} from '@job-getter/contracts';
import type { Db } from '../db/pool.js';
import { ApiError, notFound } from '../errors.js';
import { WorkspaceScope } from '../auth/scope.js';
import { lockLeasedTask } from '../tasks/queue.js';
import { loadProviderSettings, readValidatedConfig } from '../settings/providers.js';
import { workspacePreferences } from '../discovery/scans.js';

export const USAGE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * A budget refusal is a 409, not a 429.
 *
 * The difference is not cosmetic. The worker's API client treats 429 as a
 * transient rate limit and retries it with backoff; retrying a budget refusal
 * would burn the worker's attempts against a wall that does not move until the
 * day rolls over. A 4xx that is not 429 reaches the caller once, which is
 * exactly what should happen here.
 */
export function budgetExhausted(message: string): ApiError {
  return new ApiError(409, 'BUDGET_EXHAUSTED', message);
}

interface LedgerRow {
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly measured_cost: string | null;
  readonly reserved_cost: string | null;
  readonly currency: string | null;
  readonly status: string;
}

export interface UsageTotals {
  /** Requests begun in the window, whether or not they have settled. */
  readonly requests: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Input plus output: what a `daily_token_budget` is measured against. */
  readonly tokens: number;
  /**
   * Money whose price is known. A row priced before any rate card existed
   * contributes nothing rather than a fabricated figure — which is precisely
   * why a cost cap is only enforceable alongside a rate card.
   */
  readonly cost: number;
  /** Rows in the window whose price could not be computed at all. */
  readonly unknownCostRequests: number;
}

export function totalsFrom(rows: readonly LedgerRow[]): UsageTotals {
  let inputTokens = 0;
  let outputTokens = 0;
  let cost = 0;
  let unknownCostRequests = 0;
  for (const row of rows) {
    inputTokens += row.input_tokens;
    outputTokens += row.output_tokens;
    const priced = row.measured_cost ?? row.reserved_cost;
    if (priced === null) unknownCostRequests += 1;
    else cost += Number(priced);
  }
  return {
    requests: rows.length,
    inputTokens,
    outputTokens,
    tokens: inputTokens + outputTokens,
    cost,
    unknownCostRequests,
  };
}

/** Rows that count: everything in the window that was not released. */
async function windowRows(scope: WorkspaceScope, now: Date): Promise<LedgerRow[]> {
  const rows = await scope
    .selectFrom('usage_ledger')
    .select([
      'input_tokens',
      'output_tokens',
      'measured_cost',
      'reserved_cost',
      'currency',
      'status',
    ])
    .where('created_at', '>=', new Date(now.getTime() - USAGE_WINDOW_MS))
    .where('status', '!=', 'released')
    .execute();
  return rows as LedgerRow[];
}

function priceOf(
  rateCard: RateCard | null,
  inputTokens: number,
  outputTokens: number,
): number | null {
  if (rateCard === null) return null;
  return (
    (inputTokens * rateCard.input_cost_per_million +
      outputTokens * rateCard.output_cost_per_million) /
    1_000_000
  );
}

export interface WorkspaceBudget {
  readonly provider: ProviderId;
  readonly requestsPerDay: number;
  readonly dailyTokenBudget: number | null;
  readonly dailyCostBudget: number | null;
  readonly rateCard: RateCard | null;
  /** A cost cap without a rate card cannot be enforced without inventing prices. */
  readonly costCapEnforceable: boolean;
}

export async function loadWorkspaceBudget(scope: WorkspaceScope): Promise<WorkspaceBudget> {
  const row = await loadProviderSettings(scope);
  const config = readValidatedConfig(row);
  const preferences = await workspacePreferences(scope);
  const dailyCostBudget = config.limits.daily_cost_budget;
  return {
    provider: (row?.provider ?? 'none') as ProviderId,
    requestsPerDay: preferences.limits.ai_requests_per_day,
    dailyTokenBudget: config.limits.daily_token_budget,
    dailyCostBudget,
    rateCard: config.rate_card,
    costCapEnforceable: dailyCostBudget !== null && config.rate_card !== null,
  };
}

/** The usage a workspace has run up in the window, for `GET /me`. */
export async function summariseUsage(
  scope: WorkspaceScope,
  now: Date = new Date(),
): Promise<{ totals: UsageTotals; budget: WorkspaceBudget; currency: string | null }> {
  const rows = await windowRows(scope, now);
  const budget = await loadWorkspaceBudget(scope);
  const currency =
    budget.rateCard?.currency ?? rows.find((row) => row.currency !== null)?.currency ?? null;
  return { totals: totalsFrom(rows), budget, currency };
}

async function lockReservation(
  scope: WorkspaceScope,
  reservationId: string,
  taskId: string,
): Promise<LedgerRow & { readonly id: string }> {
  const row = await scope
    .selectFrom('usage_ledger')
    .selectAll()
    .where('id', '=', reservationId)
    .forUpdate()
    .executeTakeFirst();

  // The reservation must belong to the task whose lease was just proved.
  // Without that check a worker holding any lease could settle or release
  // another task's reservation and hand itself budget back.
  if (row === undefined || row.task_id !== taskId) {
    throw notFound('No such usage reservation for this task.');
  }
  return row as unknown as LedgerRow & { readonly id: string };
}

export interface ReserveInput {
  readonly estimatedInputTokens: number;
  readonly estimatedOutputTokens: number;
  readonly now?: Date;
}

/**
 * Holds budget for one request, or refuses it.
 *
 * The whole check runs in one transaction under a workspace-wide advisory lock,
 * because two workers reserving at the same instant would otherwise both read
 * the same totals and both conclude there was room.
 */
export async function reserveUsage(
  db: Db,
  taskId: string,
  leaseToken: string,
  input: ReserveInput,
): Promise<UsageReserveResponse> {
  const now = input.now ?? new Date();
  return db.transaction().execute(async (trx) => {
    const task = await lockLeasedTask(trx, taskId, leaseToken);
    const scope = WorkspaceScope.forTaskWorkspace(trx, task.workspace_id);
    await sql`select pg_advisory_xact_lock(hashtextextended(${task.workspace_id}, 0))`.execute(trx);

    const budget = await loadWorkspaceBudget(scope);
    const totals = totalsFrom(await windowRows(scope, now));

    if (totals.requests >= budget.requestsPerDay) {
      throw budgetExhausted(
        `The daily limit of ${budget.requestsPerDay} model requests has been reached. ` +
          'Reviewing, editing and exporting still work; new inference resumes as the ' +
          "day's requests age out.",
      );
    }

    const estimated = input.estimatedInputTokens + input.estimatedOutputTokens;
    if (budget.dailyTokenBudget !== null && totals.tokens + estimated > budget.dailyTokenBudget) {
      throw budgetExhausted(
        `This request needs about ${estimated} tokens, which would take the day's usage ` +
          `to ${totals.tokens + estimated}, above the ${budget.dailyTokenBudget} token ` +
          'budget. No request was sent.',
      );
    }

    const reservedCost = priceOf(
      budget.rateCard,
      input.estimatedInputTokens,
      input.estimatedOutputTokens,
    );
    if (
      budget.costCapEnforceable &&
      reservedCost !== null &&
      budget.dailyCostBudget !== null &&
      totals.cost + reservedCost > budget.dailyCostBudget
    ) {
      throw budgetExhausted(
        `This request is estimated at ${reservedCost.toFixed(4)} ` +
          `${budget.rateCard?.currency ?? ''}, which would exceed the daily cost budget of ` +
          `${budget.dailyCostBudget}. No request was sent.`,
      );
    }

    const inserted = await scope
      .insertInto('usage_ledger', {
        task_id: task.id,
        provider: budget.provider,
        // The estimate stands as the charge until it is settled, so a request
        // still in flight occupies budget rather than being invisible.
        input_tokens: input.estimatedInputTokens,
        output_tokens: input.estimatedOutputTokens,
        measured_cost: null,
        reserved_cost: reservedCost === null ? null : String(reservedCost),
        currency: budget.rateCard?.currency ?? null,
        status: 'reserved',
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    return {
      reservation_id: inserted.id,
      reserved_tokens: estimated,
      reserved_cost: reservedCost,
      currency: budget.rateCard?.currency ?? null,
    };
  });
}

export interface SettleInput {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
}

/** Replaces a reservation with the usage the provider actually reported. */
export async function settleUsage(
  db: Db,
  taskId: string,
  leaseToken: string,
  reservationId: string,
  usage: SettleInput,
): Promise<UsageSettleResponse> {
  return db.transaction().execute(async (trx) => {
    const task = await lockLeasedTask(trx, taskId, leaseToken);
    const scope = WorkspaceScope.forTaskWorkspace(trx, task.workspace_id);
    const row = await lockReservation(scope, reservationId, task.id);
    const budget = await loadWorkspaceBudget(scope);

    // A null means the provider reported nothing. The reservation's estimate
    // then stands, because a request whose usage went unreported still happened.
    const inputTokens = usage.inputTokens ?? row.input_tokens;
    const outputTokens = usage.outputTokens ?? row.output_tokens;
    const measuredCost = priceOf(budget.rateCard, inputTokens, outputTokens);
    const currency = budget.rateCard?.currency ?? row.currency;

    await scope
      .updateTable('usage_ledger')
      .set({
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        measured_cost: measuredCost === null ? null : String(measuredCost),
        currency,
        status: 'settled',
        updated_at: new Date(),
      })
      .where('id', '=', reservationId)
      .execute();

    return {
      reservation_id: reservationId,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      measured_cost: measuredCost,
      currency,
      cost_is_unknown: measuredCost === null,
    };
  });
}

/** Gives back a reservation for a request that was never sent. */
export async function releaseUsage(
  db: Db,
  taskId: string,
  leaseToken: string,
  reservationId: string,
): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const task = await lockLeasedTask(trx, taskId, leaseToken);
    const scope = WorkspaceScope.forTaskWorkspace(trx, task.workspace_id);
    await lockReservation(scope, reservationId, task.id);
    await scope
      .updateTable('usage_ledger')
      .set({ status: 'released', updated_at: new Date() })
      .where('id', '=', reservationId)
      .execute();
  });
}
