# API and worker contracts

## Common rules

Base /api/v1, JSON snake_case, ISO-8601 UTC, UUID strings. Authoritative schemas live in packages/contracts and generate OpenAPI. Session authentication for web, scoped device tokens for extension/runner, separate operator worker credential for internal polling. The API derives workspace from the authenticated principal; it never trusts a client workspace_id.

Errors: {"error":{"code":"VALIDATION_ERROR","message":"Review highlighted fields","fields":{},"request_id":"uuid"}}. Use 400 malformed, 401 unauthenticated, 403 forbidden, 404 absent/inaccessible, 409 conflict/stale revision, 413 oversized, 422 invalid domain input, 429 quota. Cursor pagination: {items:[],next_cursor:null}, limit default 25/max 100. Async requests return 202 {task_id,status:"queued"}. Mutation Idempotency-Key is required for scan, generate, packet, fill and export commands; same key with different body returns 409. Store response for 24 hours; domain uniqueness remains after expiration.

## Public routes

| Method/path | Request → response |
|---|---|
| POST /setup | local one-time setup token, email, password → owner session; permanently closes after bootstrap |
| POST /auth/register | hosted beta only; email,password,invite_code → verification pending |
| POST /auth/verify | single-use email token → verified account |
| POST /auth/login | email,password → HttpOnly session cookie |
| POST /auth/logout | revoke current session → 204 |
| POST /auth/password-reset/request | email → uniform 202 |
| POST /auth/password-reset/confirm | single-use token,new_password → revoke sessions, 204 |
| GET /me | user,workspace,mode,capabilities,usage |
| GET/PATCH /profile | GET profile/facts/revision; PATCH expected_revision,changes → new revision |
| POST /files | multipart file,purpose → file_id,validation; max 10 MiB for CV |
| GET /files/:id/download | authorized attachment stream; no public permanent URL |
| POST /profile/imports | file_id OR pasted_text, format_hint → task_id |
| GET /profile/imports/:id | extraction draft, warnings, evidence |
| POST /profile/imports/:id/confirm | expected_profile_revision, accepted_fields with edits → confirmed facts/revision |
| GET/PUT /preferences | validated config, expected_revision on PUT |
| GET/POST /sources | list or connector,board_key,base_url → source |
| PATCH/DELETE /sources/:id | allowed config/disable or remove source; keep historical jobs |
| POST /sources/:id/scan | {} → task_id |
| POST /jobs/import | url OR description_text, optional company,title → task_id |
| GET /jobs | query,status,min_score,eligible,cursor → jobs with current/stale match marker |
| GET /jobs/:id | normalized job, provenance, match, duplicates |
| POST /jobs/:id/match | {} → task_id |
| POST /resumes | job_id,mode,input_file_id if original,template_id,language → task_id |
| GET /resumes/:id | validation, preview file references, fact references |
| POST /applications | job_id → existing/new application |
| POST /applications/:id/packets | resume_id,answers,expected_revision → task_id |
| POST /applications/:id/approve | packet_id,content_hash → approval snapshot |
| POST /applications/:id/fill | packet_id,device_id,expected_revision → fill task/session |
| POST /applications/:id/outcome | outcome, evidence_type, evidence payload,expected_revision → new state/event |
| GET /applications | status,cursor → tracked applications |
| GET /applications/:id/events | cursor → ordered history |
| GET /tasks/:id | type,state,progress,result references,error |
| POST /tasks/:id/cancel | {} → state/cancel_requested |
| GET/PUT /answer-bank | list or question_key,answer,scope,confirmed → record |
| DELETE /answer-bank/:id | → 204 |
| GET/PUT /settings/providers | secret values accepted on PUT, never returned; masked readiness on GET |
| POST /settings/providers/test | provider_id → connectivity/schema capability, never arbitrary URL fetch |
| POST /devices/pairing | device_kind → single-use code, expires_in:300 |
| POST /devices/exchange | pairing code + device public identifier → scoped token; one-time use |
| GET/DELETE /devices/:id | status or revoke |
| POST /workspace/export | {} → task_id with ZIP file reference |
| DELETE /workspace | explicit confirmation + recent authentication → deletion task; session invalidated |

Device pairing requires approval in an authenticated web session, including device label and origin. Tokens expire after 30 days and can be revoked. Rate-limit pairing exchange and do not expose a cross-origin unauthenticated local control endpoint.

## Internal task protocol

POST /internal/v1/tasks/claim accepts {worker_id,capabilities:["parse_profile"],protocol_version:1}. Returns 204 if none or {task_id,type,lease_token,lease_expires_at,input,input_schema_version:1}. Input is a task snapshot with revision IDs, never the entire user's history.

POST /internal/v1/tasks/:id/heartbeat accepts {lease_token,progress:{stage,percent}}. Returns {cancel_requested,lease_expires_at}.

GET /internal/v1/tasks/:id/files/:file_id requires the active lease token and only serves declared inputs. POST /internal/v1/tasks/:id/artifacts accepts scoped multipart output and returns file_id. POST /internal/v1/tasks/:id/complete accepts {lease_token,result_schema_version:1,result}. POST .../fail accepts {lease_token,code,retryable,redacted_message}. Server, not worker, decides whether retry is allowed.

All endpoints validate active capability and task scope. Internal host worker may process many workspaces; a paired local runner may only claim its owner's fill_local tasks. Never issue global worker credentials to a user device.

## Task result examples

parse_profile: {draft_facts:[{kind,value,source_excerpt,confidence}],warnings:[]}; confidence is a parsing aid, never fact confirmation.
match_job: {eligible:"unknown",score:72,components:[],missing:[],unknowns:["country eligibility"],fact_ids:[],algorithm_version:"v1"}.
render_cv: {document_json:{schema_version:1,sections:[]},pdf_file_id,docx_file_id,fact_ids:[],warnings:[]}.
fill_local: {packet_id,filled_fields:[],unresolved_fields:[],page_url,form_fingerprint,outcome:"awaiting_user_submit"}.
fetch_board: {jobs:[normalized_job],complete_snapshot:true,next_cursor:null}. Partial fetches must set complete_snapshot:false and may not close missing jobs.

Before implementing each task, expand its input/output into a closed JSON Schema, supply valid/invalid fixtures and generated Pydantic models. Domain transitions occur only after API validation, ownership checks, revision checks and task lease checks in one transaction.
