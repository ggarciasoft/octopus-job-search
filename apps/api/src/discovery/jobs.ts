/**
 * Jobs: deduplicated write path and the read model.
 *
 * 03_DATA_MODEL.md, "Deduplication":
 *
 *   "Canonical key is connector + board + external job ID when available;
 *    otherwise normalized employer job URL. Across different sources, link
 *    only when the final application URL or verified requisition identity
 *    matches. Similar title/location alone creates a possible-duplicate
 *    warning, not an automatic merge. Preserve provenance."
 *
 * `upsertNormalizedJob` is the single write path for a `NormalizedJob`,
 * whether it arrived through a board scan or a one-off import, so the two
 * cannot apply different identity rules. It never merges on similarity: the
 * lookup order is (1) the same connector identity, (2) the same canonical
 * key, (3) an identical application URL, (4) the same requisition on the
 * same board connector — and otherwise a new job. Similarity is computed on
 * read by `possibleDuplicatesFor` and reported, never acted on.
 */
import { sql } from 'kysely';
import type {
  ConnectorId,
  InferredField,
  JobDetailView,
  JobLocation,
  JobRequirement,
  JobSalary,
  JobSourceView,
  JobView,
  NormalizedJob,
  PossibleDuplicate,
  Preferences,
} from '@job-getter/contracts';
import type { JobRow, JobSourceRow } from '../db/types.js';
import type { WorkspaceScope } from '../auth/scope.js';
import { canonicalKeyFor, isBoardConnector, type JobOrigin } from './connectors.js';

// ---------------------------------------------------------------------------
// Write path
// ---------------------------------------------------------------------------

export type LinkReason =
  'same_source_key' | 'same_canonical_key' | 'same_apply_url' | 'same_requisition';

export interface UpsertOutcome {
  readonly jobId: string;
  readonly created: boolean;
  /** Content changed and the revision was bumped. */
  readonly updated: boolean;
  /** Reopened after a snapshot closure. */
  readonly reopened: boolean;
  readonly linkedBy: LinkReason | null;
}

interface ExistingJob {
  readonly id: string;
  readonly content_hash: string;
  readonly status: string;
  readonly closed_reason: string | null;
  readonly linkedBy: LinkReason;
}

async function findExistingJob(
  scope: WorkspaceScope,
  job: NormalizedJob,
  canonicalKey: string,
  origin: JobOrigin,
): Promise<ExistingJob | null> {
  const columns = ['id', 'content_hash', 'status', 'closed_reason'] as const;

  const byProvenance = await scope
    .selectFrom('job_sources')
    .select('job_id')
    .where('source_key', '=', job.source_key)
    .executeTakeFirst();
  if (byProvenance) {
    const row = await scope
      .selectFrom('jobs')
      .select(columns)
      .where('id', '=', byProvenance.job_id)
      .executeTakeFirst();
    if (row) return { ...row, linkedBy: 'same_source_key' };
  }

  const byKey = await scope
    .selectFrom('jobs')
    .select(columns)
    .where('canonical_key', '=', canonicalKey)
    .executeTakeFirst();
  if (byKey) return { ...byKey, linkedBy: 'same_canonical_key' };

  // Cross-source linking, rule 1: the final application URL is identical.
  if (job.apply_url !== null && job.apply_url.trim() !== '') {
    const byApplyUrl = await scope
      .selectFrom('job_sources')
      .select('job_id')
      .where('apply_url', '=', job.apply_url)
      .orderBy('created_at', 'asc')
      .executeTakeFirst();
    if (byApplyUrl) {
      const row = await scope
        .selectFrom('jobs')
        .select(columns)
        .where('id', '=', byApplyUrl.job_id)
        .executeTakeFirst();
      if (row) return { ...row, linkedBy: 'same_apply_url' };
    }
  }

  // Cross-source linking, rule 2: a verified requisition identity. A board
  // connector's external id is the ATS's own requisition id, so the same id
  // on the same connector — even through a different board — is the same
  // requisition. Manual and URL imports carry no such identity.
  if (isBoardConnector(origin.connector)) {
    const byRequisition = await scope
      .selectFrom('job_sources')
      .select('job_id')
      .where('connector', '=', origin.connector)
      .where('external_id', '=', job.external_id)
      .orderBy('created_at', 'asc')
      .executeTakeFirst();
    if (byRequisition) {
      const row = await scope
        .selectFrom('jobs')
        .select(columns)
        .where('id', '=', byRequisition.job_id)
        .executeTakeFirst();
      if (row) return { ...row, linkedBy: 'same_requisition' };
    }
  }

  return null;
}

