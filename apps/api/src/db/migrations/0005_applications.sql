-- 0005_applications
--
-- Milestone M4 -- applications, packets, approval and the tracker
-- (docs/spec/03_DATA_MODEL.md rows `answer_bank`, `applications`,
-- `application_packets`, `application_events`;
-- docs/spec/07_APPLICATION_AUTOMATION.md).
--
-- The same invariants as 0001-0004 apply: UUID keys, timestamptz everywhere,
-- workspace_id on every private table, UNIQUE (workspace_id, id) targets and
-- COMPOSITE (workspace_id, id) references between private tables. Every CHECK
-- listing an enumeration is compared against @job-getter/contracts by
-- tests/db/application-schema.test.ts.
--
-- Four rules are enforced here rather than left to application code, because
-- each of them is a way a user could end up sending an employer something they
-- never agreed to send.
--
-- **An approval names content, not a row.** `approved_hash` may only ever hold
-- this packet's own `content_hash`. A packet is immutable once written, so an
-- approval either refers to exactly the bytes the user read or it does not
-- exist. There is no shape in which "approved" points at content nobody saw.
--
-- **Approval is all-or-nothing and always expires.** `approved_at`,
-- `approved_hash` and `expires_at` are set together or not at all, and the
-- expiry must be after the approval. A half-written approval with no clock on
-- it is the one that quietly stays valid for a month.
--
-- **Submission timestamps only exist for submitted applications.** A row
-- claiming `submitted` with no `submitted_at`, or carrying evidence while
-- still in `preparing`, would make the tracker say something the history does
-- not support.
--
-- **The event log cannot be rewritten.** 03_DATA_MODEL.md calls
-- `application_events` "append-only except privacy deletion", so an UPDATE is
-- refused by a trigger. DELETE is left available: privacy deletion and the
-- workspace cascade both need it, and neither is a quiet edit of history.
--
-- Purely additive. It only CREATEs its own objects; 0001-0004 are frozen.

-- ---------------------------------------------------------------------------
-- answer_bank
-- ---------------------------------------------------------------------------
--
-- `scope_id` is NOT NULL with an empty-string sentinel rather than nullable.
-- The identity of a stored answer is (question_key, scope, scope_id), and a
-- NULL in a UNIQUE constraint compares unequal to every other NULL, so a
-- nullable column would silently allow an unbounded pile of `general`-scope
-- answers to the same question -- and then send whichever one a query happened
-- to return first. The API maps '' back to null at the edge.

CREATE TABLE answer_bank (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    question_key  text NOT NULL,
    label         text,
    answer        jsonb NOT NULL,
    sensitivity   text NOT NULL DEFAULT 'standard',
    scope         text NOT NULL DEFAULT 'general',
    -- Normalised company name for company scope, job id for job scope,
    -- '' for general scope.
    scope_id      text NOT NULL DEFAULT '',
    -- Null until the user says this is their answer. An unconfirmed row may be
    -- kept for their own reference but never reused in a packet.
    confirmed_at  timestamptz,
    expires_at    timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT answer_bank_id_workspace_key UNIQUE (workspace_id, id),
    CONSTRAINT answer_bank_identity_key UNIQUE (workspace_id, question_key, scope, scope_id),
    -- Compared against AnswerSensitivity.
    CONSTRAINT answer_bank_sensitivity_check
        CHECK (sensitivity IN ('standard', 'sensitive', 'never_reuse')),
    -- Compared against AnswerScope.
    CONSTRAINT answer_bank_scope_check CHECK (scope IN ('general', 'company', 'job')),
    -- A scoped answer needs the thing it is scoped to, and an unscoped one
    -- must not carry a scope it does not have.
    CONSTRAINT answer_bank_scope_pairing
        CHECK ((scope = 'general') = (scope_id = '')),
    CONSTRAINT answer_bank_question_key_check
        CHECK (question_key ~ '^[a-z0-9_.:-]{1,120}$')
);

CREATE INDEX answer_bank_workspace_question_idx
    ON answer_bank (workspace_id, question_key);

-- ---------------------------------------------------------------------------
-- applications
-- ---------------------------------------------------------------------------

