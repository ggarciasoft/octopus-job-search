/**
 * Reading a post-submission confirmation, for every adapter.
 *
 * A port of `CONFIRMATION_SCRIPT` in
 * `services/worker/src/job_getter_worker/runner/adapters/base.py`, line for
 * line, and pinned to it by `fixtures/fill-planner/greenhouse-confirmation.json`.
 * Written for Greenhouse; Lever reuses it unchanged, because Lever's
 * confirmation page has never been seen — seeing one means submitting an
 * application.
 */

/** What a confirmation page said, in the shape the runner's script returns. */
export interface RawConfirmation {
  readonly confirmation_text: string;
  readonly reference: string | null;
  readonly url: string;
}

/**
 * Whitespace only. Not `clean`, which also drops a trailing required-marker
 * asterisk from labels: the runner's confirmation script does not, and a
 * reader that disagreed with it about one character would store different
 * evidence for the same page.
 */
function collapse(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

const CONFIRMATION_CONTAINER =
  '#application_confirmation, .application-confirmation, [data-qa="confirmation"]';
const CONFIRMATION_CANDIDATES =
  'h1, h2, h3, [role="status"], [role="alert"], .flash-message, .status-message';
const ACCEPTED_CONFIRMATION = new RegExp(
  '(application (was )?(successfully )?(submitted|received)' +
    '|thank you for applying' +
    '|your application has been (submitted|received))',
  'i',
);
// A literal, not `new RegExp('…')`: in a string, `\s` has to be written `\\s`,
// and a lost backslash silently turns "whitespace" into the letter s.
const CONFIRMATION_REFERENCE =
  /(?:application|reference|confirmation)\s*(?:id|number|no\.?|#)\s*[:#]?\s*([A-Za-z0-9-]{4,40})/i;

/**
 * Read a post-submission confirmation, if the page is showing one.
 *
 * The runner's `CONFIRMATION_SCRIPT`, line for line, and pinned to it by
 * `fixtures/fill-planner/greenhouse-confirmation.json`. Deliberately
 * conservative, for the same reason: failing to recognise a real
 * confirmation leaves the person to say so themselves, while inventing one
 * from a stray "thank you" in a footer would record a submission that may
 * never have happened.
 */
export function readConfirmation(root: Document, url: string): RawConfirmation | null {
  const container = root.querySelector(CONFIRMATION_CONTAINER);
  let text = container ? collapse(container.textContent) : '';

  if (!text) {
    // Otherwise accept only an explicit statement, and only from a heading or
    // a status region, not from anywhere on the page.
    for (const node of Array.from(root.querySelectorAll(CONFIRMATION_CANDIDATES))) {
      const value = collapse(node.textContent);
      if (value && ACCEPTED_CONFIRMATION.test(value)) {
        text = value;
        break;
      }
    }
  }

  if (!text) return null;

  // An application or reference number when the page shows one beside the text.
  const body = collapse(root.body ? root.body.textContent : '');
  const match = body.match(CONFIRMATION_REFERENCE);
  return {
    confirmation_text: text.slice(0, 2000),
    reference: match ? (match[1] ?? null) : null,
    url,
  };
}