function contentColumns(job: NormalizedJob) {
  return {
    company: job.company,
    title: job.title,
    description_text: job.description_text,
    locations: JSON.stringify(job.locations),
    // Stored exactly as stated, null included: nothing is defaulted (AT07/AT08).
    salary: job.salary === null ? null : JSON.stringify(job.salary),
    requirements: JSON.stringify(job.requirements),
    inferred: JSON.stringify(job.inferred),
    remote_type: job.remote_type,
    eligible_countries:
      job.eligible_countries === null ? null : JSON.stringify(job.eligible_countries),
    employment_type: job.employment_type,
    language: job.language,
    content_hash: job.content_hash,
    // Never invented: null stays null.
    published_at: job.published_at === null ? null : new Date(job.published_at),
    source_updated_at: job.updated_at === null ? null : new Date(job.updated_at),
  };
}

/**
 * Applies one normalised job inside the caller's transaction.
 *
 * `seenAt` is the snapshot time (the worker's `fetched_at`), which is what
 * `last_seen_at` records; `retrieved_at` on the job itself is when its content
 * was read and becomes `last_fetched_at`.
 */
export async function upsertNormalizedJob(
  scope: WorkspaceScope,
  job: NormalizedJob,
  origin: JobOrigin,
  seenAt: Date,
): Promise<UpsertOutcome> {
  const canonicalKey = canonicalKeyFor(job, origin);
  const retrievedAt = new Date(job.retrieved_at);
  const existing = await findExistingJob(scope, job, canonicalKey, origin);

  let jobId: string;
  let created = false;
  let updated = false;
  let reopened = false;

  if (existing === null) {
    const inserted = await scope
      .insertInto('jobs', {
        canonical_key: canonicalKey,
        ...contentColumns(job),
        status: 'active',
        revision: 1,
        first_seen_at: seenAt,
        last_seen_at: seenAt,
        last_fetched_at: retrievedAt,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    jobId = inserted.id;
    created = true;
  } else {
    jobId = existing.id;
    // A user's explicit closure is their decision and is not undone by the
    // board still listing the posting. Every other closure is an inference
    // from absence, and presence refutes it.
    const reopen = existing.status !== 'active' && existing.closed_reason !== 'user';
    reopened = reopen;
    const changed = existing.content_hash !== job.content_hash;
    updated = changed;

    await scope
      .updateTable('jobs')
      .set({
        ...(changed ? contentColumns(job) : {}),
        ...(changed ? { revision: sql<number>`revision + 1` } : {}),
        ...(reopen ? { status: 'active', closed_at: null, closed_reason: null } : {}),
        last_seen_at: sql<Date>`GREATEST(last_seen_at, ${seenAt})`,
        last_fetched_at: sql<Date | null>`GREATEST(COALESCE(last_fetched_at, ${retrievedAt}), ${retrievedAt})`,
        updated_at: new Date(),
      })
      .where('id', '=', jobId)
      .execute();
  }

  // Provenance: one row per connector identity, reattached to the current
  // source (a deleted-then-recreated board resumes its history) and reset
  // as "present" for the closure rule.
  await scope
    .insertInto('job_sources', {
      job_id: jobId,
      source_id: origin.sourceId,
      connector: origin.connector,
      external_id: job.external_id,
      source_key: job.source_key,
      canonical_url: job.canonical_url,
      apply_url: job.apply_url,
      retrieved_at: retrievedAt,
      missing_snapshots: 0,
      missing_since: null,
      last_missing_at: null,
    })
    .onConflict((builder) =>
      builder.columns(['workspace_id', 'source_key']).doUpdateSet({
        job_id: jobId,
        source_id: origin.sourceId,
        connector: origin.connector,
        external_id: job.external_id,
        canonical_url: job.canonical_url,
        apply_url: job.apply_url,
        retrieved_at: retrievedAt,
        missing_snapshots: 0,
        missing_since: null,
        last_missing_at: null,
        updated_at: new Date(),
      }),
    )
    .execute();

  return { jobId, created, updated, reopened, linkedBy: existing?.linkedBy ?? null };
}

// ---------------------------------------------------------------------------
// Read model
// ---------------------------------------------------------------------------

export function normalizeCompany(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * The SQL twins of `normalizeCompany`: case-folded, trimmed, inner whitespace
 * collapsed. `jobs_company_title_idx` is built on these exact expressions.
 */
const normalizedColumn = (qualified: string) =>
  sql<string>`lower(regexp_replace(btrim(${sql.ref(qualified)}), '\\s+', ' ', 'g'))`;
export const NORMALIZED_COMPANY_SQL = normalizedColumn('company');

export function excludedCompanies(preferences: Preferences): Set<string> {
  return new Set(preferences.excluded_companies.map(normalizeCompany));
}

export const EXCLUDED_COMPANY_REASON = 'Employer is in your excluded companies.';

function excludedReasonFor(row: JobRow, excluded: Set<string>): string | null {
  if (row.excluded_reason !== null) return row.excluded_reason;
  return excluded.has(normalizeCompany(row.company)) ? EXCLUDED_COMPANY_REASON : null;
}

function toJobSourceView(row: JobSourceRow): JobSourceView {
  return {
    id: row.id,
    source_id: row.source_id,
    connector: row.connector as ConnectorId,
    external_id: row.external_id,
    canonical_url: row.canonical_url,
    apply_url: row.apply_url,
    retrieved_at: row.retrieved_at.toISOString(),
  };
}

function locationSignatures(locations: unknown): Set<string> {
  const signatures = new Set<string>();
  if (!Array.isArray(locations)) return signatures;
  for (const entry of locations as JobLocation[]) {
    signatures.add(
      [entry.country ?? '', entry.region ?? '', entry.city ?? '']
        .map((part) => part.trim().toLowerCase())
        .join('|'),
    );
  }
  return signatures;
}

/** Same location set, or both without one: the "location" half of the rule. */
function locationsOverlap(left: unknown, right: unknown): boolean {
  const a = locationSignatures(left);
  const b = locationSignatures(right);
  if (a.size === 0 && b.size === 0) return true;
  for (const signature of a) if (b.has(signature)) return true;
  return false;
}

/**
 * Possible duplicates for a set of jobs, in one query.
 *
 * "Similar" is: same employer and same title after case and whitespace
 * normalisation, at an overlapping location. This is a *warning*: the two
 * rows stay separate, and the user decides. Different employers with the
 * same title are not reported — that is every "Software Engineer" posting
 * on every board, which would drown the real ones.
 */
export async function possibleDuplicatesFor(
  scope: WorkspaceScope,
  jobs: readonly JobRow[],
): Promise<Map<string, PossibleDuplicate[]>> {
  const result = new Map<string, PossibleDuplicate[]>();
  if (jobs.length === 0) return result;
  const byId = new Map(jobs.map((job) => [job.id, job]));

  const rows = await scope
    .selectFrom('jobs')
    .innerJoin('jobs as other', (join) =>
      join
        .onRef('other.workspace_id', '=', 'jobs.workspace_id')
        .on(normalizedColumn('other.company'), '=', normalizedColumn('jobs.company'))
        .on(normalizedColumn('other.title'), '=', normalizedColumn('jobs.title'))
        .onRef('other.id', '<>', 'jobs.id'),
    )
    .select([
      'jobs.id as job_id',
      'other.id as other_id',
      'other.title as other_title',
      'other.company as other_company',
      'other.locations as other_locations',
      'other.status as other_status',
    ])
    .where(
      'jobs.id',
      'in',
      jobs.map((job) => job.id),
    )
    .orderBy('other.first_seen_at', 'asc')
    .execute();

  for (const row of rows) {
    const job = byId.get(row.job_id);
    if (!job) continue;
    if (!locationsOverlap(job.locations, row.other_locations)) continue;
    const list = result.get(job.id) ?? [];
    list.push({
      job_id: row.other_id,
      reason: 'similar_title_and_location',
      detail:
        `"${row.other_title}" at ${row.other_company} (${row.other_status}) has the same title and location.`.slice(
          0,
          300,
        ),
    });
    result.set(job.id, list);
  }
  return result;
}

function baseView(
  row: JobRow,
  sources: readonly JobSourceRow[],
  duplicates: readonly PossibleDuplicate[],
  excluded: Set<string>,
): JobView {
  return {
    id: row.id,
    canonical_key: row.canonical_key,
    company: row.company,
    title: row.title,
    status: row.status,
    remote_type: row.remote_type,
    locations: (row.locations as JobLocation[] | null) ?? [],
    eligible_countries: (row.eligible_countries as string[] | null) ?? null,
    employment_type: row.employment_type,
    salary: (row.salary as JobSalary | null) ?? null,
    language: row.language,
    published_at: row.published_at === null ? null : row.published_at.toISOString(),
    first_seen_at: row.first_seen_at.toISOString(),
    last_seen_at: row.last_seen_at.toISOString(),
    last_fetched_at: row.last_fetched_at === null ? null : row.last_fetched_at.toISOString(),
    revision: row.revision,
    saved: row.saved,
    excluded_reason: excludedReasonFor(row, excluded),
    sources: sources.map(toJobSourceView),
    // M3 fills this in. Until then every job is "Not checked", never a score.
    match: null,
    possible_duplicates: [...duplicates],
  };
}

async function loadSources(
  scope: WorkspaceScope,
  jobIds: readonly string[],
): Promise<Map<string, JobSourceRow[]>> {
  const grouped = new Map<string, JobSourceRow[]>();
  if (jobIds.length === 0) return grouped;
  const rows = (await scope
    .selectFrom('job_sources')
    .selectAll()
    .where('job_id', 'in', [...jobIds])
    .orderBy('created_at', 'asc')
    .orderBy('id', 'asc')
    .execute()) as JobSourceRow[];
  for (const row of rows) {
    const list = grouped.get(row.job_id) ?? [];
    list.push(row);
    grouped.set(row.job_id, list);
  }
  return grouped;
}

/** Builds list views for a page of rows with two queries, not two per row. */
export async function buildJobViews(
  scope: WorkspaceScope,
  rows: readonly JobRow[],
  preferences: Preferences,
): Promise<JobView[]> {
  const ids = rows.map((row) => row.id);
  const [sources, duplicates] = await Promise.all([
    loadSources(scope, ids),
    possibleDuplicatesFor(scope, rows),
  ]);
  const excluded = excludedCompanies(preferences);
  return rows.map((row) =>
    baseView(row, sources.get(row.id) ?? [], duplicates.get(row.id) ?? [], excluded),
  );
}

export async function buildJobDetailView(
  scope: WorkspaceScope,
  row: JobRow,
  preferences: Preferences,
): Promise<JobDetailView> {
  const [view] = await buildJobViews(scope, [row], preferences);
  return {
    ...(view as JobView),
    description_text: row.description_text,
    requirements: (row.requirements as JobRequirement[] | null) ?? [],
    inferred: (row.inferred as InferredField[] | null) ?? [],
    content_hash: row.content_hash,
  };
}