CREATE TABLE applications (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id        uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    job_id              uuid NOT NULL,
    status              text NOT NULL DEFAULT 'draft',
    -- Optimistic concurrency: every mutation states the revision it read.
    revision            integer NOT NULL DEFAULT 1,
    -- Set once the first packet exists. The composite FK is added after
    -- application_packets exists, below.
    current_packet_id   uuid,
    submission_evidence jsonb,
    submitted_at        timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT applications_id_workspace_key UNIQUE (workspace_id, id),
    -- 03_DATA_MODEL.md: "unique workspace/job_id". This is also what makes two
    -- simultaneous creates resolve to one application rather than two.
    CONSTRAINT applications_job_key UNIQUE (workspace_id, job_id),
    CONSTRAINT applications_job_fk
        FOREIGN KEY (workspace_id, job_id) REFERENCES jobs (workspace_id, id) ON DELETE CASCADE,
    -- Compared against ApplicationStatus.
    CONSTRAINT applications_status_check CHECK (status IN (
        'draft', 'preparing', 'needs_input', 'ready_for_review', 'approved',
        'filling', 'awaiting_user_submit', 'submitted', 'outcome_unknown',
        'failed', 'cancelled', 'interview', 'rejected', 'offer', 'withdrawn'
    )),
    CONSTRAINT applications_revision_check CHECK (revision >= 1),
    -- Claiming submission without recording when it happened would leave the
    -- tracker asserting something the history cannot support.
    CONSTRAINT applications_submitted_needs_time
        CHECK (status <> 'submitted' OR submitted_at IS NOT NULL),
    -- ...and the reverse: a submission time or its evidence may only exist on
    -- an application that actually reached submission.
    CONSTRAINT applications_submitted_time_scope CHECK (
        submitted_at IS NULL
        OR status IN ('submitted', 'outcome_unknown', 'interview', 'rejected', 'offer', 'withdrawn')
    ),
    CONSTRAINT applications_evidence_scope CHECK (
        submission_evidence IS NULL
        OR status IN ('submitted', 'outcome_unknown', 'interview', 'rejected', 'offer', 'withdrawn')
    )
);

