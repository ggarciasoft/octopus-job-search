/**
 * The answer bank, and the rules that decide whether a stored answer may
 * appear in a packet at all.
 *
 * The bank exists because application forms ask the same questions endlessly.
 * The limits exist because "we already know the answer" is exactly the
 * reasoning that ends with a wrong statement sent to an employer under the
 * user's name. Four of them are enforced here:
 *
 *  1. **Scope is honoured.** An answer confirmed for one company is not an
 *     answer about every company (07_APPLICATION_AUTOMATION.md: "User-entered
 *     answers may be reused only under their approved scope").
 *  2. **`never_reuse` questions are never reused.** Assessments, personality
 *     tests, identity verification and medical or demographic questions must
 *     be answered by the person, on the form, every time.
 *  3. **Unconfirmed and expired answers are not answers.** A value the user
 *     never confirmed, or one they marked as going stale, is refused rather
 *     than quietly sent.
 *  4. **Provenance must be real.** An answer claiming to come from the bank or
 *     from a profile fact has to name a row that exists, belongs to this
 *     workspace and says what the packet claims it says.
 */
import type {
  AnswerBankEntry,
  AnswerScope,
  AnswerValue,
  PacketAnswer,
} from '@job-getter/contracts';
import type { WorkspaceScope } from '../auth/scope.js';
import type { AnswerBankRow, JobRow } from '../db/types.js';
import { notFound, unprocessable } from '../errors.js';
import { normalizeCompany } from '../discovery/jobs.js';

/**
 * The empty string is the database's sentinel for "no scope" so that the
 * UNIQUE (question_key, scope, scope_id) identity actually holds — NULL would
 * compare unequal to itself and let duplicates accumulate. The API translates
 * at the edge, in both directions, so no caller ever sees the sentinel.
 */
