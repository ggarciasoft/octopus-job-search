/**
 * GET /scans/:id — one scan: status, counts, whether the snapshot was
 * complete.
 *
 * The path parameter is resolved as a scan id or as the id of the task that
 * runs it (see `findScan`): `POST /sources/:id/scan` hands the client a task
 * id, and the contract declares no scan list to find the scan from.
 */
import { findScan, toScanView } from '../discovery/scans.js';
import { requireScope, type RouteHandler } from './context.js';

export const getScan: RouteHandler = async (context, request, reply) => {
  const scope = requireScope(context, request);
  const { id } = request.params as { id: string };
  const row = await findScan(scope, id);
  return reply.status(200).send(toScanView(row));
};
