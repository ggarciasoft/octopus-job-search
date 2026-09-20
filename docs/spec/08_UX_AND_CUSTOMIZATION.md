# UX and customization

## Navigation and screens

| Screen | Content and actions |
|---|---|
| Setup | Local/hosted explanation; account; local/cloud provider; test; optional profile import |
| Profile | Contact, employment, projects, education, skills, languages, eligibility; draft vs confirmed |
| Import review | Source preview, field diff, merge/conflict controls, confirm selection |
| Discover | Search preferences, boards, manual URL/text, scan status and coverage |
| Jobs | Filters, score/coverage, eligibility, salary unknown badge, freshness, saved/excluded views |
| Job detail | Requirements with evidence, matched profile facts, gaps, provenance, prepare action |
| CV studio | Original/tailored toggle, template/language, preview, fact/change review, downloads |
| Application review | Destination, CV, answers, unresolved required questions, approval action |
| Fill assistant | Connected device, filled/missing fields, pause/manual steps, final-submit reminder |
| Tracker | Status list/board, outcome evidence, notes and event timeline |
| Settings | Providers, budgets, prompt/template choices, search schedules, devices, privacy/export |

Use accessible labels, keyboard navigation, visible focus, mobile-friendly review screens and clear contrast. Desktop Chrome is required for initial browser filling. English/Spanish locale switching affects UI and new documents; do not silently translate stored facts.

## Status communication

Explain "Not checked", "Unknown", "Needs your answer", "Ready for review", "Waiting for submission", "Submitted—verified", and "Submitted—reported by you" distinctly. Provider/network errors preserve work. Every background action has progress/cancel behavior. Empty job lists suggest adding boards or relaxing filters, never fabricate examples as live results.

## Versioned settings schema

settings_version: 1. Preferences include target_titles [], excluded_titles [], required_skills [], preferred_skills [], excluded_companies [], countries [], remote_modes [], employment_types [], languages [], salary {minimum,currency,period}, sponsorship_policy allow/avoid/unknown, unknown_eligibility_policy review/hide, scan_interval_hours default 24, match_weights, cv_language en/es, cv_template simple, resume_mode original/tailored.

Operational limits: scan_max_jobs 1000; request_concurrency 1 per host; AI requests/day 50 pilot default; fill attempts/day 10 pilot default; approval_ttl_hours 24; consented evidence capture false; raw logs false. Hosted operator maxima override user increases; users can choose stricter limits.

Settings resolution: safe code defaults → operator configuration → workspace settings → one-time task overrides. Non-negotiable invariants cannot be overridden by prompts/settings. Validate schema on import; reject unknown keys rather than silently ignoring errors. Export preferences without tokens, provider keys or browser sessions.

## Customization levels

Level 1: UI controls for preferences, weights, languages, CV templates, schedules, provider/model and budgets.
Level 2: local YAML/JSON import/export for reproducible settings; a validated prompt suffix may change style but cannot override factual constraints.
Level 3: developer-installed adapters/providers/templates through versioned code interfaces. Hosted users cannot execute uploaded Python/JavaScript or raw template code.

Settings changes show impacted outputs. Editing weights makes matches stale. Editing profile makes CVs/packets stale. Switching language does not modify already submitted materials. Preserve exactly what the user used for each application.
