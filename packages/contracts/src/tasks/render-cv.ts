import { Type, type Static } from '@sinclair/typebox';
import { Locale, Uuid } from '../common.js';
import { ProfileFact } from '../schemas/profile.js';
import { JobRequirement } from '../schemas/requirements.js';
import { ResumeDocument, ResumeValidation } from '../schemas/resumes.js';

/**
 * `render_cv` (PR07): turn confirmed facts into a reviewable document and two
 * files.
 *
 * The job is present so the worker can *choose emphasis* — which experience
 * leads, which skills surface first — and for nothing else. It is untrusted
 * data (invariant 9): the worker quotes it at most, and never lets it
 * introduce a fact about the user.
 */
export const RENDER_CV_LIMITS = {
  maxBulletsPerEntry: 8,
  maxBulletChars: 300,
  maxSummaryChars: 800,
  /** Above this the document is too long to review sensibly in one pass. */
  maxEntries: 60,
} as const;

/**
 * What the CV may draw on. Only confirmed facts: a draft is a parsing proposal
 * the user has not agreed to, and printing one onto their CV would be putting
 * words in their mouth in the most literal sense.
 */
export const RenderCvInput = Type.Object(
  {
    resume_id: Uuid,
    profile_revision: Type.Integer({ minimum: 1 }),
    language: Locale,
    template_id: Type.Union([Type.Literal('simple')]),
    page_target: Type.Integer({ minimum: 1, maximum: 3 }),
    confirmed_facts: Type.Array(ProfileFact, { maxItems: 500 }),
    /** Present when tailoring; null for a job-independent CV. */
    job: Type.Union([
      Type.Object(
        {
          job_id: Uuid,
          job_revision: Type.Integer({ minimum: 1 }),
          company: Type.String({ maxLength: 200 }),
          title: Type.String({ maxLength: 300 }),
          requirements: Type.Array(JobRequirement, { maxItems: 200 }),
        },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
    /**
     * Level 2 customisation. May adjust tone or emphasis; may not change a
     * factual constraint, which the prompt enforces structurally rather than
     * by trusting the text.
     */
    prompt_style_suffix: Type.Union([Type.String({ maxLength: 1000 }), Type.Null()]),
  },
  { additionalProperties: false },
);
export type RenderCvInput = Static<typeof RenderCvInput>;

export const RenderCvResult = Type.Object(
  {
    document_json: ResumeDocument,
    validation: ResumeValidation,
    /** Uploaded as task artifacts before the result is posted. */
    pdf_file_id: Type.Union([Uuid, Type.Null()]),
    docx_file_id: Type.Union([Uuid, Type.Null()]),
    fact_ids: Type.Array(Uuid, { maxItems: 500 }),
  },
  { additionalProperties: false },
);
export type RenderCvResult = Static<typeof RenderCvResult>;
