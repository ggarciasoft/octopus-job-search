# Discovery and connector design

## Support matrix

| Source | Discovery | Application handling in v1 |
|---|---|---|
| Greenhouse public job boards | Known board token, public GET listings/details | Tested browser form adapter; no employer API key assumed |
| Lever public postings | Known site slug, public postings feed | Tested browser form adapter |
| User-pasted description | Supported with user-supplied provenance | Open provided application URL; manual fallback |
| Company job URL | Fetch allowed public page; JSON-LD JobPosting first | Generic assistance only unless adapter tested |
| Additional company discovery | M6 optional search API adapter | Depends on resolved ATS adapter |
| LinkedIn | User-provided job text/link reference only | Manual website use |
| Workday/other ATS | Save URL/text | Manual until separately implemented/tested |

Public listings APIs are not a universal directory of employers. Seed boards manually. Do not claim search-engine results provide complete coverage. Read access does not imply permission to submit through an API.

## Connector contract

Each connector declares id, version, allowed_hosts, capabilities, config_schema, rate_policy, and policy_review_url/date. Python methods: discover(config,cursor) → normalized jobs/page metadata; get_job(external_id) → normalized job; healthcheck() → capabilities. HTML form adapters are separate from discovery connectors.

Normalized job schema: external_id, source_key, canonical_url, apply_url, company, title, description_text, published_at nullable, updated_at nullable, locations [{country,region,city}], remote_type remote/hybrid/onsite/unknown, eligible_countries nullable, employment_type nullable, salary {min,max,currency,period,source_excerpt} nullable, language nullable, requirements [{text,kind,evidence_excerpt}], content_hash, retrieved_at. Inferred fields must carry inferred:true and source excerpt. Never invent published dates.

## Fetch rules

Greenhouse: GET https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs?content=true and per-job GET where needed. Lever: use documented public postings API, including configured regional endpoint where relevant; pin supported schema with fixtures. Respect documented limits and source policies.

Default per-host concurrency 1, minimum one second between requests, scan interval 24 hours with jitter, timeout 20 seconds, maximum 1000 jobs/scan and 100 pages. Honor Retry-After; stop on repeated 403/429 and show source health. Use ETag/Last-Modified if available. These conservative defaults do not establish permission to crawl.

For arbitrary URLs: HTTPS only, public IP validation before connect and after each redirect, max 3 redirects, 2 MiB HTML limit, 20-second timeout, allowed content types, no credentials/cookies. Block private, loopback, link-local and cloud metadata destinations including IPv6 and DNS rebinding. Local model URLs have a separate operator-controlled policy and must not weaken the job fetcher.

Sanitize HTML to text; no scripts, active markup, embedded instructions, or execution. Prefer structured JobPosting data but validate fields. Require user review if there are several postings on a page. Obey applicable source restrictions and robots directives; if prohibited or blocked, offer paste/manual mode instead of bypass.

## Freshness and closure

A job disappearing from two successful complete board snapshots at least 24 hours apart becomes closed. A failed/partial scan cannot close jobs. Explicit source closure can close immediately. Preserve history and last_seen_at. Recheck availability before packet preparation when last successful fetch is more than 24 hours old; if unable, flag unknown and require user review.

## M6 bounded discovery

Provider interface SearchProvider.search(query,country,language,cursor). First implementation uses a configurable documented search API after access/cost verification; fixture provider always available. Queries combine titles, skills and ATS domains. Cap at 5 queries/day and 20 results/query by default. Deduplicate candidates, resolve public career pages, display source coverage and allow approval before adding boards. If no search key is configured, board/manual discovery continues to work. Never scrape search-engine result HTML as an implicit fallback.
