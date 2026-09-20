/**
 * Hand-written Kysely database interface mirroring
 * `src/db/migrations/0001_foundation.sql` and `0002_discovery.sql`.
 *
 * kysely-codegen is deliberately not used (it is not a dependency); the price
 * is that this file must be updated alongside every migration. The integration
 * tests run against the real schema, so a mismatch surfaces immediately rather
 * than at runtime in production.
 *
 * jsonb columns are typed `JsonColumn`: reading yields the parsed value (pg
 * parses jsonb for us), while writing requires a JSON string. That asymmetry
 * is intentional — it makes `JSON.stringify` at the call site mandatory and
 * stops an object being sent as a Postgres record literal by accident.
 */
import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';
import type {
  ConnectorId,
  JobEmploymentType,
  JobStatus,
  RemoteType,
  ScanStatus,
  SourceHealthState,
  TaskState,
  TaskType,
} from '@job-getter/contracts';

/** jsonb: select as parsed value, insert/update as a JSON string. */
export type JsonColumn<Read = unknown> = ColumnType<Read, string, string>;
/** Nullable jsonb. */
export type NullableJsonColumn<Read = unknown> = ColumnType<
  Read | null,
  string | null,
  string | null
>;
/** jsonb with a SQL DEFAULT: optional on insert, still a JSON string when given. */
export type DefaultedJsonColumn<Read = unknown> = ColumnType<Read, string | undefined, string>;

/** timestamptz: read as Date, written as Date or SQL expression. */
export type TimestampColumn = ColumnType<Date, Date | string | undefined, Date | string>;
export type NullableTimestampColumn = ColumnType<
  Date | null,
  Date | string | null | undefined,
  Date | string | null
>;

