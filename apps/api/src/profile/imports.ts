/**
 * Profile import: the merge *proposal* pipeline.
 *
 * 06_AI_PROFILE_AND_CV.md is explicit about what this is and is not:
 *
 *  * "No extracted field is verified until user confirmation."
 *  * "Import is a merge proposal; do not overwrite existing confirmed facts
 *    automatically. Conflicts show both values."
 *
 * So the shape is: a worker result becomes *drafts* on the `profile_imports`
 * row and nothing else. Drafts are compared against existing confirmed facts
 * on read, and only `POST /profile/imports/:id/confirm` ever writes a
 * `profile_facts` row — one per field the user explicitly accepted, and never
 * on top of a confirmed fact unless the user named it in `supersedes_fact_id`
 * (AT04).
 */
import type { Selectable } from 'kysely';
import {
  type DraftFact,
  type FactKind,
  type ImportWarning,
  type ParseProfileResult,
  type ProfileImportStatus,
  type ProfileImportView,
  type ProfileImportFormatHint,
} from '@job-getter/contracts';
import type { DbTransaction } from '../db/pool.js';
import type { ProfileImportsTable, TaskRow } from '../db/types.js';
import { WorkspaceScope } from '../auth/scope.js';
import { conflictReason, validateFactValue, type ConflictCandidate } from './facts.js';
import type { ProfileFactRow } from './service.js';

export type ProfileImportRow = Selectable<ProfileImportsTable>;

/**
 * Shape stored in `profile_imports.extracted_draft`.
 *
 * It keeps the provenance metadata the worker reported alongside the drafts,
 * because "Preserve source filename and page/paragraph references where
 * available" means the evidence has to survive the round trip, not just the
 * values.
 */
export interface ExtractedDraft {
  readonly draft_facts: DraftFact[];
  readonly extracted_chars: number;
  readonly provider: ParseProfileResult['provider'];
  /** Drafts discarded because their value did not match their own kind. */
  readonly dropped_invalid: number;
}

export function readExtractedDraft(row: ProfileImportRow): ExtractedDraft | null {
  const raw = row.extracted_draft;
  if (raw === null || typeof raw !== 'object') return null;
  const candidate = raw as Partial<ExtractedDraft>;
  if (!Array.isArray(candidate.draft_facts)) return null;
  return {
    draft_facts: candidate.draft_facts,
    extracted_chars: typeof candidate.extracted_chars === 'number' ? candidate.extracted_chars : 0,
    provider: (candidate.provider as ParseProfileResult['provider'] | undefined) ?? {
      id: 'unknown',
      model: 'unknown',
      input_tokens: null,
      output_tokens: null,
    },
    dropped_invalid: typeof candidate.dropped_invalid === 'number' ? candidate.dropped_invalid : 0,
  };
}

export function readWarnings(row: ProfileImportRow): ImportWarning[] {
  const raw = row.warnings;
  return Array.isArray(raw) ? (raw as ImportWarning[]) : [];
}

// ---------------------------------------------------------------------------
// Worker result application
// ---------------------------------------------------------------------------

/**
 * Applies a validated `parse_profile` result to its import row.
 *
 * Called from `completeTask` inside the *same* transaction that marks the task
 * succeeded, so an import can never be left reporting `queued` while its task
 * says `succeeded` (04_API_CONTRACTS.md: "Domain transitions occur only after
 * API validation, ownership checks, revision checks and task lease checks in
 * one transaction").
 *
 * The result has already passed `ParseProfileResult`, but that schema declares
 * `value` as `unknown` — a draft's value is only meaningful against the schema
 * its own `kind` selects. Drafts that fail that check are dropped here with a
 * `FIELD_DROPPED_INVALID` warning rather than being offered to the user as
 * something they could accept: a draft that cannot become a fact is not a
 * choice, it is a defect, and the warning says so.
 *
 * Nothing is confirmed. `status` becomes `ready_for_review`, never `confirmed`.
 */
