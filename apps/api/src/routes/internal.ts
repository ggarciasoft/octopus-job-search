/**
 * `/internal/v1/*` — the worker task protocol (04_API_CONTRACTS.md).
 *
 * These routes are a separate principal from user sessions:
 *
 *  * they authenticate with the operator `WORKER_AUTH_TOKEN` bearer, compared
 *    in constant time, or with a paired device token that may claim only
 *    runner-only work inside its own workspace;
 *  * a session cookie has no effect here, and the worker credential cannot
 *    reach `/api/v1`;
 *  * they are absent from the `ROUTES` manifest, so they never appear in the
 *    generated public client or OpenAPI document ("Internal worker routes must
 *    not be generally accessible from the public internet").
 *
 * Origin/CSRF checks do not apply: the worker is not a browser and is not
 * cookie-authenticated, so there is no ambient authority to forge.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  ARTIFACT_STAGING_TTL_HOURS,
  ClaimRequest,
  CompleteRequest,
  FailRequest,
  HeartbeatRequest,
  INTERNAL_PREFIX,
  UsageReleaseRequest,
  UsageReserveRequest,
  UsageSettleRequest,
  PROTOCOL_VERSION,
  RESULT_SCHEMA_VERSION,
  type ArtifactUploadResponse,
  type TaskAck,
} from '@job-getter/contracts';
import { Type } from '@sinclair/typebox';
import { conflict, malformed, unprocessable } from '../errors.js';
import { authenticateDevice, authenticateWorker } from '../auth/worker.js';
import { WorkspaceScope } from '../auth/scope.js';
import { sha256Hex } from '../util/crypto.js';
import {
  ProtocolVersionError,
  authorizeArtifactUpload,
  authorizeTaskFile,
  claimTask,
  completeTask,
  failTask,
  heartbeatTask,
  recordWorkerSeen,
} from '../tasks/queue.js';
import {
  ARTIFACT_PURPOSES,
  contentDispositionFor,
  downloadContentType,
  storeFile,
  validateUpload,
} from '../files/service.js';
import { releaseUsage, reserveUsage, settleUsage } from '../usage/service.js';
import type { RouteContext } from './context.js';

const IdParams = Type.Object(
  { id: Type.String({ format: 'uuid' }) },
  { additionalProperties: false },
);
const FileParams = Type.Object(
  { id: Type.String({ format: 'uuid' }), file_id: Type.String({ format: 'uuid' }) },
  { additionalProperties: false },
);
const ReservationParams = Type.Object(
  { id: Type.String({ format: 'uuid' }), reservation_id: Type.String({ format: 'uuid' }) },
  { additionalProperties: false },
);

export const LEASE_TOKEN_HEADER = 'x-lease-token';

/**
 * The contract passes `lease_token` in the request body, which a GET cannot
 * carry. The file download therefore takes it in a header; the value and its
 * verification are identical.
 */
function leaseTokenFromHeader(request: FastifyRequest): string {
  const raw = request.headers[LEASE_TOKEN_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || value.length < 32) {
    throw malformed(`An ${LEASE_TOKEN_HEADER} header holding the active lease token is required.`);
  }
  return value;
}

/** `Retry-After` may be seconds or an HTTP date (RFC 9110). */
export function parseRetryAfter(value: string | string[] | undefined): number | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string' || raw.trim() === '') return undefined;
  if (/^\d+$/.test(raw.trim())) return Number.parseInt(raw.trim(), 10) * 1000;
  const date = Date.parse(raw);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - Date.now());
}

