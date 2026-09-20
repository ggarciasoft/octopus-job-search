# Fixtures

Deterministic test data for CI and local development.

> ## 🚫 The one rule
>
> **Synthetic data only. No personal CVs, no real work history, no real contact
> details — ever, in git.**
>
> Not yours, not a friend's, not one you found online. Not "anonymised". Not
> "just for a moment while I debug". `docs/spec/11_TESTING_ACCEPTANCE.md` is
> explicit: _"no personal data in CI fixtures"_, and
> `docs/spec/00_AI_IMPLEMENTATION_INSTRUCTIONS.md` closes with _"Keep secrets and
> personal CVs out of git."_
>
> Git history is effectively permanent, and this repository is intended to be
> public. A real CV committed here is a real person's name, address, phone
> number and employment history published to the internet.

---

## Why fixtures exist

Three reasons, all of which matter:

1. **CI must not depend on a third party.** A test that fetches a live job board
   fails when the board is down, changes its markup, or rate-limits the runner —
   and tells you nothing about your code.
2. **The hard cases are the ones you cannot find on demand.** An encrypted PDF,
   a scanned CV with no extractable text, a `.docx` that is actually PDF bytes, a
   job description containing a prompt injection. These are exactly the inputs
   that must fail _gracefully_, and you cannot wait for one to turn up.
3. **Determinism.** The same bytes produce the same result on every machine, so
   a failure is a real regression rather than an environmental accident.

---

## What is here

### `cvs/` — document parsing fixtures

Every file is synthetic. The people, companies and dates are invented.

| File                      | Property it exists to test                                                                                                                     |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `text-cv.pdf`             | Happy path. Two pages with extractable text.                                                                                                   |
| `text-cv-es.pdf`          | Spanish, with accented characters. Guards the English/Spanish flow (AT27) and text-extraction encoding (AT12).                                 |
| `text-cv.docx`            | Employment history inside a **table** — a shape naive DOCX parsers silently skip.                                                              |
| `prompt-injection-cv.pdf` | Contains text engineered to manipulate a model. Nothing in it may be executed or obeyed (AT09).                                                |
| `scanned-cv.pdf`          | **No extractable text.** Must produce an explicit, supported error — never an invented profile (AT03).                                         |
| `encrypted-cv.pdf`        | Password-protected. Must fail cleanly (AT03).                                                                                                  |
| `too-short.pdf`           | Technically valid, far too little content to extract a profile from. Must not be "helpfully" padded out.                                       |
| `malformed.pdf`           | Corrupt container. Must not crash the worker (AT03).                                                                                           |
| `malformed.docx`          | Corrupt container. Same (AT03).                                                                                                                |
| `mislabelled.docx`        | **PDF bytes with a `.docx` extension.** Proves validation checks the file _signature_, not just the name (`docs/spec/09_SECURITY_PRIVACY.md`). |
| `linkedin-export.txt`     | User-provided LinkedIn text export. The _only_ supported LinkedIn path — no scraping, no Easy Apply.                                           |
| `ambiguous.txt`           | Plain text a parser cannot confidently interpret. Ambiguity must surface to the user, not be resolved by guessing.                             |

### `model-responses/` — deterministic fake provider replies

So provider-handling code can be tested with no API key, no network and no cost.

| File                                     | Property it exists to test                                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `parse_profile.text-cv.json`             | A well-formed extraction result.                                                                                   |
| `parse_profile.ambiguous.json`           | Low-confidence output. `confidence` is a parsing aid, **never** fact confirmation.                                 |
| `parse_profile.conflicting.json`         | Contradicts already-confirmed facts. Verified facts must be preserved until the user resolves the conflict (AT04). |
| `parse_profile.prompt-injection-cv.json` | What a model returns for the injected document. No instruction may be executed (AT09).                             |
| `provider.always-invalid.json`           | Output that never validates against the closed schema. The system must fail honestly, not coerce it into shape.    |
| `provider.malformed-then-valid.json`     | Malformed first, valid on retry. Exercises bounded retry without masking a persistent failure.                     |

### `generate.py` and `verify.py`