export async function applyParseProfileResult(
  trx: DbTransaction,
  task: TaskRow,
  result: ParseProfileResult,
): Promise<void> {
  const scope = WorkspaceScope.forTaskWorkspace(trx, task.workspace_id);

  const accepted: DraftFact[] = [];
  const warnings: ImportWarning[] = [...result.warnings];
  const seenDraftIds = new Set<string>();
  let dropped = 0;

  for (const draft of result.draft_facts) {
    if (seenDraftIds.has(draft.draft_id)) {
      dropped += 1;
      warnings.push({
        code: 'FIELD_DROPPED_INVALID',
        message: 'A draft was discarded because its draft_id was not unique.',
        detail: `kind: ${draft.kind}`,
      });
      continue;
    }
    const validation = validateFactValue(draft.kind, draft.value);
    if (!validation.ok) {
      dropped += 1;
      warnings.push({
        code: 'FIELD_DROPPED_INVALID',
        message: `A "${draft.kind}" draft was discarded: ${validation.message}`,
        // Field names only — never the extracted value, which is CV content.
        detail: Object.keys(validation.fields).slice(0, 5).join(', ') || undefined,
      });
      continue;
    }
    seenDraftIds.add(draft.draft_id);
    accepted.push(draft);
  }

  const stored: ExtractedDraft = {
    draft_facts: accepted,
    extracted_chars: result.extracted_chars,
    provider: result.provider,
    dropped_invalid: dropped,
  };

  await scope
    .updateTable('profile_imports')
    .set({
      status: 'ready_for_review',
      extracted_draft: JSON.stringify(stored),
      warnings: JSON.stringify(warnings.slice(0, 100)),
      error_code: null,
      error_message: null,
      updated_at: new Date(),
    })
    .where('task_id', '=', task.id)
    .execute();
}

/**
 * Marks the import failed when its task failed terminally.
 *
 * Without this the UI would show an import stuck at `queued` forever while the
 * task row said `failed` — a silent dead end rather than an honest error
 * ("Never replace missing backend behaviour with a button that reports
 * success").
 */
export async function applyParseProfileFailure(
  trx: DbTransaction,
  task: TaskRow,
  code: string,
  message: string,
): Promise<void> {
  const scope = WorkspaceScope.forTaskWorkspace(trx, task.workspace_id);
  await scope
    .updateTable('profile_imports')
    .set({
      status: 'failed',
      error_code: code.slice(0, 64),
      error_message: message.slice(0, 500),
      updated_at: new Date(),
    })
    .where('task_id', '=', task.id)
    .where('status', 'in', ['queued', 'parsing'])
    .execute();
}

// ---------------------------------------------------------------------------
// Read model
// ---------------------------------------------------------------------------

export interface ImportConflict {
  readonly draft_id: string;
  readonly existing_fact_id: string;
  readonly reason: string;
}

/**
 * Compares every draft against the profile's **confirmed** facts.
 *
 * Unconfirmed facts are deliberately not considered: they are themselves
 * unresolved proposals, and flagging a draft against another draft would bury
 * the real conflicts.
 */
export function computeConflicts(
  drafts: readonly DraftFact[],
  confirmedFacts: readonly ProfileFactRow[],
): ImportConflict[] {
  const candidates: ConflictCandidate[] = confirmedFacts.map((fact) => ({
    id: fact.id,
    kind: fact.kind as FactKind,
    value: fact.value,
  }));

  const conflicts: ImportConflict[] = [];
  for (const draft of drafts) {
    for (const candidate of candidates) {
      const reason = conflictReason(draft.kind, draft.value, candidate);
      if (reason !== null) {
        conflicts.push({
          draft_id: draft.draft_id,
          existing_fact_id: candidate.id,
          reason: reason.slice(0, 200),
        });
      }
    }
  }
  return conflicts;
}

export function toImportView(
  row: ProfileImportRow,
  conflicts: readonly ImportConflict[],
): ProfileImportView {
  const draft = readExtractedDraft(row);
  return {
    id: row.id,
    status: row.status as ProfileImportStatus,
    task_id: row.task_id,
    format_hint: row.format_hint as ProfileImportFormatHint,
    source_file_id: row.file_id,
    draft_facts: draft?.draft_facts ?? [],
    warnings: readWarnings(row),
    conflicts: [...conflicts],
    error:
      row.error_code === null ? null : { code: row.error_code, message: row.error_message ?? '' },
    created_at: row.created_at.toISOString(),
  };
}