export interface SystemFlagsTable {
  key: string;
  value: DefaultedJsonColumn<Record<string, unknown>>;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface UsersTable {
  id: Generated<string>;
  normalized_email: string;
  email: string;
  password_hash: string;
  verified_at: NullableTimestampColumn;
  disabled_at: NullableTimestampColumn;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface WorkspacesTable {
  id: Generated<string>;
  owner_user_id: string;
  mode: 'local' | 'hosted';
  locale: Generated<'en' | 'es'>;
  deletion_state: Generated<'active' | 'deleting' | 'deleted'>;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface WorkerRegistrationsTable {
  worker_id: string;
  workspace_id: string | null;
  kind: Generated<'worker' | 'device'>;
  capabilities: DefaultedJsonColumn<string[]>;
  protocol_version: number;
  last_seen_at: TimestampColumn;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface MembershipsTable {
  id: Generated<string>;
  workspace_id: string;
  user_id: string;
  role: 'owner';
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface SessionsTable {
  id: Generated<string>;
  token_hash: string;
  user_id: string;
  workspace_id: string;
  expires_at: TimestampColumn;
  revoked_at: NullableTimestampColumn;
  last_seen_at: TimestampColumn;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export type FileState = 'staging' | 'ready' | 'deleting';
export type FilePurposeColumn =
  'cv_original' | 'profile_text' | 'generated_cv' | 'export' | 'evidence';

export interface FilesTable {
  id: Generated<string>;
  workspace_id: string;
  storage_key: string;
  original_name: string;
  mime: string;
  bytes: ColumnType<string, number | string, number | string>;
  sha256: string;
  state: Generated<FileState>;
  purpose: FilePurposeColumn;
  expires_at: NullableTimestampColumn;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface TasksTable {
  id: Generated<string>;
  workspace_id: string;
  type: TaskType;
  state: Generated<TaskState>;
  payload: DefaultedJsonColumn;
  result: NullableJsonColumn;
  idempotency_key: string | null;
  attempt: Generated<number>;
  max_attempts: Generated<number>;
  run_after: TimestampColumn;
  lease_token_hash: string | null;
  lease_expires_at: NullableTimestampColumn;
  leased_by: string | null;
  last_heartbeat_at: NullableTimestampColumn;
  capability: string;
  progress: NullableJsonColumn;
  cancel_requested: Generated<boolean>;
  error_code: string | null;
  error_message: string | null;
  error_retryable: boolean | null;
  input_file_ids: Generated<string[]>;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface TaskArtifactsTable {
  id: Generated<string>;
  workspace_id: string;
  task_id: string;
  file_id: string;
  lease_token_hash: string;
  committed: Generated<boolean>;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface IdempotencyRecordsTable {
  id: Generated<string>;
  workspace_id: string;
  route_key: string;
  idempotency_key: string;
  request_hash: string;
  response_status: number;
  response_body: JsonColumn;
  expires_at: TimestampColumn;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

/** Append-only: `occurred_at` only, no `updated_at`. */
export interface AuditEventsTable {
  id: Generated<string>;
  workspace_id: string;
  actor_id: string | null;
  action: string;
  object_id: string | null;
  object_type: string | null;
  metadata: DefaultedJsonColumn<Record<string, unknown>>;
  occurred_at: TimestampColumn;
}

export interface ProfilesTable {
  id: Generated<string>;
  workspace_id: string;
  revision: Generated<number>;
  confirmed_revision: number | null;
  contact: NullableJsonColumn;
  locale: Generated<'en' | 'es'>;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface ProfileFactsTable {
  id: Generated<string>;
  workspace_id: string;
  profile_id: string;
  kind: string;
  value: JsonColumn;
  source_file_id: string | null;
  source_excerpt: string | null;
  confirmed: Generated<boolean>;
  revision: number;
  supersedes_id: string | null;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface PreferencesTable {
  id: Generated<string>;
  workspace_id: string;
  revision: Generated<number>;
  config: JsonColumn;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface ProfileImportsTable {
  id: Generated<string>;
  workspace_id: string;
  file_id: string | null;
  text_file_id: string | null;
  task_id: string | null;
  status: Generated<'queued' | 'parsing' | 'ready_for_review' | 'confirmed' | 'failed'>;
  format_hint: Generated<string>;
  extracted_draft: NullableJsonColumn;
  warnings: DefaultedJsonColumn;
  error_code: string | null;
  error_message: string | null;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface ProviderSettingsTable {
  id: Generated<string>;
  workspace_id: string;
  provider: Generated<string>;
  base_url: string | null;
  model: Generated<string>;
  secret_ciphertext: Buffer | null;
  daily_budget: string | null;
  validated_config: DefaultedJsonColumn;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface UsageLedgerTable {
  id: Generated<string>;
  workspace_id: string;
  task_id: string | null;
  provider: string;
  input_tokens: Generated<number>;
  output_tokens: Generated<number>;
  measured_cost: string | null;
  reserved_cost: string | null;
  currency: string | null;
  status: Generated<'reserved' | 'settled' | 'released'>;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

// ---------------------------------------------------------------------------
// Milestone M2 (0002_discovery.sql)
// ---------------------------------------------------------------------------

export interface SourcesTable {
  id: Generated<string>;
  workspace_id: string;
  connector: Extract<ConnectorId, 'greenhouse' | 'lever'>;
  connector_version: string;
  board_key: string;
  base_url: string | null;
  enabled: Generated<boolean>;
  last_success_at: NullableTimestampColumn;
  last_scan_id: string | null;
  next_scan_after: NullableTimestampColumn;
  health_state: Generated<SourceHealthState>;
  consecutive_failures: Generated<number>;
  consecutive_denials: Generated<number>;
  last_error_code: string | null;
  last_error_at: NullableTimestampColumn;
  health_detail: string | null;
  etag: string | null;
  last_modified: string | null;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface ScansTable {
  id: Generated<string>;
  workspace_id: string;
  source_id: string;
  task_id: string | null;
  status: Generated<ScanStatus>;
  complete_snapshot: Generated<boolean>;
  counts: DefaultedJsonColumn;
  error_code: string | null;
  error_message: string | null;
  started_at: NullableTimestampColumn;
  completed_at: NullableTimestampColumn;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export type JobClosedReason = 'user' | 'snapshot' | 'source';

export interface JobsTable {
  id: Generated<string>;
  workspace_id: string;
  canonical_key: string;
  company: string;
  title: string;
  description_text: string;
  locations: DefaultedJsonColumn;
  salary: NullableJsonColumn;
  requirements: DefaultedJsonColumn;
  inferred: DefaultedJsonColumn;
  remote_type: Generated<RemoteType>;
  eligible_countries: NullableJsonColumn;
  employment_type: JobEmploymentType | null;
  language: string | null;
  status: Generated<JobStatus>;
  content_hash: string;
  revision: Generated<number>;
  published_at: NullableTimestampColumn;
  source_updated_at: NullableTimestampColumn;
  first_seen_at: TimestampColumn;
  last_seen_at: TimestampColumn;
  last_fetched_at: NullableTimestampColumn;
  saved: Generated<boolean>;
  excluded_reason: string | null;
  closed_at: NullableTimestampColumn;
  closed_reason: JobClosedReason | null;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface JobSourcesTable {
  id: Generated<string>;
  workspace_id: string;
  job_id: string;
  source_id: string | null;
  connector: ConnectorId;
  external_id: string;
  source_key: string;
  canonical_url: string;
  apply_url: string | null;
  retrieved_at: TimestampColumn;
  missing_snapshots: Generated<number>;
  missing_since: NullableTimestampColumn;
  last_missing_at: NullableTimestampColumn;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface JobImportsTable {
  id: Generated<string>;
  workspace_id: string;
  task_id: string | null;
  status: Generated<'queued' | 'resolved' | 'needs_choice' | 'failed'>;
  input: DefaultedJsonColumn;
  job_id: string | null;
  candidates: DefaultedJsonColumn;
  warnings: DefaultedJsonColumn;
  error_code: string | null;
  error_message: string | null;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface SchemaMigrationsTable {
  name: string;
  checksum: string;
  applied_at: TimestampColumn;
}

export interface Database {
  system_flags: SystemFlagsTable;
  users: UsersTable;
  workspaces: WorkspacesTable;
  worker_registrations: WorkerRegistrationsTable;
  memberships: MembershipsTable;
  sessions: SessionsTable;
  files: FilesTable;
  tasks: TasksTable;
  task_artifacts: TaskArtifactsTable;
  idempotency_records: IdempotencyRecordsTable;
  audit_events: AuditEventsTable;
  profiles: ProfilesTable;
  profile_facts: ProfileFactsTable;
  preferences: PreferencesTable;
  profile_imports: ProfileImportsTable;
  provider_settings: ProviderSettingsTable;
  usage_ledger: UsageLedgerTable;
  sources: SourcesTable;
  scans: ScansTable;
  jobs: JobsTable;
  job_sources: JobSourcesTable;
  job_imports: JobImportsTable;
  schema_migrations: SchemaMigrationsTable;
}

/**
 * Tables that hold private, workspace-owned data. `src/auth/scope.ts` only
 * accepts these names, which is what makes an unscoped query on private data
 * a type error rather than a security incident.
 *
 * `users`, `workspaces`, `system_flags`, `worker_registrations` and
 * `schema_migrations` are deliberately absent: they are either operator-global
 * or the scope root itself.
 */
export const WORKSPACE_SCOPED_TABLES = [
  'memberships',
  'sessions',
  'files',
  'tasks',
  'task_artifacts',
  'idempotency_records',
  'audit_events',
  'profiles',
  'profile_facts',
  'preferences',
  'profile_imports',
  'provider_settings',
  'usage_ledger',
  'sources',
  'scans',
  'jobs',
  'job_sources',
  'job_imports',
] as const;

export type WorkspaceScopedTable = (typeof WORKSPACE_SCOPED_TABLES)[number];

/**
 * Tables that are operator infrastructure rather than user data.
 *
 * They are excluded from workspace export ("Export includes profile,
 * preferences, job records, submitted CVs, answer bank and application
 * history") and from workspace deletion ("Delete cascades private domain
 * rows") — 09_SECURITY_PRIVACY.md. Exporting them would hand the user
 * operational records that are not theirs; cascading them on delete would
 * destroy the operator's record of running infrastructure.
 *
 * M6 implements `export_workspace` and `delete_workspace`; this list is here
 * so that agent inherits the classification instead of re-deciding it. The
 * same classification is recorded on the tables themselves via COMMENT ON
 * TABLE, and `tests/db/schema.test.ts` asserts the two agree.
 */
export const OPERATOR_GLOBAL_TABLES = [
  'system_flags',
  'worker_registrations',
  'schema_migrations',
] as const;

export type OperatorGlobalTable = (typeof OPERATOR_GLOBAL_TABLES)[number];

export type TaskRow = Selectable<TasksTable>;
export type NewTaskRow = Insertable<TasksTable>;
export type TaskUpdate = Updateable<TasksTable>;
export type FileRow = Selectable<FilesTable>;
export type UserRow = Selectable<UsersTable>;
export type WorkspaceRow = Selectable<WorkspacesTable>;
export type SessionRow = Selectable<SessionsTable>;
export type SourceRow = Selectable<SourcesTable>;
export type ScanRow = Selectable<ScansTable>;
export type JobRow = Selectable<JobsTable>;
export type JobSourceRow = Selectable<JobSourcesTable>;
export type JobImportRow = Selectable<JobImportsTable>;
