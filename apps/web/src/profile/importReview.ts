/**
 * Pure helpers for the import review screen: the client-side upload checks
 * and the translation of per-draft decisions into the confirm request.
 */
import {
  ACCEPTED_UPLOAD_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  type AcceptedField,
  type DraftFact,
} from '@job-getter/contracts';

/**
 * Extension per accepted MIME type. Keyed by the contract's list, so a type
 * added there without an entry here is a compile error rather than an upload
 * that is refused client-side for no stated reason.
 */
const EXTENSION_BY_MIME: Record<(typeof ACCEPTED_UPLOAD_MIME_TYPES.cv_original)[number], string> = {
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
};

export const ACCEPTED_EXTENSIONS: readonly string[] = Object.values(EXTENSION_BY_MIME);

/** The `accept` attribute for the file input: extensions and MIME types. */
export const FILE_INPUT_ACCEPT = [
  ...ACCEPTED_EXTENSIONS,
  ...ACCEPTED_UPLOAD_MIME_TYPES.cv_original,
].join(',');

export type UploadRejection = 'too_large' | 'wrong_type';

export interface UploadCandidate {
  readonly name: string;
  readonly size: number;
  readonly type: string;
}

/**
 * Client-side gate before any bytes leave the browser
 * (06_AI_PROFILE_AND_CV.md: PDF and DOCX up to 10 MiB). Browsers do not always
 * report a MIME type, so the extension is accepted as the fallback; the API
 * still checks the real signature and reports it in `validation`.
 */
export function checkUploadCandidate(file: UploadCandidate): UploadRejection | null {
  if (file.size > MAX_UPLOAD_BYTES) return 'too_large';
  const accepted: readonly string[] = ACCEPTED_UPLOAD_MIME_TYPES.cv_original;
  if (file.type !== '' && accepted.includes(file.type)) return null;
  const lower = file.name.toLowerCase();
  if (file.type === '' && ACCEPTED_EXTENSIONS.some((extension) => lower.endsWith(extension))) {
    return null;
  }
  return 'wrong_type';
}

/** `replace:<fact id>` names the confirmed fact the draft supersedes. */
export type ConflictChoice = 'keep_existing' | 'both' | `replace:${string}`;

export interface DraftDecision {
  /** Only meaningful for drafts without a conflict; conflicts use `conflictChoice`. */
  readonly accepted: boolean;
  /** Present once the user edited the proposed value. */
  readonly editedValue?: unknown;
  /** Null until the user chose; an unchosen conflict is not accepted. */
  readonly conflictChoice: ConflictChoice | null;
}

export const NO_DECISION: DraftDecision = { accepted: false, conflictChoice: null };

export function supersededFactId(choice: ConflictChoice | null): string | null {
  return choice !== null && choice.startsWith('replace:') ? choice.slice('replace:'.length) : null;
}

/** Whether a draft will be sent, given its decision and whether it conflicts. */
export function isAccepted(decision: DraftDecision, hasConflict: boolean): boolean {
  if (!hasConflict) return decision.accepted;
  return decision.conflictChoice !== null && decision.conflictChoice !== 'keep_existing';
}

/**
 * Builds `accepted_fields`. Unaccepted drafts are simply absent — the API
 * discards them — and `edited_value` is sent only when the user edited, so
 * the server stores the extracted value it already validated otherwise.
 */
export function buildAcceptedFields(
  drafts: readonly DraftFact[],
  decisions: Readonly<Record<string, DraftDecision>>,
  conflictingDraftIds: ReadonlySet<string>,
): AcceptedField[] {
  const fields: AcceptedField[] = [];
  for (const draft of drafts) {
    const decision = decisions[draft.draft_id] ?? NO_DECISION;
    if (!isAccepted(decision, conflictingDraftIds.has(draft.draft_id))) continue;
    const field: AcceptedField = { draft_id: draft.draft_id };
    const supersedes = supersededFactId(decision.conflictChoice);
    fields.push({
      ...field,
      ...('editedValue' in decision ? { edited_value: decision.editedValue } : {}),
      ...(supersedes === null ? {} : { supersedes_fact_id: supersedes }),
    });
  }
  return fields;
}
