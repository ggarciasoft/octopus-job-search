import { Type, type Static } from '@sinclair/typebox';
import { Locale, Uuid } from '../common.js';
import { FactKind } from '../schemas/profile.js';

/** Limits from 09_SECURITY_PRIVACY.md, enforced by the worker and the API. */
export const PARSE_LIMITS = {
  maxUploadBytes: 10 * 1024 * 1024,
  maxPdfPages: 100,
  maxExtractedChars: 200_000,
  maxDocxExpansionBytes: 50 * 1024 * 1024,
  minPlausibleChars: 200,
} as const;

export const ProfileImportFormatHint = Type.Union([
  Type.Literal('pdf'),
  Type.Literal('docx'),
  Type.Literal('linkedin_export_text'),
  Type.Literal('plain_text'),
  Type.Literal('auto'),
]);
export type ProfileImportFormatHint = Static<typeof ProfileImportFormatHint>;

export const ParseProfileInput = Type.Object(
  {
    profile_import_id: Uuid,
    profile_revision: Type.Integer({ minimum: 1 }),
    format_hint: ProfileImportFormatHint,
    locale: Locale,
    /** Present when the user pasted text instead of uploading a document. */
    inline_text: Type.Union([Type.String({ maxLength: PARSE_LIMITS.maxExtractedChars }), Type.Null()]),
    /** file_id of the uploaded document, downloaded through the task scope. */
    source_file_id: Type.Union([Uuid, Type.Null()]),
    limits: Type.Object(
      {
        max_pdf_pages: Type.Integer({ minimum: 1 }),
        max_extracted_chars: Type.Integer({ minimum: 1 }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
export type ParseProfileInput = Static<typeof ParseProfileInput>;

export const ImportWarningCode = Type.Union([
  Type.Literal('EXTRACTION_SHORT'),
  Type.Literal('PAGES_TRUNCATED'),
  Type.Literal('CHARS_TRUNCATED'),
  Type.Literal('TABLE_LAYOUT_UNCERTAIN'),
  Type.Literal('DATE_AMBIGUOUS'),
  Type.Literal('FIELD_DROPPED_INVALID'),
  Type.Literal('MODEL_CORRECTED_ONCE'),
  Type.Literal('NO_PROVIDER_CONFIGURED'),
  Type.Literal('PROMPT_INJECTION_TEXT_IGNORED'),
]);
export type ImportWarningCode = Static<typeof ImportWarningCode>;

export const ImportWarning = Type.Object(
  {
    code: ImportWarningCode,
    message: Type.String({ maxLength: 500 }),
    detail: Type.Optional(Type.String({ maxLength: 500 })),
  },
  { additionalProperties: false },
);
export type ImportWarning = Static<typeof ImportWarning>;

/**
 * A draft fact is a proposal only. `confidence` is a parsing aid and is never
 * treated as confirmation (04_API_CONTRACTS.md). Drafts become facts only
 * through POST /profile/imports/:id/confirm.
 */
export const DraftFact = Type.Object(
  {
    draft_id: Type.String({ minLength: 1, maxLength: 64 }),
    kind: FactKind,
    value: Type.Unknown(),
    source_excerpt: Type.Union([Type.String({ maxLength: 2000 }), Type.Null()]),
    source_locator: Type.Union([Type.String({ maxLength: 120 }), Type.Null()]),
    confidence: Type.Number({ minimum: 0, maximum: 1 }),
  },
  { additionalProperties: false },
);
export type DraftFact = Static<typeof DraftFact>;

export const ParseProfileResult = Type.Object(
  {
    draft_facts: Type.Array(DraftFact, { maxItems: 500 }),
    warnings: Type.Array(ImportWarning, { maxItems: 100 }),
    extracted_chars: Type.Integer({ minimum: 0 }),
    provider: Type.Object(
      {
        id: Type.String({ maxLength: 64 }),
        model: Type.String({ maxLength: 128 }),
        input_tokens: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
        output_tokens: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
export type ParseProfileResult = Static<typeof ParseProfileResult>;

/**
 * Import confirmation. The user accepts drafts one by one and may edit the
 * value; unaccepted drafts are discarded and existing confirmed facts are
 * never overwritten implicitly (AT04).
 */
export const AcceptedField = Type.Object(
  {
    draft_id: Type.String({ minLength: 1, maxLength: 64 }),
    /** Omitted means "accept the extracted value unchanged". */
    edited_value: Type.Optional(Type.Unknown()),
    /** Set when the user chose to replace a specific existing fact. */
    supersedes_fact_id: Type.Optional(Type.Union([Uuid, Type.Null()])),
  },
  { additionalProperties: false },
);
export type AcceptedField = Static<typeof AcceptedField>;

export const ConfirmImportRequest = Type.Object(
  {
    expected_profile_revision: Type.Integer({ minimum: 1 }),
    accepted_fields: Type.Array(AcceptedField, { maxItems: 500 }),
  },
  { additionalProperties: false },
);
export type ConfirmImportRequest = Static<typeof ConfirmImportRequest>;

export const ProfileImportStatus = Type.Union([
  Type.Literal('queued'),
  Type.Literal('parsing'),
  Type.Literal('ready_for_review'),
  Type.Literal('confirmed'),
  Type.Literal('failed'),
]);
export type ProfileImportStatus = Static<typeof ProfileImportStatus>;

export const ProfileImportView = Type.Object(
  {
    id: Uuid,
    status: ProfileImportStatus,
    task_id: Type.Union([Uuid, Type.Null()]),
    format_hint: ProfileImportFormatHint,
    source_file_id: Type.Union([Uuid, Type.Null()]),
    draft_facts: Type.Array(DraftFact),
    warnings: Type.Array(ImportWarning),
    /**
     * Existing confirmed facts that collide with a draft. Both values are
     * shown so the user resolves the conflict; nothing merges automatically.
     */
    conflicts: Type.Array(
      Type.Object(
        {
          draft_id: Type.String({ maxLength: 64 }),
          existing_fact_id: Uuid,
          reason: Type.String({ maxLength: 200 }),
        },
        { additionalProperties: false },
      ),
    ),
    error: Type.Union([
      Type.Object(
        { code: Type.String({ maxLength: 64 }), message: Type.String({ maxLength: 500 }) },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
    created_at: Type.String({ format: 'date-time' }),
  },
  { additionalProperties: false },
);
export type ProfileImportView = Static<typeof ProfileImportView>;

export const CreateProfileImportRequest = Type.Object(
  {
    file_id: Type.Optional(Uuid),
    pasted_text: Type.Optional(Type.String({ minLength: 1, maxLength: PARSE_LIMITS.maxExtractedChars })),
    format_hint: Type.Optional(ProfileImportFormatHint),
  },
  { additionalProperties: false },
);
export type CreateProfileImportRequest = Static<typeof CreateProfileImportRequest>;
