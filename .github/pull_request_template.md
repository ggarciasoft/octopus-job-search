# Pull request

## What does this change?

<!-- One or two sentences. What is different after this merges, and why. -->

## How was it tested?

<!--
Paste the ACTUAL output, not a description of it.
docs/spec/00_AI_IMPLEMENTATION_INSTRUCTIONS.md: "Record real test output and
remaining failures." A remaining failure that is written down is fine. A
remaining failure that is not mentioned is not.
-->

```
$ pnpm test
...
```

## Related

<!-- Closes #123, or the milestone / requirement id (PR01-PR14, AT01-AT28, M0-M7). -->

---

## Checklist

**Every box here has bitten this project or its specification at least once.
Please actually check them rather than ticking the block.**

### Secrets and personal data

- [ ] **No secrets or personal CVs in this diff.** No `.env`, no API keys, no
      session cookies, no device tokens, no `SETUP_TOKEN`, no real CV, no real
      name, email, phone number or employment history — mine or anyone else's.
      New test data is synthetic. (`fixtures/README.md`)
- [ ] I did not add telemetry, analytics or any other phone-home, and I did not
      add a hosted dependency that a self-hosted installation now requires.

### Contracts

- [ ] **Contracts regenerated if schemas changed.** I ran
      `pnpm contracts:generate` and committed the result. CI runs
      `pnpm contracts:check` as a drift gate, and I did not hand-edit anything
      under `packages/contracts/generated/`.
- [ ] I did not hand-write a parallel enum, type or schema that duplicates one
      already generated from `packages/contracts`.

### Honesty about what works

- [ ] **Nothing in this PR presents unimplemented behaviour as working.** No
      button that reports success without a backend, no source listed as
      supported that has not been tested against fixtures.
      (invariant 10)
- [ ] `IMPLEMENTATION_STATUS.md` is updated if this changes what is implemented,
      tested, blocked or deferred — and nothing is marked complete on the
      strength of generated code alone.
- [ ] If this adds a user-visible capability, it has an error state and an empty
      state, not just a happy path.

### Truthfulness of output <!-- skip if this PR does not touch profile, CV or matching -->

- [ ] No code path can invent a qualification, employer, date, degree, work
      authorization, salary history, certification or achievement number.
      (invariant 2)
- [ ] Unknown stays unknown. Absent evidence is never rendered as a positive
      answer for eligibility, sponsorship or location.
- [ ] A match score is presented as heuristic fit, never as a probability of
      being hired. (invariant 3)

### Safety <!-- skip if this PR does not touch fetching, automation or the worker -->

- [ ] No automatic submission. The user approves a specific snapshot and
      performs the final submit themselves. (invariant 4)
- [ ] No submission is retried when its outcome is uncertain. (invariant 6)
- [ ] No CAPTCHA solving, proxy rotation, fingerprint spoofing or restriction
      bypass. No job-site credentials leave the user's browser. (invariant 7)
- [ ] Job pages, imported documents and model output are treated as untrusted
      input: validated against a closed schema, never executed. (invariant 9)
- [ ] Outbound fetches still block private, loopback, link-local and
      cloud-metadata destinations, after every redirect, including IPv6.

### Data and persistence <!-- skip if this PR does not touch the database -->

- [ ] Python writes no domain data. Node owns persistence; workers return
      validated results under a lease. (invariant 1)
- [ ] Every query is scoped to the authenticated workspace. The client's
      `workspace_id` is never trusted. (invariant 8)
- [ ] Migrations are additive where possible, repeatable from an empty database,
      and I have said in this PR what a rollback would mean for existing data.

### Connectors <!-- skip if this PR adds no connector or form adapter -->

- [ ] Fixtures included, and tests run against them offline.
- [ ] `policy_review_url` and `policy_review_date` are set, and I read the
      policy on that date.
- [ ] The support matrix in `README.md` reflects what is actually tested — not
      what is intended.

### Housekeeping

- [ ] `pnpm typecheck`, `pnpm lint` and `pnpm format:check` pass locally, or I
      have said below which fail and why.
- [ ] Dependency changes come with a lockfile update in the same commit, and I
      can say why each new dependency is needed.
- [ ] Documentation touched by this change is updated in the same PR.

<!--
Note on the specification: docs/spec/ is the immutable input specification.
If you believe it is wrong, say so in this PR description - do not edit it.
-->
