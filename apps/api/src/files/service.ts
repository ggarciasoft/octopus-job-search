/**
 * Upload validation, persistence and download headers.
 *
 * Rules from 09_SECURITY_PRIVACY.md implemented here:
 *
 *  * "Validate file signature and extension, bound file size." A magic-byte
 *    signature that contradicts the extension is rejected, not parsed
 *    optimistically.
 *  * "Sanitize download names and Content-Disposition. Serve untrusted
 *    artifacts as attachments; do not inline arbitrary uploaded HTML."
 *  * Local malware scanning is reported as `skipped_not_configured` rather
 *    than implied clean.
 */
import { createHash, randomUUID } from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import {
  ACCEPTED_UPLOAD_MIME_TYPES,
  type FilePurpose,
  type FileValidation,
  type FileView,
} from '@job-getter/contracts';
import type { Config } from '../config.js';
import { payloadTooLarge, unprocessable } from '../errors.js';
import type { WorkspaceScope } from '../auth/scope.js';
import type { FilePurposeColumn, FileRow } from '../db/types.js';
import { generateStorageKey, type StorageDriver } from './storage.js';

/** Purposes a user may upload directly. Others are produced by the system. */
export const USER_UPLOADABLE_PURPOSES = ['cv_original', 'profile_text'] as const;
export type UserUploadablePurpose = (typeof USER_UPLOADABLE_PURPOSES)[number];

/** Purposes a worker may create as a task artifact. */
export const ARTIFACT_PURPOSES = ['generated_cv', 'export', 'evidence'] as const;

const EXTENSION_BY_MIME: Record<string, readonly string[]> = {
  'application/pdf': ['pdf'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
  'text/plain': ['txt', 'md'],
  'application/zip': ['zip'],
  'application/json': ['json'],
};

/** Mime types that are safe to echo back on download; everything else is octet-stream. */
const SAFE_DOWNLOAD_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'application/zip',
]);

export function extensionOf(filename: string): string | null {
  const match = /\.([A-Za-z0-9]{1,10})$/.exec(filename);
  return match?.[1]?.toLowerCase() ?? null;
}

/**
 * Reduces a user filename to something safe for a `Content-Disposition`
 * header: no path separators, no control characters, no quotes, bounded
 * length. The original is still delivered via RFC 5987 `filename*`.
 */
export function sanitizeFilename(original: string): string {
  const withoutPath = original.replace(/[\\/]+/g, '_');
  const cleaned = withoutPath
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f"';\r\n]/g, '')
    .replace(/[^A-Za-z0-9._()-]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^[._ ]+/, '')
    .trim();
  const bounded = cleaned.slice(0, 100);
  return bounded.length > 0 ? bounded : 'download';
}

export function contentDispositionFor(originalName: string): string {
  const safe = sanitizeFilename(originalName);
  const encoded = encodeURIComponent(originalName).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${safe}"; filename*=UTF-8''${encoded}`;
}

export function downloadContentType(mime: string): string {
  return SAFE_DOWNLOAD_MIME.has(mime) ? mime : 'application/octet-stream';
}

export interface UploadInput {
  readonly buffer: Buffer;
  readonly originalName: string;
  readonly purpose: FilePurpose;
  /** True when @fastify/multipart stopped reading at the size limit. */
  readonly truncated?: boolean;
}

export interface ValidatedUpload {
  readonly mime: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly validation: FileValidation;
}

function looksLikeUtf8Text(buffer: Buffer): boolean {
  if (buffer.includes(0)) return false;
  const decoded = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  return !decoded.includes('�');
}

/** PDFs with an /Encrypt entry cannot be parsed; AT03 requires an honest error. */
function pdfLooksEncrypted(buffer: Buffer): boolean {
  const tail = buffer.subarray(Math.max(0, buffer.byteLength - 4096)).toString('latin1');
  return (
    /\/Encrypt\b/.test(tail) || /\/Encrypt\b/.test(buffer.subarray(0, 4096).toString('latin1'))
  );
}

/**
 * Validates an upload by size, magic-byte signature and extension agreement.
 *
 * Throws 413 for oversize and 422 when the content contradicts its name; it
 * never "fixes" the mime type from the extension, because the extension is the
 * attacker-controlled half.
 */
