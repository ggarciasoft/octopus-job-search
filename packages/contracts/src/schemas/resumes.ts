import { Type, type Static } from '@sinclair/typebox';
import { IsoMonth, Locale, Timestamp, Uuid } from '../common.js';

/**
 * Resume documents and their validation (docs/spec/06_AI_PROFILE_AND_CV.md,
 * "Truthful tailoring" and "Rendering"; PR07).
 *
 * The document is persisted **independent of any renderer**, so the DOCX and
 * the PDF are two views of one reviewed thing rather than two chances to
 * diverge. The rules below are invariants, not preferences:
 *
 *  1. **Every bullet cites at least one confirmed fact.** A sentence about
 *     someone's career with nothing behind it is exactly the invention
 *     invariant 2 forbids, so `fact_ids` is non-empty by schema, not by
 *     convention.
 *  2. **Tailoring may re-say, never add.** A model may reorder, shorten,
 *     translate and emphasise what the confirmed facts already contain. It may
 *     not add evidence, merge unrelated roles, inflate a number, imply
 *     employment from a personal project, or turn a desired skill into
 *     experience. Each of those has a validation code here.
 *  3. **Validation is not proof.** It catches what a deterministic comparison
 *     can catch and nothing more. `approved_for_review` means "nothing blocked
 *     it", never "this is accurate"; user approval stays mandatory, and the UI
 *     may not present this as a correctness guarantee.
 */
export const RESUME_SCHEMA_VERSION = 1;

/** Bump when the rendered layout changes; part of the cache key. */
export const RESUME_TEMPLATE_VERSION = 'simple/v1';

/**
 * Default page target. One to three pages is allowed, and overflow is reported
 * as a warning the user can act on rather than silently shrinking the type
 * below 10pt or truncating a section.
 */
export const RESUME_PAGE_TARGET = { min: 1, max: 3, default: 2 } as const;
export const RESUME_MIN_FONT_PT = 10;

export const ResumeMode = Type.Union([Type.Literal('original'), Type.Literal('tailored')]);
export type ResumeMode = Static<typeof ResumeMode>;

export const ALL_RESUME_MODES = ['original', 'tailored'] as const satisfies readonly ResumeMode[];

/**
 * Section order is the spec's own default. An empty section is omitted rather
 * than rendered as a heading with nothing under it.
 */
export const ResumeSectionKind = Type.Union([
  Type.Literal('summary'),
  Type.Literal('skills'),
  Type.Literal('experience'),
  Type.Literal('projects'),
  Type.Literal('education'),
  Type.Literal('certifications'),
  Type.Literal('languages'),
]);
export type ResumeSectionKind = Static<typeof ResumeSectionKind>;

export const ALL_RESUME_SECTION_KINDS = [
  'summary',
  'skills',
  'experience',
  'projects',
  'education',
  'certifications',
  'languages',
] as const satisfies readonly ResumeSectionKind[];

/**
 * No photograph and no demographic field exists anywhere in this shape. That
 * is deliberate: the spec excludes them by default, and a field that does not
 * exist cannot be populated by accident.
 */
export const ResumeContact = Type.Object(
  {
    full_name: Type.String({ minLength: 1, maxLength: 200 }),
    email: Type.Union([Type.String({ maxLength: 320 }), Type.Null()]),
    phone: Type.Union([Type.String({ maxLength: 50 }), Type.Null()]),
    location: Type.Union([Type.String({ maxLength: 200 }), Type.Null()]),
    links: Type.Array(Type.String({ maxLength: 500 }), { maxItems: 10 }),
    /** The confirmed contact fact this was taken from. */
    fact_ids: Type.Array(Uuid, { maxItems: 5 }),
  },
  { additionalProperties: false },
);
export type ResumeContact = Static<typeof ResumeContact>;

export const ResumeBullet = Type.Object(
  {
    text: Type.String({ minLength: 1, maxLength: 600 }),
    /**
     * At least one. A bullet with no fact behind it is not a weaker bullet, it
     * is an unsupported claim, and the schema refuses it.
     */
    fact_ids: Type.Array(Uuid, { minItems: 1, maxItems: 10 }),
  },
  { additionalProperties: false },
);
export type ResumeBullet = Static<typeof ResumeBullet>;

/**
 * One flat entry shape for every section. Experience uses title, organization
 * and dates; a skill uses only `title`; a certification adds `detail`. A
 * per-section union would be truer to the data and much worse to render, and
 * the renderers would each have to re-derive the same fallbacks.
 */