export function toAnswerBankEntry(row: AnswerBankRow): AnswerBankEntry {
  return {
    id: row.id,
    question_key: row.question_key,
    label: row.label,
    answer: row.answer as AnswerValue,
    sensitivity: row.sensitivity,
    scope: row.scope,
    scope_id: row.scope_id === '' ? null : row.scope_id,
    confirmed_at: row.confirmed_at === null ? null : row.confirmed_at.toISOString(),
    expires_at: row.expires_at === null ? null : row.expires_at.toISOString(),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

/** Validate and normalise the (scope, scope_id) pair the client sent. */
export function normalizeAnswerScope(
  scope: AnswerScope,
  scopeId: string | null | undefined,
): string {
  const value = (scopeId ?? '').trim();
  if (scope === 'general') {
    if (value !== '') {
      throw unprocessable('A general answer applies everywhere, so it has no scope_id.', {
        scope_id: 'Only valid when scope is "company" or "job".',
      });
    }
    return '';
  }
  if (value === '') {
    throw unprocessable(`A "${scope}" answer needs the ${scope} it applies to.`, {
      scope_id: 'Required when scope is "company" or "job".',
    });
  }
  return scope === 'company' ? normalizeCompany(value) : value;
}

/** Whether a stored answer's scope covers this particular job. */
export function scopeCoversJob(row: AnswerBankRow, job: JobRow): boolean {
  if (row.scope === 'general') return true;
  if (row.scope === 'company') return row.scope_id === normalizeCompany(job.company);
  return row.scope_id === job.id;
}

/**
 * Check every answer a packet is being built from.
 *
 * This runs before the packet row is written, so a rejected provenance never
 * becomes something a user can approve. The messages name the offending
 * question key, because "one of your answers is invalid" is not a thing anyone
 * can act on.
 */
export async function assertPacketAnswers(
  scope: WorkspaceScope,
  job: JobRow,
  answers: readonly PacketAnswer[],
): Promise<void> {
  const seen = new Set<string>();
  for (const answer of answers) {
    if (seen.has(answer.question_key)) {
      throw unprocessable(`The same question is answered twice: "${answer.question_key}".`, {
        answers: 'Each question_key may appear once.',
      });
    }
    seen.add(answer.question_key);

    // Rule 2. A stored value applied to a new form is an inference, whatever
    // it was when the user first typed it.
    if (answer.sensitivity === 'never_reuse' && answer.provenance !== 'user_entered') {
      throw unprocessable(
        `"${answer.question_key}" must be answered on the form itself, not reused.`,
        { answers: 'Assessment, identity and demographic questions are never reused.' },
      );
    }

    if (answer.provenance === 'preference' && answer.source_id !== null) {
      throw unprocessable(
        `"${answer.question_key}" claims to come from preferences, which have no row id.`,
        { answers: 'source_id must be null for preference provenance.' },
      );
    }

    if (answer.provenance === 'user_entered' && answer.source_id !== null) {
      throw unprocessable(`"${answer.question_key}" was typed by you, so it has no source row.`, {
        answers: 'source_id must be null for user_entered provenance.',
      });
    }
  }

  await assertBankProvenance(scope, job, answers);
  await assertFactProvenance(scope, answers);
}

async function assertBankProvenance(
  scope: WorkspaceScope,
  job: JobRow,
  answers: readonly PacketAnswer[],
): Promise<void> {
  const fromBank = answers.filter((answer) => answer.provenance === 'answer_bank');
  if (fromBank.length === 0) return;

  const ids = fromBank.map((answer) => answer.source_id).filter((id): id is string => id !== null);
  if (ids.length !== fromBank.length) {
    throw unprocessable('An answer taken from the bank must name the entry it came from.', {
      answers: 'source_id is required for answer_bank provenance.',
    });
  }

  const rows = (await scope
    .selectFrom('answer_bank')
    .selectAll()
    .where('id', 'in', ids)
    .execute()) as AnswerBankRow[];
  const byId = new Map(rows.map((row) => [row.id, row]));
  const now = Date.now();

  for (const answer of fromBank) {
    const row = byId.get(answer.source_id as string);
    // Absent, or another workspace's: the same 404 either way.
    if (row === undefined) throw notFound('No such answer-bank entry.');

    if (row.question_key !== answer.question_key) {
      throw unprocessable(
        `The stored answer for "${row.question_key}" cannot answer "${answer.question_key}".`,
        { answers: 'An answer-bank entry answers one question.' },
      );
    }
    if (row.confirmed_at === null) {
      throw unprocessable(`"${answer.question_key}" has not been confirmed yet.`, {
        answers: 'Confirm the stored answer before reusing it.',
      });
    }
    if (row.expires_at !== null && row.expires_at.getTime() <= now) {
      throw unprocessable(`The stored answer for "${answer.question_key}" has expired.`, {
        answers: 'Re-enter it so it is current.',
      });
    }
    if (row.sensitivity === 'never_reuse') {
      throw unprocessable(
        `"${answer.question_key}" is stored for your reference only and cannot be reused.`,
        { answers: 'Assessment, identity and demographic questions are never reused.' },
      );
    }
    if (!scopeCoversJob(row, job)) {
      throw unprocessable(
        `The stored answer for "${answer.question_key}" was confirmed for a different ${row.scope}.`,
        { answers: 'An answer is reused only within the scope it was approved for.' },
      );
    }
  }
}

async function assertFactProvenance(
  scope: WorkspaceScope,
  answers: readonly PacketAnswer[],
): Promise<void> {
  const fromFacts = answers.filter((answer) => answer.provenance === 'profile_fact');
  if (fromFacts.length === 0) return;

  const ids = fromFacts.map((answer) => answer.source_id).filter((id): id is string => id !== null);
  if (ids.length !== fromFacts.length) {
    throw unprocessable('An answer taken from the profile must name the fact it came from.', {
      answers: 'source_id is required for profile_fact provenance.',
    });
  }

  const rows = await scope
    .selectFrom('profile_facts')
    .select(['id', 'confirmed'])
    .where('id', 'in', ids)
    .execute();
  const byId = new Map(rows.map((row) => [row.id, row]));

  for (const answer of fromFacts) {
    const row = byId.get(answer.source_id as string);
    if (row === undefined) throw notFound('No such profile fact.');
    if (!row.confirmed) {
      throw unprocessable(
        `"${answer.question_key}" cites a profile fact you have not confirmed yet.`,
        { answers: 'Confirm the fact on the profile screen first.' },
      );
    }
  }
}
