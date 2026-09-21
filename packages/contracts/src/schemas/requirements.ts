import { Type, type Static } from '@sinclair/typebox';

/**
 * One explicit requirement read out of a job description, with the text it
 * came from.
 *
 * This lives in its own module rather than in `jobs.ts` because both the job
 * contracts and the match contracts need it, and `jobs.ts` needs the match
 * summary in return. Defining it once here keeps that dependency in one
 * direction; duplicating the shape into `matches.ts` would create exactly the
 * parallel definition the implementation instructions forbid.
 *
 * `kind` is `unknown` when the extractor could not tell whether the posting
 * treats the requirement as mandatory. That is a real third state, not a
 * default: the matcher weighs it as preferred and says so, rather than
 * promoting it to required and overstating what the employer asked for.
 */
export const RequirementKind = Type.Union([
  Type.Literal('required'),
  Type.Literal('preferred'),
  Type.Literal('unknown'),
]);
export type RequirementKind = Static<typeof RequirementKind>;

export const ALL_REQUIREMENT_KINDS = [
  'required',
  'preferred',
  'unknown',
] as const satisfies readonly RequirementKind[];

export const JobRequirement = Type.Object(
  {
    text: Type.String({ minLength: 1, maxLength: 600 }),
    kind: RequirementKind,
    evidence_excerpt: Type.String({ minLength: 1, maxLength: 600 }),
  },
  { additionalProperties: false },
);
export type JobRequirement = Static<typeof JobRequirement>;
