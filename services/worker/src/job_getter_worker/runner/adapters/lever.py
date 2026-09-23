"""The Lever adapter, version 1.

Lever is the spec's second target ("Target Greenhouse first, Lever second").
This adapter reads a Lever-hosted application page: ``form#application-form``
on ``jobs.lever.co``, built from ``.application-question`` blocks, each with a
``div.application-label`` naming the question and a ``span.required`` holding
the heavy asterisk (U+2731) Lever marks a required question with.

**What "tested" means here, exactly.** The snippets below are exercised against
a synthetic Lever-shaped page in ``fixtures/ats-pages/lever-application.html``,
driven by a real Chromium. The fixture's shape was copied from one public
Lever demo posting's apply page, read once and not committed; it has not been
filled on a live board and nothing has been submitted through it. Lever's
confirmation page has never been seen, because seeing one means submitting an
application, so this adapter reads confirmations with the same conservative
script Greenhouse uses.

Lever differs from Greenhouse in four ways the reader has to get right, and
each is a way a naive port would say something false:

* **The label is a div, inside a wrapping ``<label>``.** The wrapping label's
  text also carries the upload button's captions and, on the EEO questions,
  paragraphs describing each option. The question is named by its
  ``.application-label`` alone.
* **Location is an autocomplete.** A typed string is not a chosen location, so
  ``.location-input`` is reported as a widget the person completes.
* **Voluntary sections are demographic whatever they are called.** The EEO
  section and the demographic survey include questions labelled "Name",
  "Date" and "What is your age range?" - the first two are the signature on a
  disability self-identification form. Every control there is labelled
  "Voluntary self-identification: ..." so the shared planner classifies it
  ``never_reuse`` and leaves it to the person.
* **A choice group can carry its own free-text box.** Lever's pronouns
  question has a hidden text input with the group's name for a custom answer.
  It is part of that group, not a second question. A control with no name is
  never submitted with the form, so it is not a question either.

The adapter claims a page by host, or by the question blocks inside
``#application-form``. The Greenhouse adapter's container selector matches
that form id too, which is why it refuses a page this module's marker claims.
"""

from __future__ import annotations

from typing import Any, Final
from urllib.parse import urlsplit

from ..forms import FormSchema
from .base import CONFIRMATION_SCRIPT, parse_fields

#: Hosts Lever serves application pages from.
LEVER_HOSTS: Final = (
    "jobs.lever.co",
    "jobs.eu.lever.co",
)

FORM_SELECTOR: Final = "form#application-form"

#: What makes a form Lever's rather than merely an ``#application-form``.
LEVER_MARKER_SELECTOR: Final = "form#application-form .application-question .application-label"

#: The prefix every control in a voluntary self-identification section gets.
VOLUNTARY_PREFIX: Final = "Voluntary self-identification: "

_MARKER_SCRIPT: Final = f"""
() => document.querySelector({LEVER_MARKER_SELECTOR!r}) !== null
"""

_IDENTITY_SCRIPT: Final = r"""
() => {
  const text = (selector) => {
    const node = document.querySelector(selector);
    return node ? node.textContent.trim() : '';
  };
  // The page title is "Company - Role"; the logo's alt is "Company logo".
  const parts = (document.title || '').split(' - ');
  const logo = document.querySelector('.main-header-logo img');
  const alt = logo ? (logo.getAttribute('alt') || '').replace(/\s+logo\s*$/i, '').trim() : '';
  return {
    company: alt || (parts.length > 1 ? parts[0].trim() : ''),
    title:
      text('.posting-header h2') ||
      text('.posting-headline h2') ||
      (parts.length > 1 ? parts.slice(1).join(' - ').trim() : ''),
  };
}
"""

