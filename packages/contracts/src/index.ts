/**
 * Authoritative contract definitions for Job Getter.
 *
 * Everything the API validates, the worker parses and the web client consumes
 * is generated from these TypeBox schemas. Do not hand-write a parallel enum
 * or Pydantic model elsewhere; run `pnpm contracts:generate` instead and let
 * CI check for drift (00_AI_IMPLEMENTATION_INSTRUCTIONS.md).
 */
import { registerContractFormats } from './formats.js';

// Side effect on import: TypeBox's format registry is global and empty by
// default, so an unregistered 'uuid' or 'date-time' makes Value.Check reject
// valid payloads. Registering here means no consumer can forget to.
registerContractFormats();

export * from './formats.js';
export * from './common.js';
export * from './schemas/auth.js';
export * from './schemas/files.js';
export * from './schemas/preferences.js';
export * from './schemas/profile.js';
export * from './schemas/providers.js';
export * from './tasks/registry.js';
export * from './tasks/protocol.js';
export * from './tasks/noop-echo.js';
export * from './tasks/parse-profile.js';
export * from './routes.js';
export {
  TASK_IO_SCHEMAS,
  EXPORTED_SCHEMAS,
  EXPORTED_ENUMS,
  EXPORTED_CONSTANTS,
} from './exports.js';
