/**
 * Typed API client for Job Getter.
 *
 * The substance of this package is generated: `src/generated/client.ts` is
 * produced from the route table in `packages/contracts/src/routes.ts` by
 * `packages/contracts/scripts/generate.ts`. Regenerate with
 * `pnpm contracts:generate`; CI fails on drift via `pnpm contracts:check`.
 *
 * Nothing here is hand-maintained beyond these re-exports, so a route cannot
 * exist in the contracts and be missing from the client.
 */
export { ApiError, JobGetterApiClient } from './generated/client.js';
export type * from './generated/client.js';
