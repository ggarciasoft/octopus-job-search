"""The Greenhouse adapter, version 1.

Greenhouse is the spec's first target ("Target Greenhouse first, Lever
second"). This adapter reads a Greenhouse-shaped application form: the
``#application_form`` / ``#application-form`` container boards have used for
years, with its labelled inputs, its ``required`` markers and its file input
for the CV.

**What "tested" means here, exactly.** The snippets below are exercised against
a synthetic Greenhouse-shaped page in
``fixtures/ats-pages/greenhouse-application.html``, driven by a real Chromium. They
have not been run against a live Greenhouse board, and no application has been
submitted through them. The support matrix must say that rather than "Greenhouse
supported"; "support badges must reflect actual tested adapters"
(docs/spec/12_IMPLEMENTATION_PLAN.md), and a fixture is not a live board.

The adapter claims a page by host *or* by that container's presence. Structure
matters as much as host because Greenhouse serves the same form from
``boards.greenhouse.io``, ``job-boards.greenhouse.io`` and from employers' own
domains through an embed - and because an adapter that only recognises a
hostname is one redirect away from filling a page it has never seen.
"""

from __future__ import annotations

from typing import Any, Final
from urllib.parse import urlsplit

from ..forms import FormSchema
from .base import parse_fields

#: Hosts Greenhouse itself serves application forms from.
GREENHOUSE_HOSTS: Final = (
    "boards.greenhouse.io",
    "job-boards.greenhouse.io",
    "my.greenhouse.io",
)

#: The container every Greenhouse application form has had. Also what the
#: synthetic fixture carries, because the fixture is a copy of the shape.
FORM_SELECTOR: Final = "#application_form, #application-form, form[action*='greenhouse']"

_MARKER_SCRIPT: Final = f"""
() => document.querySelector({FORM_SELECTOR!r}) !== null
"""

_IDENTITY_SCRIPT: Final = """
() => {
  const text = (selector) => {
    const node = document.querySelector(selector);
    return node ? node.textContent.trim() : '';
  };
  return {
    company:
      text('[data-qa="company-name"]') ||
      text('.company-name') ||
      (document.querySelector('meta[property="og:site_name"]')?.content ?? ''),
    title: text('.app-title') || text('h1') || document.title,
  };
}
"""

#: Reads the form once and returns a plain description. Everything
#: interpretive - what counts as required, what a question is called, which
#: widgets are unsupported - happens in Python, where it is unit-tested.
_INSPECT_SCRIPT: Final = f"""
() => {{
  const form = document.querySelector({FORM_SELECTOR!r});
  if (!form) return [];

  const labelFor = (el) => {{
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {{
      const parts = labelledBy.split(/\\s+/)
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map((node) => node.textContent);
      if (parts.length) return parts.join(' ');
    }}
    if (el.id) {{
      const explicit = form.querySelector(`label[for="${{CSS.escape(el.id)}}"]`);
      if (explicit) return explicit.textContent;
    }}
    const wrapping = el.closest('label');
    if (wrapping) return wrapping.textContent;
    const group = el.closest('fieldset');
    const legend = group ? group.querySelector('legend') : null;
    if (legend) return legend.textContent;
    return el.getAttribute('placeholder') || el.name || '';
  }};

  const clean = (value) => (value || '').replace(/\\s+/g, ' ').replace(/\\*$/, '').trim();
  const isRequired = (el, label) =>
    el.required === true ||
    el.getAttribute('aria-required') === 'true' ||
    /\\*\\s*$/.test(label) ||
    /\\(required\\)/i.test(label);

  const selectorFor = (el) => {{
    if (el.id) return `#${{CSS.escape(el.id)}}`;
    if (el.name) return `${{el.tagName.toLowerCase()}}[name="${{CSS.escape(el.name)}}"]`;
    return '';
  }};

  const out = [];
  const seenGroups = new Set();

  for (const el of form.querySelectorAll('input, select, textarea, [role="combobox"]')) {{
    if (el.disabled) continue;
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (type === 'hidden' || type === 'submit' || type === 'button') continue;

    const rawLabel = labelFor(el);
    const label = clean(rawLabel);
    const required = isRequired(el, rawLabel);

    if (el.tagName === 'SELECT') {{
      out.push({{
        selector: selectorFor(el),
        label,
        kind: 'select',
        required,
        options: Array.from(el.options)
          .filter((option) => option.value !== '')
          .map((option) => clean(option.textContent)),
        option_values: Array.from(el.options)
          .filter((option) => option.value !== '')
          .map((option) => option.value),
      }});
      continue;
    }}

    if (el.tagName === 'TEXTAREA') {{
      out.push({{ selector: selectorFor(el), label, kind: 'textarea', required, options: [] }});
      continue;
    }}

    if (type === 'radio' || type === 'checkbox') {{
      // One entry per group, named by its legend, with every offered option.
      const groupKey = `${{type}}:${{el.name}}`;
      if (seenGroups.has(groupKey)) continue;
      seenGroups.add(groupKey);
      const members = Array.from(form.querySelectorAll(
        `input[type="${{type}}"][name="${{CSS.escape(el.name)}}"]`,
      ));
      const fieldset = el.closest('fieldset');
      const legend = fieldset ? clean(fieldset.querySelector('legend')?.textContent) : '';
      out.push({{
        selector: `input[type="${{type}}"][name="${{CSS.escape(el.name)}}"]`,
        label: legend || label,
        kind: type,
        required: members.some((member) => isRequired(member, labelFor(member))) ||
          (fieldset ? /\\*\\s*$/.test(legend) : false),
        options: members.map((member) => clean(labelFor(member)) || member.value),
        option_values: members.map((member) => member.value),
      }});
      continue;
    }}

    if (el.getAttribute('role') === 'combobox' || el.tagName !== 'INPUT') {{
      // A custom widget: recognised, named, and reported as undriveable.
      out.push({{ selector: selectorFor(el), label, kind: 'custom', required, options: [] }});
      continue;
    }}

    out.push({{
      selector: selectorFor(el),
      label,
      kind: type || 'text',
      required,
      options: [],
    }});
  }}
  return out;
}}
"""


