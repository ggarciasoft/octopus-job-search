import { Type, type Static } from '@sinclair/typebox';
import { Timestamp, Uuid } from '../common.js';

export const FilePurpose = Type.Union([
  Type.Literal('cv_original'),
  Type.Literal('profile_text'),
  Type.Literal('generated_cv'),
  Type.Literal('export'),
  Type.Literal('evidence'),
]);
export type FilePurpose = Static<typeof FilePurpose>;

export const ALL_FILE_PURPOSES = [
  'cv_original',
  'profile_text',
  'generated_cv',
  'export',
  'evidence',
] as const satisfies readonly FilePurpose[];

export const FileState = Type.Union([
  Type.Literal('staging'),
  Type.Literal('ready'),
  Type.Literal('deleting'),
]);
export type FileState = Static<typeof FileState>;

/**
 * Accepted upload types are checked by magic-byte signature as well as
 * extension. Anything else is rejected rather than parsed optimistically.
 */
export const ACCEPTED_UPLOAD_MIME_TYPES = {
  cv_original: [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ],
  profile_text: ['text/plain'],
} as const;

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const FileValidation = Type.Object(
  {
    signature_ok: Type.Boolean(),
    extension_matches_signature: Type.Boolean(),
    encrypted: Type.Boolean(),
    /** Local scanning may be unavailable; the status says so instead of implying clean. */
    malware_scan: Type.Union([
      Type.Literal('clean'),
      Type.Literal('skipped_not_configured'),
      Type.Literal('quarantined'),
      Type.Literal('pending'),
    ]),
    warnings: Type.Array(Type.String({ maxLength: 300 }), { maxItems: 20 }),
  },
  { additionalProperties: false },
);
export type FileValidation = Static<typeof FileValidation>;

export const FileView = Type.Object(
  {
    id: Uuid,
    original_name: Type.String({ maxLength: 255 }),
    mime: Type.String({ maxLength: 128 }),
    bytes: Type.Integer({ minimum: 0 }),
    sha256: Type.String({ pattern: '^[a-f0-9]{64}$' }),
    purpose: FilePurpose,
    state: FileState,
    created_at: Timestamp,
  },
  { additionalProperties: false },
);
export type FileView = Static<typeof FileView>;

export const FileUploadResponse = Type.Object(
  { file: FileView, validation: FileValidation },
  { additionalProperties: false },
);
export type FileUploadResponse = Static<typeof FileUploadResponse>;
