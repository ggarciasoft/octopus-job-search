/**
 * Profile fact values: schema selection by `kind`, the internal-consistency
 * rules the schema cannot express, and conflict detection between an import
 * draft and the existing confirmed facts.
 *
 * Everything here treats the value as *untrusted*. It arrives either from a
 * model (invariant 9) or from a user edit, and a user edit is no more trusted
 * than the model's original — a hand-typed `end_month` can still precede its
 * `start_month`.
 *
 * The value schemas are never re-declared: `FACT_VALUE_SCHEMAS` from
 * `@job-getter/contracts` is the single source of truth shared with the worker
 * and the generated Pydantic models.
 */
import {
  FACT_VALUE_SCHEMAS,
  type ContactValue,
  type EducationValue,
  type ExperienceValue,
  type FactKind,
  type ProjectValue,
  type CertificationValue,
  type AuthorizationValue,
  type SkillValue,
} from '@job-getter/contracts';
import { unprocessable } from '../errors.js';
import { checkSchema } from '../validation.js';

export interface FactValidationFailure {
  readonly ok: false;
  readonly message: string;
  readonly fields: Record<string, string>;
}
export interface FactValidationSuccess {
  readonly ok: true;
}
export type FactValidation = FactValidationSuccess | FactValidationFailure;

const OK: FactValidationSuccess = { ok: true };

/**
 * True when `earlier` is strictly before `later`.
 *
 * `YYYY-MM` is zero-padded and fixed width, so lexicographic order is calendar
 * order — which is exactly why the contract pins that format.
 */
function monthPrecedes(earlier: string, later: string): boolean {
  return earlier < later;
}

/**
 * The rule 03_DATA_MODEL.md states as "Current/end dates must be internally
 * consistent", applied to every kind that carries a date range:
 *
 *  * `current: true` means the engagement has not ended, so `end_month` must
 *    be null. A "current" role with an end date is the kind of contradiction
 *    that later turns into an invented employment period on a generated CV.
 *  * `end_month` must not precede `start_month`.
 *
 * Certifications use `issued_month`/`expires_month`, which is the same rule
 * with different column names: a credential cannot expire before it existed.
 */
function checkDateConsistency(kind: FactKind, value: unknown): FactValidation {
  switch (kind) {
    case 'experience': {
      const experience = value as ExperienceValue;
      if (experience.current && experience.end_month !== null) {
        return {
          ok: false,
          message: 'A current role cannot also have an end month.',
          fields: { end_month: 'Must be null when "current" is true.' },
        };
      }
      if (
        experience.end_month !== null &&
        monthPrecedes(experience.end_month, experience.start_month)
      ) {
        return {
          ok: false,
          message: 'The end month precedes the start month.',
          fields: { end_month: 'Must not be earlier than start_month.' },
        };
      }
      return OK;
    }
    case 'education': {
      const education = value as EducationValue;
      if (education.current && education.end_month !== null) {
        return {
          ok: false,
          message: 'Current studies cannot also have an end month.',
          fields: { end_month: 'Must be null when "current" is true.' },
        };
      }
      if (
        education.start_month !== null &&
        education.end_month !== null &&
        monthPrecedes(education.end_month, education.start_month)
      ) {
        return {
          ok: false,
          message: 'The end month precedes the start month.',
          fields: { end_month: 'Must not be earlier than start_month.' },
        };
      }
      return OK;
    }
    case 'project': {
      const project = value as ProjectValue;
      if (
        project.start_month !== null &&
        project.end_month !== null &&
        monthPrecedes(project.end_month, project.start_month)
      ) {
        return {
          ok: false,
          message: 'The end month precedes the start month.',
          fields: { end_month: 'Must not be earlier than start_month.' },
        };
      }
      return OK;
    }
    case 'certification': {
      const certification = value as CertificationValue;
      if (
        certification.issued_month !== null &&
        certification.expires_month !== null &&
        monthPrecedes(certification.expires_month, certification.issued_month)
      ) {
        return {
          ok: false,
          message: 'The expiry month precedes the issue month.',
          fields: { expires_month: 'Must not be earlier than issued_month.' },
        };
      }
      return OK;
    }
    default:
      return OK;
  }
}

/**
 * Validates a fact value against the schema selected by its kind, then against
 * the domain rules the schema cannot express.
 */
export function validateFactValue(kind: FactKind, value: unknown): FactValidation {
  const schema = FACT_VALUE_SCHEMAS[kind];
  if (schema === undefined) {
    return {
      ok: false,
      message: `"${kind}" is not a known fact kind.`,
      fields: { kind: 'Unknown fact kind.' },
    };
  }
  const check = checkSchema(schema, value);
  if (!check.ok) {
    return {
      ok: false,
      message: `The value does not match the schema for a "${kind}" fact.`,
      fields: check.fields,
    };
  }
  return checkDateConsistency(kind, value);
}

