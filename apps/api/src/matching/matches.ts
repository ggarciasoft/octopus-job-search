/**
 * The `matches` domain: queue a score, store the result, read it back.
 *
 * Three decisions are worth stating, because each one is a place where the
 * obvious implementation would have been dishonest.
 *
 * **Nothing is recomputed silently.** A match is stored against the four
 * revisions that produced it (job, profile, preferences, algorithm). When any
 * of them moves on, the stored row is not deleted or refreshed behind the
 * user's back — it is returned with `stale: true`. A score that changed while
 * someone was reading it is worse than one that admits it is out of date.
 *
 * **The revision tuple is the cache key.** Re-scoring an unchanged job against
 * an unchanged profile writes the same row rather than a second one, so a
 * user hammering "Check fit" cannot manufacture history. The uniqueness
 * constraint in `0003_matches.sql` enforces that, not this code.
 *
 * **Only confirmed facts leave the API.** The task input is built here, and it
 * carries confirmed facts only. Sending drafts would let an extraction guess
 * be scored as though the user had agreed to it.
 */
import {
  MATCH_ALGORITHM_VERSION,
  type MatchExplanation,
  type MatchJobInput,
  type MatchJobResult,
  type MatchSummary,
  type MatchView,
  type Preferences,
  type ProfileFact,
} from '@job-getter/contracts';
import type { DbTransaction } from '../db/pool.js';
import type { JobRow, MatchRow, TaskRow } from '../db/types.js';
import type { WorkspaceScope } from '../auth/scope.js';
import { notFound } from '../errors.js';

/** The revisions a stored match is compared against to decide staleness. */
export interface MatchInputs {
  readonly jobRevision: number;
  readonly profileRevision: number;
  readonly preferencesRevision: number;
}

export interface MatchContext {
  readonly inputs: MatchInputs;
  readonly preferences: Preferences;
  readonly confirmedFacts: ProfileFact[];
  readonly locale: 'en' | 'es';
}

function toProfileFact(row: Record<string, unknown>): ProfileFact {
  return {
    id: row.id as string,
    kind: row.kind as ProfileFact['kind'],
    value: row.value,
    source_file_id: (row.source_file_id as string | null) ?? null,
    source_excerpt: (row.source_excerpt as string | null) ?? null,
    confirmed: row.confirmed as boolean,
    revision: row.revision as number,
    supersedes_id: (row.supersedes_id as string | null) ?? null,
    created_at: (row.created_at as Date).toISOString(),
    updated_at: (row.updated_at as Date).toISOString(),
  };
}

/**
 * Read everything a score depends on, in one place.
 *
 * A workspace with no profile row yet still has a revision: profile revision 1
 * with no facts. That scores nothing rather than failing, and the explanation
 * says why — "the profile states nothing" is a useful answer, and an error
 * page is not.
 */
export async function readMatchContext(
  scope: WorkspaceScope,
  preferences: Preferences,
): Promise<
  Omit<MatchContext, 'inputs'> & { profileRevision: number; preferencesRevision: number }
> {
  const [profile, preferencesRow, factRows] = await Promise.all([
    scope.selectFrom('profiles').select(['revision', 'locale']).executeTakeFirst(),
    scope.selectFrom('preferences').select(['revision']).executeTakeFirst(),
    scope
      .selectFrom('profile_facts')
      .selectAll()
      .where('confirmed', '=', true)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .execute(),
  ]);

  return {
    profileRevision: profile?.revision ?? 1,
    preferencesRevision: preferencesRow?.revision ?? 1,
    preferences,
    locale: (profile?.locale as 'en' | 'es' | undefined) ?? 'en',
    confirmedFacts: factRows.map((row) => toProfileFact(row as Record<string, unknown>)),
  };
}

/** Build the task snapshot. The worker never reads the database. */
export function buildMatchInput(
  job: JobRow,
  context: Omit<MatchContext, 'inputs'> & {
    profileRevision: number;
    preferencesRevision: number;
  },
): MatchJobInput {
  return {
    job_id: job.id,
    job_revision: job.revision,
    profile_revision: context.profileRevision,
    preferences_revision: context.preferencesRevision,
    locale: context.locale,
    job: {
      company: job.company,
      title: job.title,
      description_text: job.description_text,
      locations: (job.locations as MatchJobInput['job']['locations'] | null) ?? [],
      remote_type: job.remote_type,
      eligible_countries: (job.eligible_countries as string[] | null) ?? null,
      employment_type: job.employment_type,
      salary: (job.salary as MatchJobInput['job']['salary'] | null) ?? null,
      language: job.language,
      requirements: (job.requirements as MatchJobInput['job']['requirements'] | null) ?? [],
    },
    confirmed_facts: context.confirmedFacts,
    preferences: context.preferences,
  };
}