#: Reads the form once and returns the same plain shape the Greenhouse snippet
#: does, so the shared parser and planner interpret it identically.
_INSPECT_SCRIPT: Final = r"""
() => {
  const form = document.querySelector(__FORM__);
  if (!form) return [];

  const PREFIX = __PREFIX__;
  const clean = (value) =>
    (value || '').replace(/\s+/g, ' ').replace(/[*✱]\s*$/, '').trim();

  const questionOf = (el) => el.closest('.application-question');
  const questionLabel = (question) => {
    const label = question ? question.querySelector('.application-label') : null;
    if (!label) return '';
    // The survey puts a description beside the question; `.text` is the question.
    const own = label.querySelector('.text');
    return (own || label).textContent || '';
  };
  const marked = (question) =>
    question !== null && question.querySelector('.application-label .required') !== null;

  const labelFor = (el) => {
    const own = questionLabel(questionOf(el));
    if (own.trim()) return own;
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
    const wrapping = el.closest('label');
    if (wrapping) return wrapping.textContent;
    return el.getAttribute('placeholder') || el.getAttribute('name') || '';
  };
  const voluntary = (el) =>
    el.closest('.eeo-section') !== null ||
    /^(eeo|surveysResponses)\[/.test(el.getAttribute('name') || '');
  const nameOf = (el, raw) => (voluntary(el) ? PREFIX : '') + clean(raw);

  const isRequired = (el, raw) =>
    el.required === true ||
    el.getAttribute('aria-required') === 'true' ||
    marked(questionOf(el)) ||
    /[*✱]\s*$/.test(raw || '');

  const optionLabel = (member) => {
    const wrapping = member.closest('label');
    const alternative = wrapping ? wrapping.querySelector('.application-answer-alternative') : null;
    return clean(alternative ? alternative.textContent : wrapping ? wrapping.textContent : '') ||
      member.value;
  };

  const selectorFor = (el) => {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const name = el.getAttribute('name');
    if (name) return `${el.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
    return '';
  };

  const controls = Array.from(
    form.querySelectorAll('input, select, textarea, [role="combobox"]'),
  );
  const groupNames = new Set(
    controls
      .filter((el) => {
        const type = (el.getAttribute('type') || '').toLowerCase();
        return (type === 'radio' || type === 'checkbox') && el.getAttribute('name');
      })
      .map((el) => el.getAttribute('name')),
  );

  const out = [];
  const seenGroups = new Set();

  for (const el of controls) {
    if (el.disabled) continue;
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (type === 'hidden' || type === 'submit' || type === 'button') continue;
    const name = el.getAttribute('name') || '';
    const combobox = el.getAttribute('role') === 'combobox';
    // Never submitted with the form, so not a question: Lever's "Custom"
    // pronouns checkbox only reveals the text box below.
    if (!name && !combobox) continue;

    const rawLabel = labelFor(el);
    const label = nameOf(el, rawLabel);
    const required = isRequired(el, rawLabel);

    if (el.tagName === 'SELECT') {
      const options = Array.from(el.options).filter((option) => option.value !== '');
      out.push({
        selector: selectorFor(el),
        label,
        kind: 'select',
        required,
        options: options.map((option) => clean(option.textContent)),
        option_values: options.map((option) => option.value),
      });
      continue;
    }

    if (el.tagName === 'TEXTAREA') {
      out.push({ selector: selectorFor(el), label, kind: 'textarea', required, options: [] });
      continue;
    }

    if (type === 'radio' || type === 'checkbox') {
      const groupKey = `${type}:${name}`;
      if (seenGroups.has(groupKey)) continue;
      seenGroups.add(groupKey);
      const members = Array.from(
        form.querySelectorAll(`input[type="${type}"][name="${CSS.escape(name)}"]`),
      );
      out.push({
        selector: `input[type="${type}"][name="${CSS.escape(name)}"]`,
        label,
        kind: type,
        required: required || members.some((member) => member.required === true),
        options: members.map(optionLabel),
        option_values: members.map((member) => member.value),
      });
      continue;
    }

    // The free-text answer that belongs to a choice group, not a question of its own.
    if (groupNames.has(name)) continue;

    if (combobox || el.tagName !== 'INPUT' || el.classList.contains('location-input')) {
      // An autocomplete or custom widget: named, and reported as undriveable.
      out.push({ selector: selectorFor(el), label, kind: 'custom', required, options: [] });
      continue;
    }

    out.push({ selector: selectorFor(el), label, kind: type || 'text', required, options: [] });
  }
  return out;
}
""".replace("__FORM__", repr(FORM_SELECTOR)).replace("__PREFIX__", repr(VOLUNTARY_PREFIX))


class LeverAdapter:
    """Reads Lever-hosted application forms."""

    name = "lever"
    version = "lever/v1"

    def handles(self, url: str, marker_found: bool) -> bool:
        host = urlsplit(url).hostname or ""
        if host in LEVER_HOSTS:
            return True
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
        return CONFIRMATION_SCRIPT