- **`generate.py`** builds the corpus. Deterministic: same input, same bytes.
- **`verify.py`** asserts each fixture _really has_ the property its tests rely
  on — that `scanned-cv.pdf` genuinely has no extractable text, that
  `encrypted-cv.pdf` genuinely will not open without a password, that
  `mislabelled.docx` genuinely starts with PDF magic bytes.

  This matters more than it sounds. A "scanned" PDF that quietly gained
  extractable text would make AT03 pass **for the wrong reason**, and nobody
  would notice.

- **`MANIFEST.sha256`** records the checksum of every fixture, so an accidental
  edit is visible.

  > **Note:** `verify.py` hashes _every_ non-`.py` file under `fixtures/`, which
  > includes **this README**. Editing this file therefore changes the manifest
  > and fails the determinism check until the manifest is regenerated (delete
  > `MANIFEST.sha256` and re-run `verify.py`, which rewrites it). A one-line fix
  > in `verify.py` — excluding `.md` alongside `.py` — would make documentation
  > edits free; it has not been made here because `verify.py` belongs to the
  > fixtures owner.

**46 of 46 checks passed**, verified on 2026-09-20 with
`uv run python ../../fixtures/verify.py` (exit 0), and the corpus is
byte-for-byte reproducible.

```bash
cd services/worker
uv run python ../../fixtures/verify.py     # assert every property still holds
uv run python ../../fixtures/generate.py   # rebuild; must not change any bytes
uv run python ../../fixtures/verify.py     # and re-assert
```

CI runs exactly this (the `fixtures` job in `.github/workflows/ci.yml`) and
**fails if regeneration changes anything**, because non-determinism in
`generate.py` would make the corpus untrustworthy.

---

## Planned directories

Not created yet — they arrive with their milestones. Listed so nobody invents a
different layout.

| Directory    | Contents                                                      | Milestone |
| ------------ | ------------------------------------------------------------- | --------- |
| `jobs/`      | Normalized job records and raw connector responses per source | M2        |
| `ats-pages/` | Saved synthetic application forms for browser tests           | M4        |

`ats-pages/` must eventually cover the fixture list in
`docs/spec/11_TESTING_ACCEPTANCE.md`: text/select/radio/checkbox fields,
repeated labels, a required unknown question, a file attachment, a multi-step
form, a validation error, an iframe needing manual assistance, a changed
fingerprint, a confirmation page and a timeout.

**The final submit action is performed only by the test harness against a
synthetic local server. Never by the production runner, and never against a real
employer.**

---

## Adding a fixture

1. **Generate it, do not capture it.** Add it to `generate.py` so it stays
   reproducible and provably synthetic.
2. **Add a check to `verify.py`** asserting the property your test depends on.
   A fixture whose property is not asserted will eventually stop having it.
3. **Regenerate the manifest** and commit everything together.
4. **Document it** in the table above — what it is _for_, not just what it is.

### Invented data only

- Names: `Alex Rivera`, `Sam Chen` — not a real person you know.
- Companies: `Example Corp`, `Acme Analytics` — `.example` / `.invalid` domains.
- Emails: `alex@example.invalid`. The `.invalid` TLD is reserved by RFC 2606 and
  can never resolve.
- Phone numbers: reserved ranges, e.g. `+1-555-0100`.
- Addresses and dates: plausible, invented, internally consistent.

### For connector fixtures

Captured public job-board responses are acceptable **provided** they contain no
personal data (recruiter names, contact emails) and the source's policy permits
it. Scrub anything identifying. Record the source URL and capture date in a
comment, and see `CONTRIBUTING.md` → "Connector contributions" for the mandatory
policy review.

---

## If you commit personal data by accident

1. **Do not just delete the file in a new commit.** It stays in history.
2. Tell the maintainer immediately — privately, per `SECURITY.md`.
3. Expect a history rewrite (`git filter-repo`) and a force-push. If the
   repository was already public, treat the data as disclosed and tell whoever
   it belongs to.

Which is exactly why the rule at the top of this file is absolute.

---

## Using fixtures in local manual testing

You may of course use your own real CV **locally** to check the product actually
works — `docs/spec/11_TESTING_ACCEPTANCE.md` calls for a manual usability check
with a genuine profile, with consent.

Just keep it out of `git`. Put it outside the repository entirely; `.gitignore`
and `.dockerignore` have patterns for the common mistakes, but neither can
recognise a real CV that has been renamed `test.pdf`.
