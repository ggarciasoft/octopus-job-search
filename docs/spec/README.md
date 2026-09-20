# Job Getter — AI implementation specification

Version 1.0 · 2026-09-20 · Working name, not a cleared product brand.

Build an open-source job-search and application assistant using **Node.js, TypeScript, and Python**, with React UI. The owner explicitly wants substantial practical experience with both Node.js and Python. No .NET. This package is a specification, not working application code or a promise of universal website support.

## Accepted direction

- First audience: tech professionals seeking remote work; English and Spanish.
- First milestone: a personal pilot, then open-source release, then hosted beta.
- Manual profile entry, PDF/DOCX CV import, and user-provided LinkedIn export/text.
- Job discovery, matching, original or tailored CV, assisted applications, tracking.
- Approval before submission; optional constrained unattended submission is a later phase.
- Local models or user-supplied AI keys. All application services can run locally; internet access is still needed to find jobs and apply.
- Hosted users use a browser extension for application filling; they do not host a server.
- Free self-hosting and optional paid managed hosting. Pricing is an experiment.

These are implementation defaults derived from the accepted recommendations. License, budget, product name, and commercial prices are proposed defaults rather than decisions explicitly selected by the owner.

## Read order

1. [AI instructions](00_AI_IMPLEMENTATION_INSTRUCTIONS.md)
2. [Product and scope](01_PRODUCT_REQUIREMENTS.md)
3. [Architecture](02_ARCHITECTURE.md)
4. [Data model](03_DATA_MODEL.md)
5. [API and worker contracts](04_API_CONTRACTS.md)
6. [Discovery and connectors](05_DISCOVERY_CONNECTORS.md)
7. [Profiles, matching and CVs](06_AI_PROFILE_AND_CV.md)
8. [Application automation](07_APPLICATION_AUTOMATION.md)
9. [User experience](08_UX_AND_CUSTOMIZATION.md)
10. [Security and privacy](09_SECURITY_PRIVACY.md)
11. [Local and hosted deployment](10_DEPLOYMENT.md)
12. [Quality and acceptance](11_TESTING_ACCEPTANCE.md)
13. [Implementation milestones](12_IMPLEMENTATION_PLAN.md)
14. [Business and open source](13_BUSINESS_AND_OPEN_SOURCE.md)
15. [Research and decisions](14_SOURCES_AND_DECISIONS.md)

## Starting an AI coding session

Give the coding agent the whole folder, ask it to read README and file 00, and implement milestone M0 followed by M1. It must maintain IMPLEMENTATION_STATUS.md in the code repository, distinguishing implemented, tested, blocked, and deferred work. Each milestone should produce runnable software before proceeding.

There is no existing code assumed. Do not implement every phase at once. The complete intended product includes all milestones; the pilot release is M0–M4. M5 adds the extension and M6 delivers the hosted beta. M7 remains optional research.
