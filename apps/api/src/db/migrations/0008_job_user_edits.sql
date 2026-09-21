-- 0008_job_user_edits
--
-- A posting whose page carries no structured data is read as visible text,
-- and the importer says so: NO_STRUCTURED_DATA, *"Review the title, company
-- and description before relying on them."* Until now there was no way to act
-- on that advice. `PATCH /jobs/:id` accepted only `saved` and `status`, so a
-- job imported as "Job Application for Software Engineer at Greenhouse" at
-- "(company not stated)" kept those words through every screen, every packet
-- and every application it fed -- a pilot run found exactly that.
--
-- Letting the user correct them needs one thing the schema did not record:
-- *which* words are theirs. Without it the next fetch of the same posting
-- overwrites the correction with the same bad title it produced the first
-- time, and on a board scanned every 24 hours the correction would not last a
-- day. So each correctable field carries the moment it was corrected, and the
-- write path leaves a corrected field alone.
--
-- A timestamp rather than a boolean: it answers "is this the user's wording?"
-- and "since when?" with one column, and the audit trail reads better for it.
-- NULL means the source's own words, which is the default and the common case.
--
-- Purely additive. It only ALTERs `jobs` to add nullable columns; 0001-0007
-- are frozen.

ALTER TABLE jobs
    ADD COLUMN title_edited_at   timestamptz,
    ADD COLUMN company_edited_at timestamptz;

-- The list query never filters on these, so they get no index: they are read
-- with the row they belong to and written by one statement that already has it.
