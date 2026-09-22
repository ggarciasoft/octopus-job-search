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
import * as RenderCv from './tasks/render-cv.js';
import * as Resumes from './schemas/resumes.js';
import * as Answers from './schemas/answers.js';
import * as Applications from './schemas/applications.js';
import * as Devices from './schemas/devices.js';
import * as FillLocal from './tasks/fill-local.js';
import * as ObserveConfirmation from './tasks/observe-confirmation.js';
import * as Workspace from './schemas/workspace.js';
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
  render_cv: { input: RenderCv.RenderCvInput, output: RenderCv.RenderCvResult },
  fill_local: { input: FillLocal.FillLocalInput, output: FillLocal.FillLocalResult },
  observe_confirmation: {
    input: ObserveConfirmation.ObserveConfirmationInput,
    output: ObserveConfirmation.ObserveConfirmationResult,
  },
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
  UsageReserveRequest: Protocol.UsageReserveRequest,
  UsageReserveResponse: Protocol.UsageReserveResponse,
  UsageSettleRequest: Protocol.UsageSettleRequest,
  UsageSettleResponse: Protocol.UsageSettleResponse,
  UsageReleaseRequest: Protocol.UsageReleaseRequest,
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

  ResumeContact: Resumes.ResumeContact,
  ResumeBullet: Resumes.ResumeBullet,
  ResumeEntry: Resumes.ResumeEntry,
  ResumeSection: Resumes.ResumeSection,
  ResumeDocument: Resumes.ResumeDocument,
  ResumeFinding: Resumes.ResumeFinding,
  ResumeProvenance: Resumes.ResumeProvenance,
  ResumeValidation: Resumes.ResumeValidation,
  ResumeView: Resumes.ResumeView,
  CreateResumeRequest: Resumes.CreateResumeRequest,
  ResumesListQuery: Resumes.ResumesListQuery,
  RenderCvInput: RenderCv.RenderCvInput,
  RenderCvResult: RenderCv.RenderCvResult,

  // --- M4 applications ---
  AnswerBankEntry: Answers.AnswerBankEntry,
  AnswerBankPutRequest: Answers.AnswerBankPutRequest,
  AnswerBankListQuery: Answers.AnswerBankListQuery,
  PacketAnswer: Applications.PacketAnswer,
  PacketDestination: Applications.PacketDestination,
  PacketHashMaterial: Applications.PacketHashMaterial,
  ApplicationPacketView: Applications.ApplicationPacketView,
  ApplicationEventView: Applications.ApplicationEventView,
  SubmissionEvidence: Applications.SubmissionEvidence,
  ApplicationView: Applications.ApplicationView,
  CreateApplicationRequest: Applications.CreateApplicationRequest,
  CreatePacketRequest: Applications.CreatePacketRequest,
  ApproveApplicationRequest: Applications.ApproveApplicationRequest,
  ApplicationOutcomeRequest: Applications.ApplicationOutcomeRequest,
  ApplicationsListQuery: Applications.ApplicationsListQuery,
  DeviceView: Devices.DeviceView,
  CreatePairingRequest: Devices.CreatePairingRequest,
  PairingCodeResponse: Devices.PairingCodeResponse,
  DeviceExchangeRequest: Devices.DeviceExchangeRequest,
  DeviceExchangeResponse: Devices.DeviceExchangeResponse,
  FillField: FillLocal.FillField,
  FillJobIdentity: FillLocal.FillJobIdentity,
  FillLocalInput: FillLocal.FillLocalInput,
  FilledField: FillLocal.FilledField,
  UnresolvedField: FillLocal.UnresolvedField,
  FillLocalResult: FillLocal.FillLocalResult,
  FillApplicationRequest: FillLocal.FillApplicationRequest,
  ObserveConfirmationInput: ObserveConfirmation.ObserveConfirmationInput,
  ObservedConfirmation: ObserveConfirmation.ObservedConfirmation,
  ObserveConfirmationResult: ObserveConfirmation.ObserveConfirmationResult,
  ObserveApplicationRequest: ObserveConfirmation.ObserveApplicationRequest,
  ExportedFile: Workspace.ExportedFile,
  ExportCounts: Workspace.ExportCounts,
  WorkspaceExportManifest: Workspace.WorkspaceExportManifest,
  ExportWorkspaceResult: Workspace.ExportWorkspaceResult,
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
  ResumeMode: Resumes.ALL_RESUME_MODES,
  ResumeSectionKind: Resumes.ALL_RESUME_SECTION_KINDS,
  ResumeFindingCode: Resumes.ALL_RESUME_FINDING_CODES,
  ResumeStatus: Resumes.ALL_RESUME_STATUSES,
  AnswerScope: Answers.ALL_ANSWER_SCOPES,
  AnswerSensitivity: Answers.ALL_ANSWER_SENSITIVITIES,
  ApplicationStatus: Applications.ALL_APPLICATION_STATUSES,
  ApplicationActor: Applications.ALL_APPLICATION_ACTORS,
  ApplicationEventType: Applications.ALL_APPLICATION_EVENT_TYPES,
  PacketAnswerProvenance: Applications.ALL_PACKET_ANSWER_PROVENANCES,
  PacketStalenessReason: Applications.ALL_PACKET_STALENESS_REASONS,
  EvidenceType: Applications.ALL_EVIDENCE_TYPES,
  ApplicationOutcome: Applications.ALL_APPLICATION_OUTCOMES,
  DeviceKind: Devices.ALL_DEVICE_KINDS,
  DeviceStatus: Devices.ALL_DEVICE_STATUSES,
  FillFieldOutcome: FillLocal.ALL_FILL_FIELD_OUTCOMES,
  UnresolvedReason: FillLocal.ALL_UNRESOLVED_REASONS,
  FillOutcome: FillLocal.ALL_FILL_OUTCOMES,
  ObservationOutcome: ObserveConfirmation.ALL_OBSERVATION_OUTCOMES,
  ObservationUnknownReason: ObserveConfirmation.ALL_OBSERVATION_UNKNOWN_REASONS,
  ExportExclusion: Workspace.ALL_EXPORT_EXCLUSIONS,
  DeletedObjectKind: Workspace.ALL_DELETED_OBJECT_KINDS,
};

