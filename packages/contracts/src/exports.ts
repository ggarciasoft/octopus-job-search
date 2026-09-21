import type { TSchema } from '@sinclair/typebox';
import * as Auth from './schemas/auth.js';
import * as Common from './common.js';
import * as Files from './schemas/files.js';
import * as Preferences from './schemas/preferences.js';
import * as Profile from './schemas/profile.js';
import * as Providers from './schemas/providers.js';
import * as Jobs from './schemas/jobs.js';
import * as Matches from './schemas/matches.js';
import * as MatchJob from './tasks/match-job.js';
import * as Requirements from './schemas/requirements.js';
import * as FetchBoard from './tasks/fetch-board.js';
import * as NoopEcho from './tasks/noop-echo.js';
import * as ParseProfile from './tasks/parse-profile.js';
import * as Protocol from './tasks/protocol.js';
import * as Registry from './tasks/registry.js';

/**
 * Closed input/output schema pair for every implemented task type. The API
 * validates a worker result against the `result` schema inside the completing
 * transaction, so a malformed result can never reach domain state.
 */
export const TASK_IO_SCHEMAS: Record<string, { input: TSchema; output: TSchema }> = {
  noop_echo: { input: NoopEcho.NoopEchoInput, output: NoopEcho.NoopEchoResult },
  parse_profile: { input: ParseProfile.ParseProfileInput, output: ParseProfile.ParseProfileResult },
  fetch_board: { input: FetchBoard.FetchBoardInput, output: FetchBoard.FetchBoardResult },
  fetch_job: { input: FetchBoard.FetchJobInput, output: FetchBoard.FetchJobResult },
  match_job: { input: MatchJob.MatchJobInput, output: MatchJob.MatchJobResult },
};

/**
 * Named schemas emitted as standalone JSON Schema documents and as Pydantic
 * models for the Python worker. The key becomes the file and model name.
 */
export const EXPORTED_SCHEMAS: Record<string, TSchema> = {
  ErrorEnvelope: Common.ErrorEnvelope,
  AcceptedResponse: Common.AcceptedResponse,

  SetupRequest: Auth.SetupRequest,
  LoginRequest: Auth.LoginRequest,
  RegisterRequest: Auth.RegisterRequest,
  SetupStatus: Auth.SetupStatus,
  Capabilities: Auth.Capabilities,
  UsageSummary: Auth.UsageSummary,
  MeResponse: Auth.MeResponse,

  FileValidation: Files.FileValidation,
  FileView: Files.FileView,
  FileUploadResponse: Files.FileUploadResponse,

  ContactValue: Profile.ContactValue,
  // Named so the generator reuses one model everywhere a bullet appears
  // (experience and projects) instead of emitting a nested duplicate.
  ExperienceBullet: Profile.ExperienceBullet,
  SummaryValue: Profile.SummaryValue,
  ExperienceValue: Profile.ExperienceValue,
  EducationValue: Profile.EducationValue,
  SkillValue: Profile.SkillValue,
  LanguageValue: Profile.LanguageValue,
  AuthorizationValue: Profile.AuthorizationValue,
  ProjectValue: Profile.ProjectValue,
  CertificationValue: Profile.CertificationValue,
  ProfileFact: Profile.ProfileFact,
  Profile: Profile.Profile,
  ProfilePatchRequest: Profile.ProfilePatchRequest,

  Preferences: Preferences.Preferences,
  PreferencesView: Preferences.PreferencesView,
  PreferencesPutRequest: Preferences.PreferencesPutRequest,
  MatchWeights: Preferences.MatchWeights,
  OperationalLimits: Preferences.OperationalLimits,

  ProviderLimits: Providers.ProviderLimits,
  RateCard: Providers.RateCard,
  ProviderSettingsView: Providers.ProviderSettingsView,
  ProviderSettingsPutRequest: Providers.ProviderSettingsPutRequest,
  ProviderTestResult: Providers.ProviderTestResult,
  UsageLedgerEntry: Providers.UsageLedgerEntry,

  ClaimRequest: Protocol.ClaimRequest,
  ClaimResponse: Protocol.ClaimResponse,
  TaskInputFile: Protocol.TaskInputFile,
  HeartbeatRequest: Protocol.HeartbeatRequest,
  HeartbeatResponse: Protocol.HeartbeatResponse,
  CompleteRequest: Protocol.CompleteRequest,
  FailRequest: Protocol.FailRequest,
  TaskAck: Protocol.TaskAck,
  ArtifactUploadResponse: Protocol.ArtifactUploadResponse,
  TaskView: Protocol.TaskView,
  TaskProgress: Registry.TaskProgress,

  NoopEchoInput: NoopEcho.NoopEchoInput,
  NoopEchoResult: NoopEcho.NoopEchoResult,
  ParseProfileInput: ParseProfile.ParseProfileInput,
  ParseProfileResult: ParseProfile.ParseProfileResult,
  DraftFact: ParseProfile.DraftFact,
  // Exported under a qualified name: a Python model called
  // `ImportWarning` would shadow the builtin of that name.
  ProfileImportWarning: ParseProfile.ImportWarning,
  ProfileImportView: ParseProfile.ProfileImportView,
  CreateProfileImportRequest: ParseProfile.CreateProfileImportRequest,
  ConfirmImportRequest: ParseProfile.ConfirmImportRequest,

  // --- M2 discovery ---
  JobLocation: Jobs.JobLocation,
  JobSalary: Jobs.JobSalary,
  JobRequirement: Requirements.JobRequirement,
  InferredField: Jobs.InferredField,
  NormalizedJob: Jobs.NormalizedJob,
  SourceHealth: Jobs.SourceHealth,
  SourceView: Jobs.SourceView,
  CreateSourceRequest: Jobs.CreateSourceRequest,
  PatchSourceRequest: Jobs.PatchSourceRequest,
  ScanCounts: Jobs.ScanCounts,
  ScanView: Jobs.ScanView,
  JobSourceView: Jobs.JobSourceView,
  PossibleDuplicate: Jobs.PossibleDuplicate,
  MatchSummary: Matches.MatchSummary,
  JobView: Jobs.JobView,
  JobDetailView: Jobs.JobDetailView,
  JobsListQuery: Jobs.JobsListQuery,
  JobImportRequest: Jobs.JobImportRequest,
  PatchJobRequest: Jobs.PatchJobRequest,
  FetchLimits: FetchBoard.FetchLimits,
  FetchWarning: FetchBoard.FetchWarning,
  FetchBoardInput: FetchBoard.FetchBoardInput,
  FetchBoardResult: FetchBoard.FetchBoardResult,
  FetchJobInput: FetchBoard.FetchJobInput,
  FetchJobResult: FetchBoard.FetchJobResult,

  MatchEvidence: Matches.MatchEvidence,
  MatchComponent: Matches.MatchComponent,
  EligibilityCheck: Matches.EligibilityCheck,
  MatchedRequirement: Matches.MatchedRequirement,
  MatchExplanation: Matches.MatchExplanation,
  MatchView: Matches.MatchView,
  MatchJobSnapshot: MatchJob.MatchJobSnapshot,
  MatchJobInput: MatchJob.MatchJobInput,
  MatchJobResult: MatchJob.MatchJobResult,
};

