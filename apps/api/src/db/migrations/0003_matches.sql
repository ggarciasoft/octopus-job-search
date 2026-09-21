-- 0003_matches
--
-- Milestone M3 — fit (docs/spec/03_DATA_MODEL.md row `matches`;
-- docs/spec/06_AI_PROFILE_AND_CV.md "Fit algorithm v1").
--
-- The same invariants as 0001 and 0002 apply: UUID keys, timestamptz
-- everywhere, workspace_id on every private table, UNIQUE (workspace_id, id)
-- targets and COMPOSITE (workspace_id, id) references between private tables.
-- Every CHECK below is compared against the enumeration in
-- @job-getter/contracts by tests/db/match-schema.test.ts.
--
-- The row is a cache with a meaning. Its uniqueness key is the full revision
-- tuple (job, profile, preferences, algorithm), which is what makes a score
-- reproducible: the same four inputs always identify the same row, and any
-- input moving on produces a new row rather than overwriting the old one.
-- Nothing recomputes silently in the background; a stale score is shown as
-- stale, because a number that quietly changed under review is worse than one
-- that admits it is out of date.
--
-- Purely additive. It only CREATEs its own table; 0001 and 0002 are frozen.

CREATE TABLE matches (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id         uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    job_id               uuid NOT NULL,
    -- The four inputs the score was computed from. Together with the job's own
    -- revision these make the result reproducible and auditable.
    job_revision         integer NOT NULL,
    profile_revision     integer NOT NULL,
    preferences_revision integer NOT NULL,
    algorithm_version    text NOT NULL,
    -- Hard-filter verdict. 'unknown' blocks application readiness but never
    -- hides the job (06_AI_PROFILE_AND_CV.md).
    eligible             text NOT NULL,
    -- NULL when zero components were evaluable. A score is never stored as 0
    -- to mean "we could not tell": 0 reads as a bad match, which is a claim.
    score                integer,
    -- Share of configured weight that was actually evaluable. A score without
    -- its coverage overstates what was known.
    coverage_percent     integer NOT NULL,
    -- The full MatchExplanation: components with their evidence, the hard
    -- filters with their reason codes, and every requirement with its outcome.
    explanation          jsonb NOT NULL,
    computed_at          timestamptz NOT NULL,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT matches_id_workspace_key UNIQUE (workspace_id, id),
    CONSTRAINT matches_job_fk
        FOREIGN KEY (workspace_id, job_id) REFERENCES jobs (workspace_id, id) ON DELETE CASCADE,
    -- 03_DATA_MODEL.md: "unique full revision tuple".
    CONSTRAINT matches_revision_tuple_key
        UNIQUE (workspace_id, job_id, job_revision, profile_revision, preferences_revision, algorithm_version),
    -- Compared against TriState.
    CONSTRAINT matches_eligible_check CHECK (eligible IN ('yes', 'no', 'unknown')),
    CONSTRAINT matches_score_check CHECK (score IS NULL OR (score >= 0 AND score <= 100)),
    CONSTRAINT matches_coverage_check CHECK (coverage_percent >= 0 AND coverage_percent <= 100),
    CONSTRAINT matches_job_revision_check CHECK (job_revision >= 1),
    CONSTRAINT matches_profile_revision_check CHECK (profile_revision >= 1),
    CONSTRAINT matches_preferences_revision_check CHECK (preferences_revision >= 1),
    -- A null score must carry null coverage of evaluable weight: the two are
    -- one statement ("nothing was evaluable"), and they may not disagree.
    CONSTRAINT matches_score_coverage_agree
        CHECK ((score IS NULL) = (coverage_percent = 0))
);

-- Required by 03_DATA_MODEL.md: matches(workspace_id, score) for the ranked
-- list. NULLS LAST so unscored jobs sort after scored ones rather than ahead
-- of them.
CREATE INDEX matches_workspace_score_idx ON matches (workspace_id, score DESC NULLS LAST);

-- The jobs list joins the newest match per job; the detail screen reads one.
CREATE INDEX matches_job_computed_idx ON matches (workspace_id, job_id, computed_at DESC);