export const ResumeEntry = Type.Object(
  {
    title: Type.Union([Type.String({ maxLength: 300 }), Type.Null()]),
    organization: Type.Union([Type.String({ maxLength: 200 }), Type.Null()]),
    start_month: Type.Union([IsoMonth, Type.Null()]),
    end_month: Type.Union([IsoMonth, Type.Null()]),
    current: Type.Boolean(),
    /** Degree subject, credential identifier, declared language level. */
    detail: Type.Union([Type.String({ maxLength: 300 }), Type.Null()]),
    bullets: Type.Array(ResumeBullet, { maxItems: 20 }),
    fact_ids: Type.Array(Uuid, { minItems: 1, maxItems: 20 }),
  },
  { additionalProperties: false },
);
export type ResumeEntry = Static<typeof ResumeEntry>;

export const ResumeSection = Type.Object(
  {
    kind: ResumeSectionKind,
    /** Already localised by the worker; renderers never translate. */
    heading: Type.String({ minLength: 1, maxLength: 120 }),
    entries: Type.Array(ResumeEntry, { maxItems: 100 }),
  },
  { additionalProperties: false },
);
export type ResumeSection = Static<typeof ResumeSection>;

export const ResumeDocument = Type.Object(
  {
    schema_version: Type.Literal(RESUME_SCHEMA_VERSION),
    language: Locale,
    contact: ResumeContact,
    sections: Type.Array(ResumeSection, { maxItems: 10 }),
  },
  { additionalProperties: false },
);
export type ResumeDocument = Static<typeof ResumeDocument>;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * What the deterministic layer can detect. Every code names a specific way a
 * generated CV can say something the confirmed profile does not support.
 */
export const ResumeFindingCode = Type.Union([
  Type.Literal('BULLET_WITHOUT_FACT'),
  Type.Literal('UNKNOWN_FACT_ID'),
  Type.Literal('NUMBER_NOT_IN_FACTS'),
  Type.Literal('NAME_NOT_IN_FACTS'),
  Type.Literal('DATE_NOT_IN_FACTS'),
  Type.Literal('CREDENTIAL_NOT_IN_FACTS'),
  Type.Literal('ROLES_MERGED'),
  Type.Literal('PROJECT_PRESENTED_AS_EMPLOYMENT'),
  Type.Literal('SKILL_NOT_CONFIRMED'),
  Type.Literal('SECTION_OMITTED_EMPTY'),
  Type.Literal('PAGE_OVERFLOW'),
  Type.Literal('MODEL_CORRECTED_ONCE'),
  Type.Literal('NO_PROVIDER_CONFIGURED'),
  Type.Literal('MODEL_OUTPUT_REJECTED'),
  Type.Literal('PDF_UNAVAILABLE'),
]);
export type ResumeFindingCode = Static<typeof ResumeFindingCode>;

export const ALL_RESUME_FINDING_CODES = [
  'BULLET_WITHOUT_FACT',
  'UNKNOWN_FACT_ID',
  'NUMBER_NOT_IN_FACTS',
  'NAME_NOT_IN_FACTS',
  'DATE_NOT_IN_FACTS',
  'CREDENTIAL_NOT_IN_FACTS',
  'ROLES_MERGED',
  'PROJECT_PRESENTED_AS_EMPLOYMENT',
  'SKILL_NOT_CONFIRMED',
  'SECTION_OMITTED_EMPTY',
  'PAGE_OVERFLOW',
  'MODEL_CORRECTED_ONCE',
  'NO_PROVIDER_CONFIGURED',
  'MODEL_OUTPUT_REJECTED',
  'PDF_UNAVAILABLE',
] as const satisfies readonly ResumeFindingCode[];

/**
 * `removed` records what the worker actually did. A finding that merely warns
 * and a finding whose content was dropped from the document are different
 * outcomes, and a reviewer needs to know which one they are reading.
 */