export function registerInternalRoutes(app: FastifyInstance, context: RouteContext): void {
  app.register(
    async (internal) => {
      // One gate for the whole prefix. Two credentials are accepted and they
      // are not interchangeable: the operator worker bearer, which serves every
      // workspace but may not claim `fill_local`, and a paired device token,
      // which may claim *only* `fill_local` and only inside its own workspace
      // (`assertCapabilitiesAllowed`). A device token is checked first so that
      // presenting one never silently falls back to the operator credential.
      internal.addHook('onRequest', async (request) => {
        const device = await authenticateDevice(context.db, request);
        request.principal = device ?? authenticateWorker(context.config, request);
      });

      internal.post('/tasks/claim', { schema: { body: ClaimRequest } }, async (request, reply) => {
        const body = request.body as typeof ClaimRequest.static;
        const principal = request.principal;
        if (principal === null || principal.kind === 'session') {
          throw conflict('A worker credential is required.');
        }

        // Recorded before the claim so `worker_online` is true even when the
        // queue is empty and this poll returns 204.
        await recordWorkerSeen(context.db, {
          workerId: body.worker_id,
          kind: principal.kind === 'device' ? 'device' : 'worker',
          capabilities: body.capabilities,
          protocolVersion: body.protocol_version,
          workspaceId: principal.kind === 'device' ? principal.workspaceId : null,
        });

        let claimed;
        try {
          claimed = await claimTask(context.db, {
            principal,
            workerId: body.worker_id,
            capabilities: body.capabilities,
            protocolVersion: body.protocol_version,
          });
        } catch (error) {
          if (error instanceof ProtocolVersionError) {
            throw unprocessable(error.message, {
              protocol_version: `This API speaks protocol version ${PROTOCOL_VERSION}.`,
            });
          }
          throw error;
        }

        if (claimed === null) return reply.status(204).send();

        context.logger.info(
          {
            request_id: request.id,
            task_id: claimed.task_id,
            task_type: claimed.type,
            attempt: claimed.attempt,
          },
          'task leased',
        );
        return reply.status(200).send(claimed);
      });

      internal.post(
        '/tasks/:id/heartbeat',
        { schema: { params: IdParams, body: HeartbeatRequest } },
        async (request, reply) => {
          const { id } = request.params as { id: string };
          const body = request.body as typeof HeartbeatRequest.static;
          const result = await heartbeatTask(context.db, id, body.lease_token, body.progress);
          return reply.status(200).send(result);
        },
      );

      internal.post(
        '/tasks/:id/complete',
        { schema: { params: IdParams, body: CompleteRequest } },
        async (request, reply) => {
          const { id } = request.params as { id: string };
          const body = request.body as typeof CompleteRequest.static;

          if (body.result_schema_version !== RESULT_SCHEMA_VERSION) {
            throw unprocessable(
              `Unsupported result_schema_version ${body.result_schema_version}; ` +
                `this API expects ${RESULT_SCHEMA_VERSION}.`,
              { result_schema_version: 'Unsupported schema version.' },
            );
          }

          const outcome = await completeTask(context.db, id, body.lease_token, body.result);

          if (!outcome.accepted) {
            // The result violated the closed output schema, so the task was
            // failed rather than storing unvalidated content. 422 tells the
            // worker its output was the problem.
            context.logger.warn(
              {
                request_id: request.id,
                task_id: id,
                task_type: outcome.task.type,
                error_code: outcome.task.error_code,
              },
              'worker result rejected by contract schema; task failed',
            );
            return reply.status(422).send({
              error: {
                code: 'UNPROCESSABLE',
                message: outcome.task.error_message ?? 'The result failed schema validation.',
                request_id: request.id,
              },
            });
          }

          context.logger.info(
            { request_id: request.id, task_id: id, task_type: outcome.task.type },
            'task succeeded',
          );
          const ack: TaskAck = { task_id: outcome.task.id, state: outcome.task.state };
          return reply.status(200).send(ack);
        },
      );

      internal.post(
        '/tasks/:id/fail',
        { schema: { params: IdParams, body: FailRequest } },
        async (request, reply) => {
          const { id } = request.params as { id: string };
          const body = request.body as typeof FailRequest.static;

          const row = await failTask(context.db, id, body.lease_token, {
            code: body.code,
            retryable: body.retryable,
            redactedMessage: body.redacted_message,
            retryAfterMs: parseRetryAfter(request.headers['retry-after']),
          });

          context.logger.warn(
            {
              request_id: request.id,
              task_id: id,
              task_type: row.type,
              error_code: row.error_code,
              attempt: row.attempt,
              state: row.state,
            },
            'task failed',
          );

          const ack: TaskAck = { task_id: row.id, state: row.state };
          return reply.status(200).send(ack);
        },
      );

      // -- usage reservation --------------------------------------------------
      //
      // The budget is enforced here rather than in the worker because the
      // ledger is per workspace and per day, and a worker process lives for one
      // task. See src/usage/service.ts.

      internal.post(
        '/tasks/:id/usage/reserve',
        { schema: { params: IdParams, body: UsageReserveRequest } },
        async (request, reply) => {
          const { id } = request.params as { id: string };
          const body = request.body as typeof UsageReserveRequest.static;
          const reservation = await reserveUsage(context.db, id, body.lease_token, {
            estimatedInputTokens: body.estimated_input_tokens,
            estimatedOutputTokens: body.estimated_output_tokens,
          });
          return reply.status(201).send(reservation);
        },
      );

      internal.post(
        '/tasks/:id/usage/:reservation_id/settle',
        { schema: { params: ReservationParams, body: UsageSettleRequest } },
        async (request, reply) => {
          const { id, reservation_id: reservationId } = request.params as {
            id: string;
            reservation_id: string;
          };
          const body = request.body as typeof UsageSettleRequest.static;
          const settled = await settleUsage(context.db, id, body.lease_token, reservationId, {
            inputTokens: body.input_tokens,
            outputTokens: body.output_tokens,
          });
          return reply.status(200).send(settled);
        },
      );

      internal.post(
        '/tasks/:id/usage/:reservation_id/release',
        { schema: { params: ReservationParams, body: UsageReleaseRequest } },
        async (request, reply) => {
          const { id, reservation_id: reservationId } = request.params as {
            id: string;
            reservation_id: string;
          };
          const body = request.body as typeof UsageReleaseRequest.static;
          await releaseUsage(context.db, id, body.lease_token, reservationId);
          return reply.status(204).send();
        },
      );

      internal.get(
        '/tasks/:id/files/:file_id',
        { schema: { params: FileParams } },
        async (request, reply) => {
          const { id, file_id: fileId } = request.params as { id: string; file_id: string };
          const leaseToken = leaseTokenFromHeader(request);
          const file = await authorizeTaskFile(context.db, id, fileId, leaseToken);
          const stream = await context.storage.createReadStream(file.storageKey);
          return reply
            .status(200)
            .header('content-type', downloadContentType(file.mime))
            .header('content-disposition', contentDispositionFor(file.originalName))
            .header('x-content-type-options', 'nosniff')
            .send(stream);
        },
      );

      internal.post(
        '/tasks/:id/artifacts',
        { schema: { params: IdParams } },
        async (request, reply) => {
          const { id } = request.params as { id: string };
          if (!request.isMultipart()) {
            throw malformed('This endpoint expects multipart/form-data.');
          }

          let buffer: Buffer | null = null;
          let filename = 'artifact';
          let purpose = 'generated_cv';
          let leaseToken: string | null = null;

          for await (const part of request.parts()) {
            if (part.type === 'file') {
              if (buffer !== null) throw unprocessable('Upload exactly one artifact per request.');
              buffer = await part.toBuffer();
              filename = part.filename;
              if (part.file.truncated) {
                throw unprocessable('The artifact exceeds the configured upload limit.');
              }
            } else if (part.fieldname === 'lease_token' && typeof part.value === 'string') {
              leaseToken = part.value;
            } else if (part.fieldname === 'purpose' && typeof part.value === 'string') {
              purpose = part.value;
            }
          }

          if (leaseToken === null) {
            leaseToken = leaseTokenFromHeader(request);
          }
          if (buffer === null) {
            throw unprocessable('No artifact file part was present.');
          }
          if (!(ARTIFACT_PURPOSES as readonly string[]).includes(purpose)) {
            throw unprocessable(
              `Artifact purpose must be one of: ${ARTIFACT_PURPOSES.join(', ')}.`,
              { purpose: 'Unsupported artifact purpose.' },
            );
          }

          // The lease is verified before a single byte is written, and the
          // workspace comes from the task row, never from the request.
          const task = await authorizeArtifactUpload(context.db, id, leaseToken);
          const scope = WorkspaceScope.forTaskWorkspace(context.db, task.workspace_id);

          const validated = await validateUpload(context.config, {
            buffer,
            originalName: filename,
            purpose: purpose as 'generated_cv' | 'export' | 'evidence',
          });

          const stored = await storeFile(scope, context.storage, buffer, validated, {
            originalName: filename,
            purpose: purpose as 'generated_cv' | 'export' | 'evidence',
            // Staging until the task completes. Unreferenced staging artifacts
            // expire after 24 hours and are removed by the scheduler.
            state: 'staging',
            expiresAt: new Date(Date.now() + ARTIFACT_STAGING_TTL_HOURS * 60 * 60 * 1000),
          });

          await scope
            .insertInto('task_artifacts', {
              task_id: task.id,
              file_id: stored.id,
              lease_token_hash: sha256Hex(leaseToken),
              committed: false,
            })
            .execute();

          const response: ArtifactUploadResponse = { file_id: stored.id, committed: false };
          return reply.status(201).send(response);
        },
      );
    },
    { prefix: INTERNAL_PREFIX },
  );
}
