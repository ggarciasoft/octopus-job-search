# Product requirements

## Outcome

Reduce repetitive job-search work while preserving truthful applications and user control. Start with one person's workflow; make workspace isolation possible from the first migration. A workspace represents one job seeker in v1, not an agency managing many candidates.

## Functional requirements

| ID | Requirement | First milestone |
|---|---|---|
| PR01 | Create and edit profile manually | M1 |
| PR02 | Import PDF/DOCX or pasted profile text; review extracted fields | M1 |
| PR03 | Record titles, skills, locations, salary, languages, work eligibility | M1 |
| PR04 | Import job URL or description and configure company boards | M2 |
| PR05 | Fetch Greenhouse and Lever public listings, deduplicate and refresh | M2 |
| PR06 | Explain fit, missing requirements and unknown eligibility | M3 |
| PR07 | Generate truthful tailored PDF and DOCX CV, or preserve original file | M3 |
| PR08 | Create reviewable application packet and answer bank | M4 |
| PR09 | Autofill tested forms in a local browser; final submit is manual | M4 |
| PR10 | Track outcome with evidence, history and duplicate prevention | M4 |
| PR11 | Configure providers, prompts, weights, limits and connector settings | M3–M5 |
| PR12 | Hosted app plus extension, accounts, quotas and isolation | M5–M6 |
| PR13 | Discover additional company pages through an optional search API | M6 |
| PR14 | Export/delete user data; backup/restore local installation | M4 |

## Explicit boundaries

The system does not scan the entire internet exhaustively. Pilot discovery scans configured boards and user-provided URLs. M6 adds bounded search queries and optional page adapters. It never promises every job, guaranteed interviews, or guaranteed hiring.

LinkedIn URL-only profile import, LinkedIn scraping, LinkedIn Easy Apply automation, Workday support, mobile browser extensions, recruiter outreach, interview impersonation, and automated assessments are outside v1. LinkedIn text/export provided by the user is supported; do not promise a particular export format remains available.

## Core user flow

Set up provider → import profile → confirm facts → configure search preferences and boards → scan → review ranked jobs → choose original/tailored CV → review CV and answers → approve packet → fill supported page → manually submit → confirm result → track interview/rejection/offer.

## Product rules

- Remote does not imply worldwide. Store location restrictions and work authorization separately.
- Unknown salary, sponsorship, or location eligibility remains unknown, never a positive match.
- Excluded employers and clearly failed hard eligibility filters hide jobs by default; users can inspect exclusions.
- No automatic currency conversion or salary period conversion in the pilot. Compare only matching currency/period values.
- Unsupported questions are surfaced to the user; demographic fields and legal attestations are never inferred.
- Jobs can be saved even when not eligible; application readiness remains blocked until mandatory unknowns are resolved.
- Progress and costs are visible. Canceling pending work stops future processing; running work stops at its next safe checkpoint.

## Success measurements

Measure median time to a reviewed application, correction rate for generated facts, form-field accuracy, duplication incidents, and interview responses as user-reported outcomes. Do not optimize for raw application volume. A pilot target is at least 30% less preparation time across ten applications compared with the same user's manual baseline; this is a validation goal, not a forecast.
