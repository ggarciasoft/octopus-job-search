/**
 * What the extension does with a fill session, as a pure function of what it
 * was granted and what the page turned out to be.
 *
 * Kept free of `chrome.*` so the judgement is testable without a browser — the
 * same split the Python runner uses, and for the same reason: the interesting
 * decisions are "is this the right page", "what may be typed" and "what must
 * the person be asked", and none of them needs an extension to be exercised.
 *
 * Every decision here is the shared planner's or the shared identity check's.
 * There is no extension-specific matching, because a per-client planner would
 * be a per-client opportunity to relax the exact-match rule on a
 * work-authorization question.
 */
import type { FillSessionGrant, ReportFillSessionRequest } from '@job-getter/contracts';
import {
  buildPlan,
  checkIdentity,
  fingerprintMaterial,
  hasUnresolvedRequired,
  parseFields,
  parseIdentity,
  type FormField,
  type PlannedValue,
} from '@job-getter/fill-planner';

export interface InspectedPage {
  readonly url: string;
  readonly identity: unknown;
  readonly fields: unknown;
}

/** What the content script will be told to type, and nothing more. */
export interface FillInstruction {
  readonly selector: string;
  readonly kind: string;
  readonly values: readonly string[];
}

export type Decision =
  | {
      /** Type these, then report. */
      readonly kind: 'fill';
      readonly instructions: readonly FillInstruction[];
      /**
       * The file control, when the page has one and the packet names a CV.
       * Carried in full rather than as a selector, because a CV that fails to
       * attach has to be reported as *that question*, unresolved, and the
       * person told — not dropped.
       */
      readonly attachment: {
        readonly selector: string;
        readonly questionKey: string;
        readonly label: string | null;
        readonly required: boolean;
      } | null;
      readonly report: ReportFillSessionRequest;
    }
  | {
      /**
       * Do not touch the page. Report and stop — `unsupported` keeps the
       * packet and its approval so the person can apply by hand (AT17), and a
       * mismatched identity is the same refusal for a different reason.
       */
      readonly kind: 'refuse';
      readonly reason: string;
      readonly report: ReportFillSessionRequest;
    };

/**
 * The material a form's fingerprint is taken over.
 *
 * Exposed separately because `crypto.subtle.digest` is asynchronous and the
 * planner is deliberately not: the caller hashes this string, then passes the
 * result to `decide`. Keeping the digest outside also means the one piece that
 * must stay byte-identical with the Python runner is the pure string, which is
 * exactly what the parity fixtures pin.
 */
export function formFingerprintMaterial(page: InspectedPage): string {
  return fingerprintMaterial(parseFields(page.fields));
}

/** `v1:` plus the first 32 hex characters, matching `forms.py`. */
export function formFingerprint(digestHex: string): string {
  return `v1:${digestHex.slice(0, 32)}`;
}

/** Decide what to do with a page the content script has read. */
export function decide(
  grant: FillSessionGrant,
  page: InspectedPage,
  options: {
    /** `formFingerprint(await sha256Hex(formFingerprintMaterial(page)))`. */
    readonly fingerprint: string | null;
    readonly adapter: string | null;
    readonly adapterVersion: string | null;
  },
): Decision {
  const fields = parseFields(page.fields);
  const pageOrigin = originOf(page.url);
  const identity = parseIdentity(page.identity, page.url, pageOrigin ?? '');

  const base = {
    adapter: options.adapter,
    adapter_version: options.adapterVersion,
    page_url: page.url,
    form_fingerprint: fields.length === 0 ? null : options.fingerprint,
  };

  // The tab must still be the origin the session was granted for. The service
  // worker checks this on the message too; checking it again here means a
  // future caller that forgets cannot fill the wrong site.
  if (pageOrigin !== grant.origin) {
    return {
      kind: 'refuse',
      reason: `the tab is on ${pageOrigin ?? 'an unreadable URL'}, not ${grant.origin}`,
      report: { ...base, filled_fields: [], unresolved_fields: [], outcome: 'unsupported' },
    };
  }

  // No readable form is not "a form with no fields": it is a page this
  // adapter does not understand. AT17's honest fallback.
  if (fields.length === 0) {
    return {
      kind: 'refuse',
      reason: 'no application form this version can read',
      report: { ...base, filled_fields: [], unresolved_fields: [], outcome: 'unsupported' },
    };
  }

  const match = checkIdentity(identity, grant.job.company, grant.job.title);
  if (!match.matches) {
    return {
      kind: 'refuse',
      reason: match.reason ?? 'the page is not the job this packet names',
      report: { ...base, filled_fields: [], unresolved_fields: [], outcome: 'unsupported' },
    };
  }

  const plan = buildPlan(fields, grant.fields, { hasAttachment: grant.resume_file_id !== null });

  const typed = plan.values.filter((value) => !value.upload);
  const attachment = plan.values.find((value) => value.upload) ?? null;

  return {
    kind: 'fill',
    instructions: typed.map(toInstruction),
    attachment:
      attachment === null
        ? null
        : {
            selector: attachment.field.selector,
            questionKey: attachment.field.key,
            label: attachment.field.label === '' ? null : attachment.field.label,
            required: attachment.field.required,
          },
    report: {
      ...base,
      // Filled outcomes are overwritten by what the content script actually
      // managed; this is the plan's view, and the caller replaces it.
      filled_fields: typed.map((value) => ({
        question_key: value.field.key,
        outcome: 'filled' as const,
        matched_label: value.field.label === '' ? null : value.field.label,
      })),
      unresolved_fields: [...plan.unresolved],
      // The same rule the runner applies: an unresolved *required* question is
      // what makes this a pause rather than a finished form. There is no
      // `submitted`: the person presses submit.
      outcome: hasUnresolvedRequired(plan) ? 'needs_input' : 'awaiting_user_submit',
    },
  };
}

function toInstruction(value: PlannedValue): FillInstruction {
  return { selector: value.field.selector, kind: value.field.kind, values: [...value.values] };
}

export function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * The report to send when the CV could not be attached.
 *
 * "Where browser/site restrictions prevent it, show a download-and-attach
 * step." A file input the extension planned to fill and then could not is the
 * same situation as one it never could: an unresolved question, which the API
 * turns into a question in the next packet revision. Silently omitting it
 * would leave the person believing a CV was sent.
 */
export function withBlockedAttachment(
  report: ReportFillSessionRequest,
  attachment: { questionKey: string; label: string | null; required: boolean },
): ReportFillSessionRequest {
  return {
    ...report,
    unresolved_fields: [
      ...report.unresolved_fields,
      {
        question_key: attachment.questionKey,
        label: attachment.label,
        required: attachment.required,
        reason: 'file_upload_blocked',
        options: [],
      },
    ],
    outcome: attachment.required ? 'needs_input' : report.outcome,
  };
}

/** Fields the page offered, for the popup to explain what will happen. */
export function summarise(grant: FillSessionGrant, fields: readonly FormField[]): string {
  return `${fields.length} field(s) on ${grant.origin}; ${grant.fields.length} answer(s) in the packet`;
}