/**
 * Persist a completed `match_job` result.
 *
 * Upsert on the revision tuple: scoring the same inputs twice replaces the row
 * instead of adding one. If the job changed while the task was in flight, the
 * result lands against the revision it actually scored, and the job's current
 * revision then makes it read as stale — which is exactly true.
 */
export async function applyMatchJobResult(
  trx: DbTransaction,
  task: TaskRow,
  result: MatchJobResult,
): Promise<void> {
  const input = task.payload as MatchJobInput;
  await trx
    .insertInto('matches')
    .values({
      workspace_id: task.workspace_id,
      job_id: input.job_id,
      job_revision: input.job_revision,
      profile_revision: input.profile_revision,
      preferences_revision: input.preferences_revision,
      algorithm_version: result.explanation.algorithm_version,
      eligible: result.eligible,
      score: result.score,
      coverage_percent: result.coverage_percent,
      explanation: JSON.stringify(result.explanation),
      computed_at: new Date(result.computed_at),
    })
    .onConflict((builder) =>
      builder.constraint('matches_revision_tuple_key').doUpdateSet({
        eligible: result.eligible,
        score: result.score,
        coverage_percent: result.coverage_percent,
        explanation: JSON.stringify(result.explanation),
        computed_at: new Date(result.computed_at),
        updated_at: new Date(),
      }),
    )
    .execute();
}

function isStale(row: MatchRow, inputs: MatchInputs): boolean {
  return (
    row.job_revision !== inputs.jobRevision ||
    row.profile_revision !== inputs.profileRevision ||
    row.preferences_revision !== inputs.preferencesRevision ||
    row.algorithm_version !== MATCH_ALGORITHM_VERSION
  );
}

export function toMatchSummary(row: MatchRow, inputs: MatchInputs): MatchSummary {
  return {
    match_id: row.id,
    eligible: row.eligible,
    score: row.score,
    coverage_percent: row.coverage_percent,
    algorithm_version: row.algorithm_version,
    stale: isStale(row, inputs),
    computed_at: row.computed_at.toISOString(),
  };
}

export function toMatchView(row: MatchRow, inputs: MatchInputs): MatchView {
  return {
    id: row.id,
    job_id: row.job_id,
    job_revision: row.job_revision,
    profile_revision: row.profile_revision,
    preferences_revision: row.preferences_revision,
    algorithm_version: row.algorithm_version,
    eligible: row.eligible,
    score: row.score,
    coverage_percent: row.coverage_percent,
    stale: isStale(row, inputs),
    explanation: row.explanation as MatchExplanation,
    computed_at: row.computed_at.toISOString(),
  };
}

/**
 * The newest match per job, for a page of jobs.
 *
 * "Newest" rather than "matching the current revisions" on purpose: a stale
 * score that is visibly stale is more useful than no score, and hiding it
 * would make the list look unscored when it is not.
 */
export async function latestMatchesFor(
  scope: WorkspaceScope,
  jobIds: readonly string[],
): Promise<Map<string, MatchRow>> {
  const byJob = new Map<string, MatchRow>();
  if (jobIds.length === 0) return byJob;
  const rows = (await scope
    .selectFrom('matches')
    .selectAll()
    .where('job_id', 'in', [...jobIds])
    .orderBy('computed_at', 'desc')
    .orderBy('id', 'desc')
    .execute()) as MatchRow[];
  for (const row of rows) {
    if (!byJob.has(row.job_id)) byJob.set(row.job_id, row);
  }
  return byJob;
}

export async function latestMatchFor(
  scope: WorkspaceScope,
  jobId: string,
): Promise<MatchRow | null> {
  const row = await scope
    .selectFrom('matches')
    .selectAll()
    .where('job_id', '=', jobId)
    .orderBy('computed_at', 'desc')
    .orderBy('id', 'desc')
    .executeTakeFirst();
  return (row as MatchRow | undefined) ?? null;
}

export async function requireJob(scope: WorkspaceScope, id: string): Promise<JobRow> {
  const row = await scope.selectFrom('jobs').selectAll().where('id', '=', id).executeTakeFirst();
  if (!row) throw notFound('No such job.');
  return row as JobRow;
}
