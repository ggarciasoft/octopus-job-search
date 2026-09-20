/**
 * Fact values as the forms and summaries see them.
 *
 * Every type here is the contract's own (`FACT_VALUE_SCHEMAS` selects the
 * schema by `kind`); nothing is re-declared. The client-side checks below
 * mirror the rules the API enforces in `apps/api/src/profile/facts.ts` so a
 * contradiction is caught before the round trip — the API stays the authority
 * and its field errors are still shown when it disagrees.
 */
import {
  ALL_FACT_KINDS,
  AuthorizationValue as AuthorizationSchema,
  IsoMonth,
  LanguageValue as LanguageSchema,
  type AuthorizationValue,
  type CertificationValue,
  type ContactValue,
  type EducationValue,
  type ExperienceValue,
  type FactKind,
  type LanguageValue,
  type ProjectValue,
  type SkillValue,
  type SummaryValue,
} from '@job-getter/contracts';
import type { MessageKey } from '../i18n/messages';

export interface FactValueMap {
  readonly contact: ContactValue;
  readonly summary: SummaryValue;
  readonly experience: ExperienceValue;
  readonly education: EducationValue;
  readonly skill: SkillValue;
  readonly language: LanguageValue;
  readonly authorization: AuthorizationValue;
  readonly project: ProjectValue;
  readonly certification: CertificationValue;
}

/** A kind together with a value of that kind's type. */
export type FactDraft = {
  [K in FactKind]: { readonly kind: K; readonly value: FactValueMap[K] };
}[FactKind];

/**
 * Display order for the grouped sections on the profile screen
 * (08_UX_AND_CUSTOMIZATION.md: contact, employment, projects, education,
 * skills, languages, eligibility). Contact is rendered first, on its own.
 */
export const FACT_SECTION_ORDER: readonly Exclude<FactKind, 'contact'>[] = [
  'experience',
  'education',
  'skill',
  'language',
  'authorization',
  'project',
  'certification',
  'summary',
];

export function isFactKind(value: unknown): value is FactKind {
  return typeof value === 'string' && (ALL_FACT_KINDS as readonly string[]).includes(value);
}

/** Patterns come from the contract schemas, never from a second copy. */
const MONTH_PATTERN = new RegExp(IsoMonth.pattern ?? '^$');
const COUNTRY_PATTERN = new RegExp(AuthorizationSchema.properties.country.pattern ?? '^$');
const LANGUAGE_PATTERN = new RegExp(LanguageSchema.properties.code.pattern ?? '^$');

export function isIsoMonth(value: string): boolean {
  return MONTH_PATTERN.test(value);
}

export function isCountryCode(value: string): boolean {
  return COUNTRY_PATTERN.test(value);
}

export function isLanguageCode(value: string): boolean {
  return LANGUAGE_PATTERN.test(value);
}

/**
 * The starting value for a fact typed by hand. Tri-states start as `unknown`
 * and proficiency as "not declared": a blank form must never default a user
 * into a positive answer (01_PRODUCT_REQUIREMENTS.md).
 */
export function emptyFactValue<K extends FactKind>(kind: K): FactValueMap[K] {
  const values: FactValueMap = {
    contact: { full_name: '', email: '', phone: null, city: null, country: null, links: [] },
    summary: { text: '' },
    experience: {
      employer: '',
      title: '',
      start_month: '',
      end_month: null,
      current: false,
      employment_type: 'unknown',
      location: null,
      bullets: [],
      skills: [],
    },
    education: {
      institution: '',
      degree: null,
      subject: null,
      start_month: null,
      end_month: null,
      current: false,
    },
    skill: { canonical_name: '', aliases: [], user_declared_proficiency: null, years: null },
    language: { code: '', declared_level: 'conversational' },
    authorization: {
      country: '',
      authorized: 'unknown',
      sponsorship_required: 'unknown',
      note: null,
    },
    project: {
      name: '',
      role: null,
      url: null,
      start_month: null,
      end_month: null,
      bullets: [],
      skills: [],
    },
    certification: {
      name: '',
      issuer: null,
      issued_month: null,
      expires_month: null,
      credential_id: null,
    },
  };
  return values[kind];
}

/**
 * Narrows an API value to its kind's type. Values on the wire were validated
 * by the API against the same schema, so this is a shape check, not a
 * re-validation; a non-object is reported as unreadable rather than guessed at.
 */
export function asFactDraft(kind: FactKind, value: unknown): FactDraft | null {
  if (typeof value !== 'object' || value === null) return null;
  return { kind, value } as FactDraft;
}

export type FieldErrors = Readonly<Record<string, MessageKey>>;

function requireText(errors: Record<string, MessageKey>, field: string, value: unknown): void {
  if (typeof value !== 'string' || value.trim() === '') errors[field] = 'factForm.required';
}