/** Enumerations mirrored into Python so there is one source of truth. */
export const EXPORTED_ENUMS: Record<string, readonly string[]> = {
  TaskType: Registry.ALL_TASK_TYPES,
  TaskState: Registry.ALL_TASK_STATES,
  FactKind: Profile.ALL_FACT_KINDS,
  EmploymentType: Profile.ALL_EMPLOYMENT_TYPES,
  FilePurpose: Files.ALL_FILE_PURPOSES,
  ProviderId: Providers.ALL_PROVIDER_IDS,
  ConnectorId: Jobs.ALL_CONNECTOR_IDS,
  JobStatus: Jobs.ALL_JOB_STATUSES,
  RequirementKind: Requirements.ALL_REQUIREMENT_KINDS,
  MatchComponentKey: Matches.ALL_MATCH_COMPONENT_KEYS,
  MatchUnknownCode: Matches.ALL_MATCH_UNKNOWN_CODES,
  EligibilityFilter: Matches.ALL_ELIGIBILITY_FILTERS,
  EligibilityCode: Matches.ALL_ELIGIBILITY_CODES,
};

/** Shared numeric constants that must not diverge between runtimes. */
export const EXPORTED_CONSTANTS = {
  PROTOCOL_VERSION: Protocol.PROTOCOL_VERSION,
  INPUT_SCHEMA_VERSION: Protocol.INPUT_SCHEMA_VERSION,
  RESULT_SCHEMA_VERSION: Protocol.RESULT_SCHEMA_VERSION,
  LEASE_SECONDS: Registry.LEASE_SECONDS,
  HEARTBEAT_SECONDS: Registry.HEARTBEAT_SECONDS,
  DEFAULT_MAX_ATTEMPTS: Registry.DEFAULT_MAX_ATTEMPTS,
  ARTIFACT_STAGING_TTL_HOURS: Registry.ARTIFACT_STAGING_TTL_HOURS,
  SETTINGS_VERSION: Preferences.SETTINGS_VERSION,
  MAX_UPLOAD_BYTES: Files.MAX_UPLOAD_BYTES,
  IMPLEMENTED_TASK_TYPES: Registry.IMPLEMENTED_TASK_TYPES,
  RUNNER_ONLY_CAPABILITIES: Registry.RUNNER_ONLY_CAPABILITIES,
  NO_RETRY_TASK_TYPES: Registry.NO_RETRY_TASK_TYPES,
  MATCH_ALGORITHM_VERSION: Matches.MATCH_ALGORITHM_VERSION,
  SKILL_ALIAS_MAP_VERSION: Matches.SKILL_ALIAS_MAP_VERSION,
  SKILL_REQUIRED_WEIGHT: Matches.SKILL_REQUIRED_WEIGHT,
  SKILL_PREFERRED_WEIGHT: Matches.SKILL_PREFERRED_WEIGHT,
} as const;
