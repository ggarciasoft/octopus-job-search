-- 0004_resumes
--
-- Milestone M3 -- CV generation (docs/spec/03_DATA_MODEL.md row `resumes`;
-- docs/spec/06_AI_PROFILE_AND_CV.md "Truthful tailoring" and "Rendering").
--
-- The same invariants as 0001-0003 apply: UUID keys, timestamptz everywhere,
-- workspace_id on every private table, UNIQUE (workspace_id, id) targets and
-- COMPOSITE (workspace_id, id) references between private tables.
--
-- Two rules are enforced here rather than left to the application.
--
-- **A mode means different columns.** `original` carries an uploaded file and
-- no structured document: the user's bytes are served back unchanged, so there
-- is nothing to render and nothing to validate. `tailored` carries a document
-- and its validation and never an input file. A row that mixes the two is a
-- row where nobody can say what the user would actually send, so the CHECK
-- refuses it.
--
-- **Approval belongs to a document, not to a resume id.** `approved_at` may
-- only be set on a `ready` row, and every generation writes a new row rather
-- than mutating one, so an approval can never silently come to refer to
-- content the user did not read. Changing the profile, the job or the template
-- produces a different row, which is what invalidates a downstream packet
-- approval in M4.
--
-- Purely additive. It only CREATEs its own table; 0001-0003 are frozen.

CREATE TABLE resumes (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id      uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    mode              text NOT NULL,
    status            text NOT NULL DEFAULT 'queued',
    -- Tailoring is always against a job; an original file need not be.
    job_id            uuid,
    job_revision      integer,
    profile_revision  integer NOT NULL,
    language          text NOT NULL,
    template_id       text NOT NULL DEFAULT 'simple',
    page_target       integer NOT NULL DEFAULT 2,
    -- The renderer-independent document. NULL in original mode.
    document_json     jsonb,
    -- Findings, cited fact ids and reproducibility metadata. NULL until ready.
    validation        jsonb,
    -- The user's own upload, in original mode. Served back byte-for-byte.
    input_file_id     uuid,
    pdf_file_id       uuid,
    docx_file_id      uuid,
    -- Set only by an explicit user action, never by generation.
    approved_at       timestamptz,
    task_id           uuid,
    error_code        text,
    error_message     text,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT resumes_id_workspace_key UNIQUE (workspace_id, id),
    CONSTRAINT resumes_job_fk
        FOREIGN KEY (workspace_id, job_id) REFERENCES jobs (workspace_id, id) ON DELETE SET NULL (job_id),
    CONSTRAINT resumes_input_file_fk
        FOREIGN KEY (workspace_id, input_file_id) REFERENCES files (workspace_id, id) ON DELETE SET NULL (input_file_id),
    CONSTRAINT resumes_pdf_file_fk
        FOREIGN KEY (workspace_id, pdf_file_id) REFERENCES files (workspace_id, id) ON DELETE SET NULL (pdf_file_id),
    CONSTRAINT resumes_docx_file_fk
        FOREIGN KEY (workspace_id, docx_file_id) REFERENCES files (workspace_id, id) ON DELETE SET NULL (docx_file_id),
    CONSTRAINT resumes_task_fk
        FOREIGN KEY (workspace_id, task_id) REFERENCES tasks (workspace_id, id) ON DELETE SET NULL (task_id),
    -- Compared against ResumeMode.
    CONSTRAINT resumes_mode_check CHECK (mode IN ('original', 'tailored')),
    -- Compared against ResumeStatus.
    CONSTRAINT resumes_status_check CHECK (status IN ('queued', 'ready', 'failed')),
    CONSTRAINT resumes_language_check CHECK (language IN ('en', 'es')),
    CONSTRAINT resumes_page_target_check CHECK (page_target BETWEEN 1 AND 3),
    CONSTRAINT resumes_profile_revision_check CHECK (profile_revision >= 1),
    CONSTRAINT resumes_job_revision_check CHECK (job_revision IS NULL OR job_revision >= 1),
    -- A job revision without a job is a reference to nothing.
    CONSTRAINT resumes_job_revision_needs_job
        CHECK ((job_id IS NULL) = (job_revision IS NULL)),
    -- Original mode: an uploaded file, no generated document.
    CONSTRAINT resumes_original_shape CHECK (
        mode <> 'original'
        OR (input_file_id IS NOT NULL AND document_json IS NULL)
    ),
    -- Tailored mode: a generated document once ready, never an input file.
    CONSTRAINT resumes_tailored_shape CHECK (
        mode <> 'tailored'
        OR (input_file_id IS NULL AND (status <> 'ready' OR document_json IS NOT NULL))
    ),
    -- Only a finished resume can be approved; a queued or failed one cannot.
    CONSTRAINT resumes_approval_needs_ready
        CHECK (approved_at IS NULL OR status = 'ready')
);

-- The CV studio lists a job's resumes newest first, and the tracker will read
-- the most recent approved one.
CREATE INDEX resumes_workspace_created_idx ON resumes (workspace_id, created_at DESC);
CREATE INDEX resumes_job_idx ON resumes (workspace_id, job_id, created_at DESC);