-- Required by 03_DATA_MODEL.md: applications(workspace_id, status).
CREATE INDEX applications_workspace_status_idx ON applications (workspace_id, status);
CREATE INDEX applications_workspace_created_idx
    ON applications (workspace_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- application_packets
-- ---------------------------------------------------------------------------
--
-- A packet is written once and never updated except to record the user's
-- approval, so `updated_at` is deliberately absent: there is no edit for it to
-- describe. Changing anything means a new revision.

CREATE TABLE application_packets (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id       uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    application_id     uuid NOT NULL,
    revision           integer NOT NULL,
    -- The immutable snapshot: which profile, which job, which CV.
    profile_revision   integer NOT NULL,
    job_revision       integer NOT NULL,
    resume_id          uuid NOT NULL,
    -- SHA-256 of the bytes that would actually be attached, so replacing the
    -- CV behind a resume row is detectable rather than invisible.
    resume_sha256      text,
    -- The exact destination, resolved from the job's provenance server-side.
    destination_url    text NOT NULL,
    destination_origin text NOT NULL,
    connector          text,
    connector_version  text,
    -- PacketAnswer[]: value, provenance and sensitivity per question.
    answers            jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- The form schema, once a runner has inspected the real page.
    form_fingerprint   text,
    content_hash       text NOT NULL,
    approved_hash      text,
    approved_at        timestamptz,
    expires_at         timestamptz,
    created_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT application_packets_id_workspace_key UNIQUE (workspace_id, id),
    -- 03_DATA_MODEL.md: "unique application/revision".
    CONSTRAINT application_packets_revision_key
        UNIQUE (workspace_id, application_id, revision),
    CONSTRAINT application_packets_application_fk
        FOREIGN KEY (workspace_id, application_id)
        REFERENCES applications (workspace_id, id) ON DELETE CASCADE,
    -- RESTRICT, not CASCADE: a CV referenced by a packet the user approved is
    -- evidence of what was sent and must outlive any tidy-up of resumes.
    CONSTRAINT application_packets_resume_fk
        FOREIGN KEY (workspace_id, resume_id)
        REFERENCES resumes (workspace_id, id) ON DELETE RESTRICT,
    CONSTRAINT application_packets_revision_check CHECK (revision >= 1),
    CONSTRAINT application_packets_profile_revision_check CHECK (profile_revision >= 1),
    CONSTRAINT application_packets_job_revision_check CHECK (job_revision >= 1),
    CONSTRAINT application_packets_content_hash_check
        CHECK (content_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT application_packets_resume_sha_check
        CHECK (resume_sha256 IS NULL OR resume_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT application_packets_destination_check
        CHECK (length(destination_url) > 0 AND length(destination_origin) > 0),
    -- The approval invariant: a packet may only ever record approval of its
    -- own content. There is no way to write "approved" against a hash this row
    -- does not contain.
    CONSTRAINT application_packets_approval_binds_content
        CHECK (approved_hash IS NULL OR approved_hash = content_hash),
    -- Approved means: when, what, and until when. All three or none.
    CONSTRAINT application_packets_approval_complete CHECK (
        (approved_at IS NULL AND approved_hash IS NULL AND expires_at IS NULL)
        OR (approved_at IS NOT NULL AND approved_hash IS NOT NULL AND expires_at IS NOT NULL)
    ),
    CONSTRAINT application_packets_expiry_after_approval
        CHECK (expires_at IS NULL OR expires_at > approved_at)
);

CREATE INDEX application_packets_application_idx
    ON application_packets (workspace_id, application_id, revision DESC);

-- The circular reference, added now that both tables exist. ON DELETE SET NULL
-- so removing a packet cannot take the application with it.
ALTER TABLE applications
    ADD CONSTRAINT applications_current_packet_fk
    FOREIGN KEY (workspace_id, current_packet_id)
    REFERENCES application_packets (workspace_id, id) ON DELETE SET NULL (current_packet_id);

-- ---------------------------------------------------------------------------
-- application_events
-- ---------------------------------------------------------------------------

CREATE TABLE application_events (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id   uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    application_id uuid NOT NULL,
    -- Dense and per application, so a gap means a row was removed.
    sequence       integer NOT NULL,
    type           text NOT NULL,
    actor          text NOT NULL,
    status_before  text,
    status_after   text,
    reason         text,
    -- Redacted detail only: counts, ids and codes. 09_SECURITY_PRIVACY.md,
    -- "Do not log CV text, answers, tokens or raw prompts".
    data           jsonb NOT NULL DEFAULT '{}'::jsonb,
    occurred_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT application_events_id_workspace_key UNIQUE (workspace_id, id),
    -- 03_DATA_MODEL.md: "unique application/sequence".
    CONSTRAINT application_events_sequence_key
        UNIQUE (workspace_id, application_id, sequence),
    CONSTRAINT application_events_application_fk
        FOREIGN KEY (workspace_id, application_id)
        REFERENCES applications (workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT application_events_sequence_check CHECK (sequence >= 1),
    -- Compared against ApplicationEventType.
    CONSTRAINT application_events_type_check CHECK (type IN (
        'created', 'packet_created', 'packet_approved', 'approval_invalidated',
        'approval_expired', 'fill_requested', 'fill_paused', 'fill_failed',
        'submitted', 'outcome_recorded', 'cancelled', 'note'
    )),
    -- Compared against ApplicationActor.
    CONSTRAINT application_events_actor_check CHECK (actor IN ('user', 'system', 'runner')),
    CONSTRAINT application_events_status_before_check CHECK (status_before IS NULL OR status_before IN (
        'draft', 'preparing', 'needs_input', 'ready_for_review', 'approved',
        'filling', 'awaiting_user_submit', 'submitted', 'outcome_unknown',
        'failed', 'cancelled', 'interview', 'rejected', 'offer', 'withdrawn'
    )),
    CONSTRAINT application_events_status_after_check CHECK (status_after IS NULL OR status_after IN (
        'draft', 'preparing', 'needs_input', 'ready_for_review', 'approved',
        'filling', 'awaiting_user_submit', 'submitted', 'outcome_unknown',
        'failed', 'cancelled', 'interview', 'rejected', 'offer', 'withdrawn'
    ))
);

-- Required by 03_DATA_MODEL.md: application_events(application_id, sequence).
CREATE INDEX application_events_application_sequence_idx
    ON application_events (application_id, sequence);

/*
 * Append-only, enforced by the database.
 *
 * The history of an application is the only record of what the user approved
 * and when, so "we never update it" has to be more than a convention followed
 * by whichever handler was written last. DELETE stays permitted: the workspace
 * cascade and privacy deletion both need it, and erasing a workspace is not
 * the same act as quietly editing one event within it.
 */
CREATE FUNCTION application_events_no_update() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'application_events is append-only'
        USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER application_events_append_only
    BEFORE UPDATE ON application_events
    FOR EACH ROW EXECUTE FUNCTION application_events_no_update();