#: Read a post-submission confirmation, if the page is showing one.
#:
#: Deliberately conservative. It looks for Greenhouse's own confirmation
#: container and for a small set of phrasings the board actually uses, and it
#: returns ``null`` for anything else. The cost of the two mistakes is not
#: symmetric: failing to recognise a real confirmation leaves the user to say
#: so themselves, while inventing one from a stray "thank you" on a marketing
#: footer would record a submission that may never have happened.
_CONFIRMATION_SCRIPT: Final = r"""
() => {
  const clean = (value) => (value || '').replace(/\s+/g, ' ').trim();

  // Greenhouse's own confirmation container, when the board renders one.
  const container = document.querySelector(
    '#application_confirmation, .application-confirmation, [data-qa="confirmation"]'
  );

  let text = container ? clean(container.textContent) : '';

  if (!text) {
    // Otherwise accept only an explicit statement, and only from a heading or
    // a status region -- not from anywhere on the page.
    const candidates = document.querySelectorAll(
      'h1, h2, h3, [role="status"], [role="alert"], .flash-message, .status-message'
    );
    const accepted = new RegExp(
      '(application (was )?(successfully )?(submitted|received)' +
        '|thank you for applying' +
        '|your application has been (submitted|received))',
      'i'
    );
    for (const node of candidates) {
      const value = clean(node.textContent);
      if (value && accepted.test(value)) {
        text = value;
        break;
      }
    }
  }

  if (!text) return null;

  // An application/reference number when the page shows one beside the text.
  const body = clean(document.body ? document.body.textContent : '');
  const match = body.match(
    new RegExp(
      '(?:application|reference|confirmation)\\s*(?:id|number|no\\.?|#)' +
        '\\s*[:#]?\\s*([A-Za-z0-9-]{4,40})',
      'i'
    )
  );

  return {
    confirmation_text: text.slice(0, 2000),
    reference: match ? match[1] : null,
    url: window.location.href,
  };
}
"""


class GreenhouseAdapter:
    """Reads Greenhouse-shaped application forms."""

    name = "greenhouse"
    version = "greenhouse/v1"

    def handles(self, url: str, marker_found: bool) -> bool:
        host = urlsplit(url).hostname or ""
        if host in GREENHOUSE_HOSTS or host.endswith(".greenhouse.io"):
            return True
        # An embed on the employer's own domain is still a Greenhouse form, and
        # the container is the thing this adapter actually knows how to drive.
        return marker_found

    @property
    def marker_script(self) -> str:
        return _MARKER_SCRIPT

    @property
    def identity_script(self) -> str:
        return _IDENTITY_SCRIPT

    @property
    def inspect_script(self) -> str:
        return _INSPECT_SCRIPT

    def parse_inspection(self, raw: Any) -> FormSchema:
        return FormSchema(fields=parse_fields(raw))

    @property
    def confirmation_script(self) -> str:
        return _CONFIRMATION_SCRIPT
