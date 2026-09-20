# Sources, decisions and unresolved limits

Reviewed 2026-09-20. These are primary documentation/product references, not guarantees that site behavior will remain unchanged. Recheck before connector implementation and public release.

| Source | Design implication |
|---|---|
| [Node.js release policy](https://nodejs.org/en/about/previous-releases) | Use a supported LTS runtime; Node 24 is the chosen baseline. |
| [Greenhouse Job Board API](https://docs.greenhouse.io/job-board.html) | Public job reads are available; submission endpoint requires employer credentials. |
| [Lever postings API](https://github.com/lever/postings-api) | Use documented postings contracts for known employer boards. |
| [Playwright Python installation](https://playwright.dev/python/docs/intro) | Python can own browser execution; package browser dependencies explicitly. |
| [Chrome activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab) | User-triggered temporary tab access informs the extension's least-permission design. |
| [LinkedIn User Agreement](https://www.linkedin.com/legal/user-agreement) | Do not make prohibited scraping/automation a dependency; use user-provided content/manual workflows. |
| [Simplify Copilot](https://simplify.jobs/copilot) | Existing autofill/tracking competition. |
| [Jobright](https://jobright.ai/) | Existing matching, tailored résumé and autofill competition. |

## Architecture decisions

ADR01: Node.js/TypeScript API plus Python worker satisfies the owner's learning goal with distinct responsibilities.
ADR02: One PostgreSQL-backed queue avoids cross-language queue-library coupling and extra infrastructure.
ADR03: Node alone writes domain data; workers return validated results under leases.
ADR04: Browser extension for hosted filling avoids centralizing job-site credentials.
ADR05: Local desktop Python runner enables a substantial Python automation contribution without pretending headless containers are desktop browsers.
ADR06: Approval/manual final submit makes the initial scope testable; unattended submission is separately gated.
ADR07: Local model and configurable cloud model options preserve choice; no silent provider fallback.
ADR08: Configured public boards first; broad internet discovery is a later bounded search integration.
ADR09: Apache-2.0 is a proposal only until owner approves publication license.

## Honest limits

No documentation can remove every implementation decision or ensure arbitrary websites keep working. Form adapters require fixtures and maintenance; permissions and site policies change. Local inference quality/speed depends on hardware/model. CV factual checks reduce risk but cannot replace user review. Hosted release needs real operational/security validation, current payment-provider availability and applicable legal review. This package defines the intended behavior and defaults so an AI can implement in stages without guessing the main architecture.
