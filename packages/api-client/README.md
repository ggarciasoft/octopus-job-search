# @job-getter/api-client

Typed `fetch` client for the Job Getter API.

`src/generated/client.ts` is **generated** from the authoritative TypeBox route
table (`packages/contracts/src/routes.ts`) by
`packages/contracts/scripts/generate.ts`. Do not edit it by hand.

```bash
pnpm contracts:generate   # rewrite the generated client
pnpm contracts:check      # CI drift gate; non-zero exit on any difference
```

`src/index.ts` is the only hand-written file and contains nothing but
re-exports.

## Usage

```ts
import { ApiError, JobGetterApiClient } from '@job-getter/api-client';

const api = new JobGetterApiClient({
  baseUrl: 'https://localhost:8080',
  getCsrfToken: () => readCsrfCookie(),
  onUnauthenticated: () => redirectToLogin(),
});

const me = await api.getMe();
const preferences = await api.getPreferences();

// Commands that 04_API_CONTRACTS.md marks idempotent require the key: the
// argument is not optional, so it cannot be forgotten at a call site.
const task = await api.createProfileImport({
  body: { file_id: fileId, format_hint: 'pdf' },
  idempotencyKey: crypto.randomUUID(),
});
```

## Behaviour

- Every request is sent with `credentials: 'include'` — authentication is the
  HttpOnly session cookie, never a token in JavaScript-readable storage.
- JSON routes set `Content-Type: application/json` and serialise the body;
  multipart routes (`uploadFile`) take a `FormData` instead.
- Routes flagged `csrf` send `X-CSRF-Token` from the `getCsrfToken()` callback.
- Routes flagged `requiresIdempotencyKey` take a required `idempotencyKey`
  argument and send it as the `Idempotency-Key` header.
- Non-2xx responses throw `ApiError` with `status`, `code`, `message`, `fields`
  and `requestId` parsed from the error envelope in `04_API_CONTRACTS.md`. A
  failure is never swallowed into a success-shaped result.
- `onUnauthenticated()` fires once on any 401, before the error is thrown.
- `204` routes resolve to `void`; `binaryResponse` routes resolve to a `Blob`.