/** Shared numeric constants that must not diverge between runtimes. */
export const EXPORTED_CONSTANTS = {
  PROTOCOL_VERSION: Protocol.PROTOCOL_VERSION,
  INPUT_SCHEMA_VERSION: Protocol.INPUT_SCHEMA_VERSION,
  RESULT_SCHEMA_VERSION: Protocol.RESULT_SCHEMA_VERSION,
  LEASE_SECONDS: Registry.LEASE_SECONDS,
  DEFAULT_OBSERVE_TIMEOUT_SECONDS: ObserveConfirmation.DEFAULT_OBSERVE_TIMEOUT_SECONDS,
  MAX_OBSERVE_TIMEOUT_SECONDS: ObserveConfirmation.MAX_OBSERVE_TIMEOUT_SECONDS,
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
  RESUME_SCHEMA_VERSION: Resumes.RESUME_SCHEMA_VERSION,
  RESUME_TEMPLATE_VERSION: Resumes.RESUME_TEMPLATE_VERSION,
  RESUME_MIN_FONT_PT: Resumes.RESUME_MIN_FONT_PT,
  PACKET_HASH_VERSION: Applications.PACKET_HASH_VERSION,
  PACKET_APPROVAL_MAX_TTL_HOURS: Applications.PACKET_APPROVAL_MAX_TTL_HOURS,
  DEVICE_PAIRING_TTL_SECONDS: Devices.DEVICE_PAIRING_TTL_SECONDS,
  DEVICE_TOKEN_TTL_DAYS: Devices.DEVICE_TOKEN_TTL_DAYS,
  EXPORT_SCHEMA_VERSION: Workspace.EXPORT_SCHEMA_VERSION,
} as const;
