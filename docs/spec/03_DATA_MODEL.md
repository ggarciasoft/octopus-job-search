# Data model and invariants

Use UUID primary keys, UTC timestamptz timestamps, explicit foreign keys, and SQL migrations. Every private table includes workspace_id. Use composite (workspace_id,id) foreign keys between private tables to prevent cross-workspace references. Except where stated, add created_at and updated_at. JSONB payloads require application schema validation.

| Table | Essential fields and constraints |
|---|---|
| users | id, normalized_email unique, password_hash, verified_at, disabled_at |
| workspaces | id, owner_user_id, mode local/hosted, locale en/es, deletion_state |
| memberships | workspace_id, user_id, role owner; unique pair; one owner in v1 |
| sessions | token_hash unique, user_id, expires_at, revoked_at |
| profiles | workspace_id unique, revision integer, confirmed_revision nullable, contact JSONB |
| profile_facts | profile_id, kind, value JSONB, source_file_id nullable, source_excerpt, confirmed boolean, revision, supersedes_id nullable |
| preferences | workspace_id unique, revision, validated config JSONB |
| files | id, workspace_id, storage_key unique, original_name, mime, bytes, sha256, state staging/ready/deleting, purpose |
| profile_imports | file_id nullable, text_file_id nullable, task_id, status, extracted_draft JSONB, warnings JSONB |
| sources | workspace_id, connector, connector_version, board_key, base_url, enabled, last_success_at; unique workspace/connector/board_key |
| scans | source_id, status, started_at, completed_at, counts JSONB, error_code |
| jobs | workspace_id, canonical_key, company, title, description_text, location JSONB, salary JSONB, status active/closed/unknown, content_hash, revision, first_seen_at, last_seen_at; unique workspace/canonical_key |
| job_sources | job_id, source_id nullable, external_id, canonical_url, apply_url, retrieved_at; unique workspace/connector identity encoded as source_key |
| matches | job_id, job_revision, profile_revision, preferences_revision, algorithm_version, eligible yes/no/unknown, score nullable, explanation JSONB; unique full revision tuple |
| resumes | profile_revision, job_id nullable, job_revision nullable, mode original/tailored, input_file_id nullable, pdf_file_id nullable, docx_file_id nullable, document_json JSONB, validation JSONB, approved_at nullable |
| answer_bank | question_key, answer JSONB, sensitivity, scope general/company/job, scope_id nullable, confirmed_at, expires_at nullable |
| applications | job_id, status, current_packet_id nullable, submission_evidence JSONB nullable, submitted_at nullable; unique workspace/job_id |
| application_packets | application_id, revision, profile_revision, job_revision, resume_id, answers JSONB, form_fingerprint nullable, content_hash, approved_hash nullable, approved_at nullable, expires_at nullable; unique application/revision |
| application_events | application_id, sequence, type, actor, data JSONB; unique application/sequence; append-only except privacy deletion |
| tasks | type, state, workspace_id, payload JSONB, result JSONB nullable, idempotency_key, attempt, max_attempts, run_after, lease fields; unique workspace/type/idempotency_key |
| task_artifacts | task_id, file_id, lease_token_hash, committed boolean |
| paired_devices | workspace_id, kind extension/local_runner, label, token_hash, expires_at, revoked_at, allowed_origins JSONB |
| provider_settings | workspace_id, provider, base_url, model, secret_ciphertext nullable, daily_budget nullable, validated_config JSONB |
| usage_ledger | task_id, provider, input_tokens, output_tokens, measured_cost nullable, reserved_cost nullable, currency, status reserved/settled/released |
| audit_events | actor_id nullable, workspace_id, action, object_id, redacted metadata, occurred_at |

## Profile fact value schemas

Contact: full_name, email, phone optional, city/country, links. Store contact in profiles and reference its revision in packet snapshots.

Experience: employer, title, start_month YYYY-MM, end_month nullable, current boolean, employment_type, bullets [{text,evidence_reference}], skills []. Education: institution, degree, subject, dates. Skill: canonical_name, aliases, user_declared_proficiency nullable. Language: code, declared_level. Authorization: country, authorized boolean/unknown, sponsorship_required boolean/unknown. All require user confirmation before application use. Current/end dates must be internally consistent.

## Indexes and concurrency

Index tasks(state,run_after), tasks(lease_expires_at) for leased rows, jobs(workspace_id,status,last_seen_at), matches(workspace_id,score), applications(workspace_id,status), and application_events(application_id,sequence). Add full-text index on jobs title/description when search is introduced.

Use optimistic revisions for profile, preferences, packet and application mutations. Two simultaneous application creates return the existing application using the unique job constraint. Only explicit revision creation alters a packet; approval references immutable content_hash. Replacing CV, changing answers, source profile or job invalidates approval.

## Deduplication

Canonical key is connector + board + external job ID when available; otherwise normalized employer job URL. Across different sources, link only when the final application URL or verified requisition identity matches. Similar title/location alone creates a possible-duplicate warning, not an automatic merge. Preserve provenance. Check all linked identities before filling.

## Privacy lifecycle

Delete cascades private domain rows, revokes devices/sessions and removes files. Audit deletion keeps only non-identifying operational counts. Backup expiry is separately documented; deleting live data cannot retroactively edit immutable backups. Restore must reapply a deletion ledger before exposing data.
