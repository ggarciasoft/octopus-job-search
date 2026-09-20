import { Type, type Static } from '@sinclair/typebox';
import { IsoMonth, Locale, TriState, Timestamp, Uuid } from '../common.js';

export const FactKind = Type.Union([
  Type.Literal('contact'),
  Type.Literal('summary'),
  Type.Literal('experience'),
  Type.Literal('education'),
  Type.Literal('skill'),
  Type.Literal('language'),
  Type.Literal('authorization'),
  Type.Literal('project'),
  Type.Literal('certification'),
]);
export type FactKind = Static<typeof FactKind>;

export const ALL_FACT_KINDS = [
  'contact',
  'summary',
  'experience',
  'education',
  'skill',
  'language',
  'authorization',
  'project',
  'certification',
] as const satisfies readonly FactKind[];

const Link = Type.Object(
  {
    label: Type.String({ minLength: 1, maxLength: 60 }),
    url: Type.String({ minLength: 1, maxLength: 500 }),
  },
  { additionalProperties: false },
);

export const ContactValue = Type.Object(
  {
    full_name: Type.String({ minLength: 1, maxLength: 200 }),
    email: Type.String({ minLength: 3, maxLength: 320 }),
    phone: Type.Optional(Type.String({ maxLength: 40 })),
    city: Type.Optional(Type.String({ maxLength: 120 })),
    country: Type.Optional(Type.String({ maxLength: 120 })),
    links: Type.Optional(Type.Array(Link, { maxItems: 12 })),
  },
  { additionalProperties: false },
);
export type ContactValue = Static<typeof ContactValue>;

export const SummaryValue = Type.Object(
  { text: Type.String({ minLength: 1, maxLength: 2000 }) },
  { additionalProperties: false },
);
export type SummaryValue = Static<typeof SummaryValue>;

/**
 * A bullet always carries an evidence_reference back to the source document or
 * the user's own entry. Generated CVs may reorder, shorten or translate
 * bullets but may never introduce one without evidence (invariant 2).
 */
export const ExperienceBullet = Type.Object(
  {
    text: Type.String({ minLength: 1, maxLength: 600 }),
    evidence_reference: Type.String({ maxLength: 300 }),
  },
  { additionalProperties: false },
);
export type ExperienceBullet = Static<typeof ExperienceBullet>;

export const EmploymentType = Type.Union([
  Type.Literal('full_time'),
  Type.Literal('part_time'),
  Type.Literal('contract'),
  Type.Literal('internship'),
  Type.Literal('temporary'),
  Type.Literal('freelance'),
  Type.Literal('unknown'),
]);
export type EmploymentType = Static<typeof EmploymentType>;

export const ALL_EMPLOYMENT_TYPES = [
  'full_time',
  'part_time',
  'contract',
  'internship',
  'temporary',
  'freelance',
  'unknown',
] as const satisfies readonly EmploymentType[];

export const ExperienceValue = Type.Object(
  {
    employer: Type.String({ minLength: 1, maxLength: 200 }),
    title: Type.String({ minLength: 1, maxLength: 200 }),
    start_month: IsoMonth,
    end_month: Type.Union([IsoMonth, Type.Null()]),
    current: Type.Boolean(),
    employment_type: EmploymentType,
    location: Type.Optional(Type.String({ maxLength: 200 })),
    bullets: Type.Array(ExperienceBullet, { maxItems: 30 }),
    skills: Type.Array(Type.String({ maxLength: 80 }), { maxItems: 60 }),
  },
  { additionalProperties: false },
);
export type ExperienceValue = Static<typeof ExperienceValue>;