export const ResumeFinding = Type.Object(
  {
    code: ResumeFindingCode,
    severity: Type.Union([Type.Literal('blocking'), Type.Literal('warning')]),
    /** Human-readable path, e.g. `experience[0].bullets[2]`. */
    where: Type.Union([Type.String({ maxLength: 200 }), Type.Null()]),
    /** The offending text, quoted verbatim so the user can judge it. */
    excerpt: Type.Union([Type.String({ maxLength: 600 }), Type.Null()]),
    removed: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type ResumeFinding = Static<typeof ResumeFinding>;

/**
 * Reproducibility metadata. The spec requires an output to be traceable to the
 * inputs that produced it, and prompts to be stored without raw secrets: this
 * records identifiers and versions only, never an API key or a prompt body.
 */
export const ResumeProvenance = Type.Object(
  {
    template_version: Type.String({ maxLength: 40 }),
    prompt_version: Type.Union([Type.String({ maxLength: 60 }), Type.Null()]),
    provider: Type.Union([Type.String({ maxLength: 40 }), Type.Null()]),
    model: Type.Union([Type.String({ maxLength: 120 }), Type.Null()]),
    /** True when no provider was configured and the document was assembled
     *  deterministically from the confirmed facts, with no rewriting. */
    deterministic: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type ResumeProvenance = Static<typeof ResumeProvenance>;

export const ResumeValidation = Type.Object(
  {
    /**
     * Nothing blocking remains. This is **not** a statement that the document
     * is accurate: semantic validation cannot guarantee truth, and user
     * approval is mandatory regardless (06_AI_PROFILE_AND_CV.md).
     */
    passed_automatic_checks: Type.Boolean(),
    findings: Type.Array(ResumeFinding, { maxItems: 200 }),
    /** Every confirmed fact the document draws on. */
    fact_ids: Type.Array(Uuid, { maxItems: 500 }),
    provenance: ResumeProvenance,
    /** Rendered page count per format, for the overflow warning. */
    pdf_pages: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
  },
  { additionalProperties: false },
);
export type ResumeValidation = Static<typeof ResumeValidation>;

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const ResumeStatus = Type.Union([
  Type.Literal('queued'),
  Type.Literal('ready'),
  Type.Literal('failed'),
]);
export type ResumeStatus = Static<typeof ResumeStatus>;

export const ALL_RESUME_STATUSES = [
  'queued',
  'ready',
  'failed',
] as const satisfies readonly ResumeStatus[];

export const ResumeView = Type.Object(
  {
    id: Uuid,
    mode: ResumeMode,
    status: ResumeStatus,
    /** Tailoring is always against a job; original mode need not be. */
    job_id: Type.Union([Uuid, Type.Null()]),
    job_revision: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    profile_revision: Type.Integer({ minimum: 1 }),
    language: Locale,
    template_id: Type.String({ maxLength: 40 }),
    /** Null in original mode: there is no structured document, by design. */
    document: Type.Union([ResumeDocument, Type.Null()]),
    validation: Type.Union([ResumeValidation, Type.Null()]),
    /** The user's uploaded file, in original mode. */
    input_file_id: Type.Union([Uuid, Type.Null()]),
    pdf_file_id: Type.Union([Uuid, Type.Null()]),
    docx_file_id: Type.Union([Uuid, Type.Null()]),
    /** Approval is a user action and is never set by generation. */
    approved_at: Type.Union([Timestamp, Type.Null()]),
    error_code: Type.Union([Type.String({ maxLength: 60 }), Type.Null()]),
    error_message: Type.Union([Type.String({ maxLength: 600 }), Type.Null()]),
    task_id: Type.Union([Uuid, Type.Null()]),
    created_at: Timestamp,
    updated_at: Timestamp,
  },
  { additionalProperties: false },
);
export type ResumeView = Static<typeof ResumeView>;

export const CreateResumeRequest = Type.Object(
  {
    mode: ResumeMode,
    job_id: Type.Optional(Uuid),
    /** Required in original mode; rejected in tailored mode. */
    input_file_id: Type.Optional(Uuid),
    template_id: Type.Optional(Type.Union([Type.Literal('simple')])),
    language: Type.Optional(Locale),
    page_target: Type.Optional(
      Type.Integer({ minimum: RESUME_PAGE_TARGET.min, maximum: RESUME_PAGE_TARGET.max }),
    ),
  },
  { additionalProperties: false },
);
export type CreateResumeRequest = Static<typeof CreateResumeRequest>;

/**
 * Approval references the document the user actually read. Editing anything
 * upstream produces a new resume rather than silently re-approving this one.
 */
export const ApproveResumeRequest = Type.Object(
  {
    approved: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type ApproveResumeRequest = Static<typeof ApproveResumeRequest>;