/** Throws 422 with a per-field map when the value is not usable. */
export function assertFactValue(kind: FactKind, value: unknown, at: string): void {
  const result = validateFactValue(kind, value);
  if (result.ok) return;
  const fields: Record<string, string> = {};
  for (const [field, message] of Object.entries(result.fields)) {
    fields[`${at}.${field}`] = message;
  }
  throw unprocessable(result.message, fields);
}

// ---------------------------------------------------------------------------
// Conflict detection
// ---------------------------------------------------------------------------

/**
 * Comparison key for a string the user or a model typed. Case and surrounding
 * whitespace are noise; anything more aggressive (stemming, fuzzy matching)
 * would start *deciding* that two employers are the same, which is exactly the
 * judgement 06_AI_PROFILE_AND_CV.md reserves for the user.
 */
export function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

interface MonthRange {
  readonly start: string | null;
  readonly end: string | null;
}

/** Closed-open month ranges overlap when neither ends before the other starts. */
export function rangesOverlap(a: MonthRange, b: MonthRange): boolean {
  const aStart = a.start ?? '0000-01';
  const bStart = b.start ?? '0000-01';
  const aEnd = a.end ?? '9999-12';
  const bEnd = b.end ?? '9999-12';
  return aStart <= bEnd && bStart <= aEnd;
}

export interface ConflictCandidate {
  readonly id: string;
  readonly kind: FactKind;
  readonly value: unknown;
}

/**
 * Decides whether a draft collides with an existing **confirmed** fact.
 *
 * A collision is reported, never resolved: the API surfaces both values and
 * the user picks (06_AI_PROFILE_AND_CV.md, AT04). Returning a human-readable
 * reason rather than a code keeps the UI honest about *why* two rows are being
 * shown side by side.
 */
export function conflictReason(
  kind: FactKind,
  draftValue: unknown,
  existing: ConflictCandidate,
): string | null {
  if (existing.kind !== kind) return null;

  switch (kind) {
    case 'experience': {
      const draft = draftValue as ExperienceValue;
      const current = existing.value as ExperienceValue;
      if (normalizeName(draft.employer) !== normalizeName(current.employer)) return null;
      if (
        !rangesOverlap(
          { start: draft.start_month, end: draft.end_month },
          { start: current.start_month, end: current.end_month },
        )
      ) {
        return null;
      }
      return `An existing confirmed role at "${current.employer}" covers overlapping dates.`;
    }
    case 'contact': {
      const draft = draftValue as ContactValue;
      const current = existing.value as ContactValue;
      // Any confirmed contact conflicts with a different proposed contact:
      // there is only one contact block, so two different ones cannot both be
      // true. An identical proposal is not a conflict, just a no-op.
      if (JSON.stringify(canonicalContact(draft)) === JSON.stringify(canonicalContact(current))) {
        return null;
      }
      return 'A confirmed contact block already exists and differs from this one.';
    }
    case 'authorization': {
      const draft = draftValue as AuthorizationValue;
      const current = existing.value as AuthorizationValue;
      if (draft.country !== current.country) return null;
      return `Work authorization for ${current.country} is already confirmed.`;
    }
    case 'skill': {
      const draft = draftValue as SkillValue;
      const current = existing.value as SkillValue;
      if (normalizeName(draft.canonical_name) !== normalizeName(current.canonical_name)) {
        return null;
      }
      return `The skill "${current.canonical_name}" is already confirmed.`;
    }
    default:
      // education, summary, project, certification and language have no
      // deterministic identity rule that would not amount to guessing. A
      // near-duplicate there is shown as an ordinary draft, which the user can
      // decline; silently merging would be worse than showing it twice.
      return null;
  }
}

/**
 * Normalises a field that may be absent or explicitly null.
 *
 * Both spellings mean "not stated" and must compare equal, or a contact that
 * omitted a phone number and one that sent `phone: null` would look like a
 * conflict and prompt the user to resolve a difference that does not exist.
 */
function normalizeOptional(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  return normalizeName(value);
}

/** Field-order-independent view of a contact for equality comparison. */
function canonicalContact(value: ContactValue): unknown {
  return {
    full_name: normalizeName(value.full_name),
    email: normalizeName(value.email),
    phone: normalizeOptional(value.phone),
    city: normalizeOptional(value.city),
    country: normalizeOptional(value.country),
    links: (value.links ?? [])
      .map((link) => `${normalizeName(link.label)}|${link.url.trim()}`)
      .sort(),
  };
}