export const EducationValue = Type.Object(
  {
    institution: Type.String({ minLength: 1, maxLength: 200 }),
    degree: Type.Union([Type.String({ maxLength: 200 }), Type.Null()]),
    subject: Type.Union([Type.String({ maxLength: 200 }), Type.Null()]),
    start_month: Type.Union([IsoMonth, Type.Null()]),
    end_month: Type.Union([IsoMonth, Type.Null()]),
    current: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type EducationValue = Static<typeof EducationValue>;

/**
 * Proficiency is user-declared only. Nothing infers proficiency from a CV
 * mention, because that would manufacture a qualification.
 */
export const SkillValue = Type.Object(
  {
    canonical_name: Type.String({ minLength: 1, maxLength: 80 }),
    aliases: Type.Array(Type.String({ maxLength: 80 }), { maxItems: 20 }),
    user_declared_proficiency: Type.Union([
      Type.Literal('beginner'),
      Type.Literal('intermediate'),
      Type.Literal('advanced'),
      Type.Literal('expert'),
      Type.Null(),
    ]),
    years: Type.Union([Type.Number({ minimum: 0, maximum: 70 }), Type.Null()]),
  },
  { additionalProperties: false },
);
export type SkillValue = Static<typeof SkillValue>;

export const LanguageValue = Type.Object(
  {
    code: Type.String({ pattern: '^[a-z]{2}(-[A-Z]{2})?$' }),
    declared_level: Type.Union([
      Type.Literal('basic'),
      Type.Literal('conversational'),
      Type.Literal('professional'),
      Type.Literal('native'),
    ]),
  },
  { additionalProperties: false },
);
export type LanguageValue = Static<typeof LanguageValue>;

/**
 * Authorization keeps `authorized` and `sponsorship_required` as independent
 * tri-states: "remote" never implies worldwide eligibility, and an unknown
 * stays unknown rather than becoming a positive match.
 */
export const AuthorizationValue = Type.Object(
  {
    country: Type.String({ pattern: '^[A-Z]{2}$' }),
    authorized: TriState,
    sponsorship_required: TriState,
    note: Type.Optional(Type.String({ maxLength: 300 })),
  },
  { additionalProperties: false },
);
export type AuthorizationValue = Static<typeof AuthorizationValue>;

export const ProjectValue = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 200 }),
    role: Type.Union([Type.String({ maxLength: 200 }), Type.Null()]),
    url: Type.Union([Type.String({ maxLength: 500 }), Type.Null()]),
    start_month: Type.Union([IsoMonth, Type.Null()]),
    end_month: Type.Union([IsoMonth, Type.Null()]),
    bullets: Type.Array(ExperienceBullet, { maxItems: 20 }),
    skills: Type.Array(Type.String({ maxLength: 80 }), { maxItems: 40 }),
  },
  { additionalProperties: false },
);
export type ProjectValue = Static<typeof ProjectValue>;

export const CertificationValue = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 200 }),
    issuer: Type.Union([Type.String({ maxLength: 200 }), Type.Null()]),
    issued_month: Type.Union([IsoMonth, Type.Null()]),
    expires_month: Type.Union([IsoMonth, Type.Null()]),
    credential_id: Type.Union([Type.String({ maxLength: 200 }), Type.Null()]),
  },
  { additionalProperties: false },
);
export type CertificationValue = Static<typeof CertificationValue>;

/**
 * Fact values are validated against the schema selected by `kind`. The map is
 * the single source of truth shared by the API validator, the worker and the
 * generated Pydantic models.
 */
export const FACT_VALUE_SCHEMAS = {
  contact: ContactValue,
  summary: SummaryValue,
  experience: ExperienceValue,
  education: EducationValue,
  skill: SkillValue,
  language: LanguageValue,
  authorization: AuthorizationValue,
  project: ProjectValue,
  certification: CertificationValue,
} as const;

export const ProfileFact = Type.Object(
  {
    id: Uuid,
    kind: FactKind,
    value: Type.Unknown(),
    source_file_id: Type.Union([Uuid, Type.Null()]),
    source_excerpt: Type.Union([Type.String({ maxLength: 2000 }), Type.Null()]),
    confirmed: Type.Boolean(),
    revision: Type.Integer({ minimum: 1 }),
    supersedes_id: Type.Union([Uuid, Type.Null()]),
    created_at: Timestamp,
    updated_at: Timestamp,
  },
  { additionalProperties: false },
);
export type ProfileFact = Static<typeof ProfileFact>;

export const Profile = Type.Object(
  {
    id: Uuid,
    revision: Type.Integer({ minimum: 1 }),
    confirmed_revision: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    contact: Type.Union([ContactValue, Type.Null()]),
    locale: Locale,
    facts: Type.Array(ProfileFact),
    created_at: Timestamp,
    updated_at: Timestamp,
  },
  { additionalProperties: false },
);
export type Profile = Static<typeof Profile>;

export const FactChange = Type.Union([
  Type.Object(
    {
      op: Type.Literal('upsert'),
      id: Type.Optional(Uuid),
      kind: FactKind,
      value: Type.Unknown(),
      confirmed: Type.Boolean(),
      source_excerpt: Type.Optional(Type.Union([Type.String({ maxLength: 2000 }), Type.Null()])),
      source_file_id: Type.Optional(Type.Union([Uuid, Type.Null()])),
    },
    { additionalProperties: false },
  ),
  Type.Object({ op: Type.Literal('delete'), id: Uuid }, { additionalProperties: false }),
]);
export type FactChange = Static<typeof FactChange>;

/** PATCH /profile — optimistic concurrency through expected_revision. */
export const ProfilePatchRequest = Type.Object(
  {
    expected_revision: Type.Integer({ minimum: 1 }),
    contact: Type.Optional(ContactValue),
    locale: Type.Optional(Locale),
    changes: Type.Array(FactChange, { maxItems: 200 }),
  },
  { additionalProperties: false },
);
export type ProfilePatchRequest = Static<typeof ProfilePatchRequest>;
