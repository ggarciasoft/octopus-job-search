# Business, marketing and open source

## Honest assessment

Useful as a personal project and portfolio piece: it demonstrates Node APIs, Python processing, AI integration, browser automation, background jobs, security and deployment. Commercial feasibility is less certain because matching, résumé tailoring and autofill already have established competitors. Broad website automation requires ongoing maintenance, so this is unlikely to become a maintenance-free product.

Differentiate through user control, local processing, truthful tailoring, transparent fit explanations and customizable connectors. Open-source availability alone is not proof of demand. Start with remote tech job seekers and English/Spanish onboarding, then expand based on actual users.

## Competitive reference

Simplify markets job autofill/tracking; Jobright markets matching, tailored résumés and autofill. Their existence validates an active category, not demand for this particular product. Feature and price claims must be checked again before publishing comparison pages. Do not claim uniqueness or superiority without testing.

## Distribution

Publish a short demo showing profile → job match → evidence-backed CV → reviewed autofill. Explain which sites work and which require manual steps. Use a clear GitHub quickstart, Docker demo, synthetic data, connector issue templates and contribution guide. Share useful engineering walkthroughs in relevant developer/job-search communities under their promotion rules. Do not market mass applications, guaranteed jobs or guaranteed ATS bypass.

Measure activation (first confirmed profile and reviewed packet), preparation time saved, supported-form completion accuracy, week-two return use and willingness to pay. Ask users why they stop; successful job seekers naturally churn, making this an episodic subscription product.

## Business model hypothesis

Self-hosted: free software, local inference or user's paid AI/search keys. Managed service: charge for convenience, scheduled discovery, included inference allowance and support. A browser extension remains necessary for hosted filling in v1. No sale of CV data. No requirement to use the hosted service.

Proposed experiment, not market-validated pricing: a USD 15/month limited plan and a USD 29/month higher-usage plan, both with explicit token/task allowances determined by measured costs. Never advertise unlimited browser/AI work. Offer pause/cancel and data export. Start beta with manual access; add billing only after interviews and real cost measurement.

## Illustrative unit economics — assumptions, not provider quotes

For a hypothetical USD 15 user-month: AI/search USD 2, allocated hosting/storage USD 1, support allowance USD 3, assumed payment processing 3% + USD 0.30 = USD 0.75. Contribution = 15 − 2 − 1 − 3 − 0.75 = USD 8.25 (55%). At USD 300 remaining fixed monthly overhead, break-even is ceil(300/8.25) = 37 paying users. This excludes founder development compensation, taxes, refunds, acquisition spend and any additional fixed costs. Do not double-count allocated hosting in fixed costs.

Sensitivity: if AI/search rises to USD 5 and support to USD 6, contribution falls to USD 2.25 (15%); same fixed overhead requires 134 paying users. Measure tasks per user, tokens per task, connector requests, storage and support minutes before setting allowances. No model token-price assumptions are embedded in the code; use configurable rate cards and current provider pricing.

## Open-source policy

Proposed default Apache-2.0 for adoption and permissive reuse; include license text, notices and dependency attribution. Competitors can reuse permissively licensed code, including commercially. AGPL is an alternative if the owner prioritizes reciprocity for modified network services; get appropriate advice before choosing. Do not label a license with noncommercial restrictions as open source. Do not finalize a public license without the owner's decision.

Keep core local functions available without a license server. Hosted operations/billing can be optional modules. Publish adapter capability/version matrix, changelog and security reporting channel. Accept connector contributions with fixtures and policy documentation; do not accept bypass tooling or hidden data collection.