export async function validateUpload(config: Config, input: UploadInput): Promise<ValidatedUpload> {
  if (input.truncated || input.buffer.byteLength > config.maxUploadBytes) {
    throw payloadTooLarge(
      `The upload exceeds the ${config.maxUploadBytes} byte limit for this installation.`,
    );
  }
  if (input.buffer.byteLength === 0) {
    throw unprocessable('The uploaded file is empty.', { file: 'File contains no data.' });
  }

  const accepted: readonly string[] | undefined =
    ACCEPTED_UPLOAD_MIME_TYPES[input.purpose as keyof typeof ACCEPTED_UPLOAD_MIME_TYPES];
  const extension = extensionOf(input.originalName);
  const warnings: string[] = [];

  const detected = await fileTypeFromBuffer(input.buffer);
  let mime: string;
  let signatureOk: boolean;
  let extensionMatches: boolean;

  if (detected) {
    mime = detected.mime;
    signatureOk = true;
    const expectedExtensions = EXTENSION_BY_MIME[mime] ?? [detected.ext];
    extensionMatches = extension !== null && expectedExtensions.includes(extension);
  } else if (input.purpose === 'profile_text') {
    // Plain text has no magic bytes. Validate by decoding instead of guessing,
    // and say so in the warnings rather than claiming a verified signature.
    if (!looksLikeUtf8Text(input.buffer)) {
      throw unprocessable(
        'The file is not valid UTF-8 text. Upload a .txt file or paste the text instead.',
        { file: 'Not valid UTF-8 text.' },
      );
    }
    mime = 'text/plain';
    signatureOk = true;
    extensionMatches = extension === null || ['txt', 'md'].includes(extension);
    warnings.push('Plain text has no magic-byte signature; the content was validated by decoding.');
  } else {
    throw unprocessable('The file type could not be identified from its contents.', {
      file: 'Unrecognised file signature.',
    });
  }

  if (!extensionMatches) {
    throw unprocessable(
      `The file contents (${mime}) do not match the file extension ` +
        `${extension === null ? '(none)' : `.${extension}`}.`,
      { file: 'File signature contradicts its extension.' },
    );
  }

  if (accepted && !accepted.includes(mime)) {
    throw unprocessable(
      `${mime} is not accepted for ${input.purpose}. Accepted types: ${accepted.join(', ')}.`,
      { purpose: 'Unsupported file type for this purpose.' },
    );
  }

  const encrypted = mime === 'application/pdf' && pdfLooksEncrypted(input.buffer);
  if (encrypted) {
    warnings.push('The PDF appears to be encrypted; text extraction will not be possible.');
  }

  return {
    mime,
    sha256: createHash('sha256').update(input.buffer).digest('hex'),
    bytes: input.buffer.byteLength,
    validation: {
      signature_ok: signatureOk,
      extension_matches_signature: extensionMatches,
      encrypted,
      // Honest status: no scanner is configured in a local installation.
      malware_scan: 'skipped_not_configured',
      warnings,
    },
  };
}

export interface StoreFileInput {
  readonly originalName: string;
  readonly purpose: FilePurposeColumn;
  readonly state: 'staging' | 'ready';
  /** Staging rows expire; `null` for ready rows the user owns. */
  readonly expiresAt?: Date | null;
}

export interface StoredFile {
  readonly id: string;
  readonly storageKey: string;
  readonly row: FileRow;
}

/**
 * Writes the bytes to the storage driver and records the row, in that order.
 *
 * If the database insert fails the object is removed again, so a failed upload
 * cannot leave an unreferenced blob that no retention policy will ever reach.
 */
export async function storeFile(
  scope: WorkspaceScope,
  storage: StorageDriver,
  buffer: Buffer,
  validated: ValidatedUpload,
  input: StoreFileInput,
): Promise<StoredFile> {
  const fileId = randomUUID();
  const storageKey = generateStorageKey(scope.workspaceId, fileId);
  await storage.put(storageKey, buffer);

  try {
    const row = await scope
      .insertInto('files', {
        id: fileId,
        storage_key: storageKey,
        original_name: input.originalName.slice(0, 255),
        mime: validated.mime,
        bytes: validated.bytes,
        sha256: validated.sha256,
        state: input.state,
        purpose: input.purpose,
        expires_at: input.expiresAt ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return { id: fileId, storageKey, row: row as FileRow };
  } catch (error) {
    await storage.delete(storageKey).catch(() => undefined);
    throw error;
  }
}

export function toFileView(row: FileRow): FileView {
  return {
    id: row.id,
    original_name: row.original_name,
    mime: row.mime,
    bytes: Number(row.bytes),
    sha256: row.sha256,
    purpose: row.purpose,
    state: row.state,
    created_at: row.created_at.toISOString(),
  };
}
