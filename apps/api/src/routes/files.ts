/**
 * POST /files and GET /files/:id/download.
 *
 * "no public permanent URL" (04_API_CONTRACTS.md): every download is an
 * authenticated, workspace-scoped, attachment-only stream. There is no signed
 * URL, no static mount and no predictable path — the storage key never leaves
 * the server.
 */
import type { MultipartFile } from '@fastify/multipart';
import type { FilePurpose, FileUploadResponse } from '@job-getter/contracts';
import { malformed, notFound, payloadTooLarge, unprocessable } from '../errors.js';
import { recordAuditEvent } from '../auth/scope.js';
import {
  USER_UPLOADABLE_PURPOSES,
  contentDispositionFor,
  downloadContentType,
  storeFile,
  toFileView,
  validateUpload,
} from '../files/service.js';
import { requireScope, requireSession, type RouteHandler } from './context.js';

function isUploadablePurpose(value: unknown): value is FilePurpose {
  return (
    typeof value === 'string' &&
    (USER_UPLOADABLE_PURPOSES as readonly string[]).includes(value)
  );
}

export const uploadFile: RouteHandler = async (context, request, reply) => {
  const principal = requireSession(request);
  const scope = requireScope(context, request);

  if (!request.isMultipart()) {
    throw malformed('This endpoint expects multipart/form-data with a "file" part.');
  }

  let filePart: MultipartFile | null = null;
  let purpose: string | null = null;
  let buffer: Buffer | null = null;

  // Parts are consumed in order; the file is buffered because the signature,
  // size and sha256 must all be known before anything is written to storage.
  for await (const part of request.parts()) {
    if (part.type === 'file') {
      if (filePart !== null) throw unprocessable('Upload exactly one file per request.');
      filePart = part;
      buffer = await part.toBuffer();
      if (part.file.truncated) {
        throw payloadTooLarge(
          `The upload exceeds the ${context.config.maxUploadBytes} byte limit for this installation.`,
        );
      }
    } else if (part.fieldname === 'purpose' && typeof part.value === 'string') {
      purpose = part.value;
    }
  }

  if (filePart === null || buffer === null) {
    throw unprocessable('No file part was present in the request.', {
      file: 'A file part is required.',
    });
  }
  if (!isUploadablePurpose(purpose)) {
    throw unprocessable(
      `"purpose" must be one of: ${USER_UPLOADABLE_PURPOSES.join(', ')}.`,
      { purpose: 'Missing or unsupported purpose.' },
    );
  }

  const validated = await validateUpload(context.config, {
    buffer,
    originalName: filePart.filename,
    purpose,
  });

  const stored = await storeFile(scope, context.storage, buffer, validated, {
    originalName: filePart.filename,
    purpose,
    state: 'ready',
    expiresAt: null,
  });

  await recordAuditEvent(scope, {
    action: 'file.uploaded',
    actorId: principal.userId,
    objectId: stored.id,
    objectType: 'file',
    // Size and type only. The filename is user content and stays out of logs.
    metadata: { purpose, mime: validated.mime, bytes: validated.bytes },
  });

  const response: FileUploadResponse = {
    file: toFileView(stored.row),
    validation: validated.validation,
  };
  return reply.status(201).send(response);
};

export const downloadFile: RouteHandler = async (context, request, reply) => {
  const scope = requireScope(context, request);
  const { id } = request.params as { id: string };

  const file = await scope
    .selectFrom('files')
    .selectAll()
    .where('id', '=', id)
    .where('state', '!=', 'deleting')
    .executeTakeFirst();

  if (!file) throw notFound('No such file.');

  const stream = await context.storage.createReadStream(file.storage_key).catch(() => null);
  if (stream === null) throw notFound('No such file.');

  return reply
    .status(200)
    // Always an attachment with a sanitised name, and `nosniff`, so uploaded
    // HTML or SVG can never execute in the application's origin.
    .header('content-type', downloadContentType(file.mime))
    .header('content-disposition', contentDispositionFor(file.original_name))
    .header('content-length', String(file.bytes))
    .header('x-content-type-options', 'nosniff')
    .header('cache-control', 'private, no-store')
    .send(stream);
};
