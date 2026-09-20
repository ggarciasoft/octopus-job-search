# Implementation sequence

Complete one working vertical slice at a time. Estimates below are rough planning ranges for an experienced solo developer with AI assistance, not promises; external integration changes may dominate effort.

## M0 — Foundation (3–5 working days)

Create monorepo, lockfiles, containers, migration runner, contracts, logging, local authentication/bootstrap, task lease protocol and fake worker. Deliver web → API → queued task → Python → stored result → UI. Test stale leases, migrations and local startup. Exit: runnable empty installation with an end-to-end fake task.

## M1 — Profile (4–7 days)

Manual profile, CV upload, PDF/DOCX parsing, import review, confirmation, revisions, provider adapter/fake provider and settings. Implement offline local inference path with an explicitly configured model. Exit: confirmed profile from fixtures, unknown/conflicting data handled visibly.

## M2 — Job discovery (4–7 days)

Manual jobs/URLs, source registry, Greenhouse and Lever connectors, normalization, freshness, dedupe, bounded scheduler and source health. Implement URL network protections before generic fetch. Exit: discover fixture/live-read jobs and preserve duplicates/provenance correctly.

## M3 — Fit and CV (5–8 days)

Scoring, eligibility, evidence explanations, provider budgets, structured tailoring, deterministic validation, CV templates, PDF/DOCX generation and original-file mode. Exit: reviewed CV in both formats; no unsupported facts; score is reproducible and qualified by coverage.

## M4 — Personal pilot (5–10 days)

Application packets, answer bank, approval hashes, tracker/events, local desktop runner, at least one tested ATS adapter, manual submission and evidence capture. Add export, backup/restore, cancellation and duplicate handling. Target Greenhouse first, Lever second; support badges must reflect actual tested adapters. Exit: ten user-reviewed real application workflows or documented sandbox equivalents, with measured time saved and failures. Real submissions are performed by the owner.

## M5 — Open-source distribution and extension (5–10 days)

Create extension, device pairing/revocation, scoped fill sessions, packaged adapter logic, template/settings export, install documentation, contributor guide, license and issue templates. Add second ATS adapter only when fixture/live read testing passes. Exit: a fresh user can install without developer intervention and fill supported pages through the extension.

## M6 — Hosted beta (7–15 days)

Hosted authentication/email, isolation hardening, private storage, malware scanning, quotas, cost dashboard, bounded optional search-provider discovery, operations/retention/privacy pages and invited beta. Add subscription integration only after pricing validation, using a provider selected by the owner and verified to support the owner's business. Exit: hosted user needs no server and cannot access another user's data; all release gates pass.

## M7 — Optional unattended automation (not estimated)

Separate design/reliability and source-permission review. Do not treat M7 as needed for the personal project or beta. Prioritize connector reliability and outcomes over application volume.

## Progress record template

For each milestone record: scope, implemented paths, commands run, test results, screenshots if useful, migration notes, supported connector versions, known limitations and next task. Never mark complete based only on generated code.

## Owner decision defaults

Use Job Getter as internal name; no paid services required for pilot. License proposal Apache-2.0 (confirm before public release). Start with local deployment and one user's profile. Do not seed the owner's real work history from chat memory; the owner provides/confirms it through product onboarding. Defer commercial price, payment provider, final branding and unattended submission until their milestones.