function checkMonth(errors: Record<string, MessageKey>, field: string, value: string | null): void {
  if (value !== null && value !== '' && !isIsoMonth(value)) errors[field] = 'factForm.monthFormat';
}

function checkRange(
  errors: Record<string, MessageKey>,
  startField: string,
  start: string | null,
  endField: string,
  end: string | null,
): void {
  if (
    start !== null &&
    end !== null &&
    isIsoMonth(start) &&
    isIsoMonth(end) &&
    end < start &&
    errors[endField] === undefined
  ) {
    errors[endField] = 'factForm.endBeforeStart';
  }
  void startField;
}

/**
 * The rules from `apps/api/src/profile/facts.ts`, applied before submit:
 * required identifiers, `YYYY-MM` months, `current` excludes an end month,
 * and an end month never precedes its start.
 */
export function validateFactDraft(draft: FactDraft): FieldErrors {
  const errors: Record<string, MessageKey> = {};
  switch (draft.kind) {
    case 'contact': {
      requireText(errors, 'full_name', draft.value.full_name);
      requireText(errors, 'email', draft.value.email);
      (draft.value.links ?? []).forEach((link, index) => {
        requireText(errors, `links.${index}.label`, link.label);
        requireText(errors, `links.${index}.url`, link.url);
      });
      break;
    }
    case 'summary':
      requireText(errors, 'text', draft.value.text);
      break;
    case 'experience': {
      const value = draft.value;
      requireText(errors, 'employer', value.employer);
      requireText(errors, 'title', value.title);
      requireText(errors, 'start_month', value.start_month);
      if (value.start_month !== '') checkMonth(errors, 'start_month', value.start_month);
      checkMonth(errors, 'end_month', value.end_month);
      if (value.current && value.end_month !== null) {
        errors['end_month'] = 'factForm.currentHasEnd';
      }
      checkRange(errors, 'start_month', value.start_month, 'end_month', value.end_month);
      value.bullets.forEach((bullet, index) => {
        requireText(errors, `bullets.${index}.text`, bullet.text);
      });
      break;
    }
    case 'education': {
      const value = draft.value;
      requireText(errors, 'institution', value.institution);
      checkMonth(errors, 'start_month', value.start_month);
      checkMonth(errors, 'end_month', value.end_month);
      if (value.current && value.end_month !== null) {
        errors['end_month'] = 'factForm.currentHasEnd';
      }
      checkRange(errors, 'start_month', value.start_month, 'end_month', value.end_month);
      break;
    }
    case 'skill': {
      requireText(errors, 'canonical_name', draft.value.canonical_name);
      const years = draft.value.years;
      if (years !== null && (!Number.isFinite(years) || years < 0 || years > 70)) {
        errors['years'] = 'factForm.yearsRange';
      }
      break;
    }
    case 'language':
      if (!isLanguageCode(draft.value.code)) errors['code'] = 'factForm.languageCode';
      break;
    case 'authorization':
      if (!isCountryCode(draft.value.country)) errors['country'] = 'factForm.countryCode';
      break;
    case 'project': {
      const value = draft.value;
      requireText(errors, 'name', value.name);
      checkMonth(errors, 'start_month', value.start_month);
      checkMonth(errors, 'end_month', value.end_month);
      checkRange(errors, 'start_month', value.start_month, 'end_month', value.end_month);
      value.bullets.forEach((bullet, index) => {
        requireText(errors, `bullets.${index}.text`, bullet.text);
      });
      break;
    }
    case 'certification': {
      const value = draft.value;
      requireText(errors, 'name', value.name);
      checkMonth(errors, 'issued_month', value.issued_month);
      checkMonth(errors, 'expires_month', value.expires_month);
      checkRange(errors, 'issued_month', value.issued_month, 'expires_month', value.expires_month);
      break;
    }
  }
  return errors;
}

/** Text area content, one entry per line, trimmed, blanks dropped. */
export function linesToList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

export function listToLines(items: readonly string[]): string {
  return items.join('\n');
}

/** Empty input means "not stated": stored as `null`, never as `""`. */
export function textOrNull(text: string): string | null {
  return text === '' ? null : text;
}

/**
 * Runtime option lists read from a contract union schema, so a select never
 * carries a hand-written copy of an enum. `T` is the schema's own static
 * type; callers pass it explicitly because `anyOf` may also contain `null`.
 */
export function literalOptions<T extends string>(
  schema: { readonly anyOf: ReadonlyArray<unknown> } | { readonly const: unknown },
): readonly T[] {
  // TypeBox collapses a one-member union to the literal itself.
  const members = 'anyOf' in schema ? schema.anyOf : [schema];
  return members.flatMap((entry) =>
    typeof entry === 'object' &&
    entry !== null &&
    'const' in entry &&
    typeof (entry as { const: unknown }).const === 'string'
      ? [(entry as { const: T }).const]
      : [],
  );
}
