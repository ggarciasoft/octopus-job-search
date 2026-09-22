/**
 * Private file storage.
 *
 * 09_SECURITY_PRIVACY.md: "Private storage keys are generated IDs, not user
 * filenames." A storage key is therefore always `<workspace-uuid>/<file-uuid>`
 * — it carries no user-controlled text at all, which removes path traversal,
 * case-collision and encoding problems in one move.
 *
 * The S3 driver is declared but not implemented: hosted deployment is
 * milestone M6 and a driver that silently wrote nowhere would present an
 * unsupported deployment as working (invariant 10). `loadConfig` refuses to
 * boot with STORAGE_DRIVER=s3 for the same reason.
 */
import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import type { Config } from '../config.js';
import { isUuid } from '../validation.js';

export interface StoredObjectInfo {
  readonly bytes: number;
}

export interface StorageDriver {
  readonly kind: 'local' | 's3';
  /** Writes (or overwrites) the object at `key`. */
  put(key: string, data: Buffer): Promise<void>;
  /** Opens a read stream. Throws if the object is absent. */
  createReadStream(key: string): Promise<Readable>;
  /** Reads the whole object; used for checksum verification in tests. */
  read(key: string): Promise<Buffer>;
  stat(key: string): Promise<StoredObjectInfo | null>;
  /** Removes the object. Absent objects are not an error. */
  delete(key: string): Promise<void>;
  /**
   * Removes every object stored under a workspace, whether or not a `files`
   * row still names it: a crashed upload or a late worker artifact can leave
   * bytes no row points at, and a workspace deletion must erase those too.
   * An absent workspace is not an error.
   */
  deleteWorkspaceObjects(workspaceId: string): Promise<void>;
  /** Readiness probe: is the backing store usable right now? */
  healthCheck(): Promise<{ ok: boolean; detail: string }>;
}

export class StorageKeyError extends Error {
  constructor(key: string) {
    super(`Refusing to use storage key "${key}": keys must be <uuid>/<uuid>.`);
    this.name = 'StorageKeyError';
  }
}

/**
 * Generates a storage key. Note what is *not* here: the original filename,
 * the purpose, the mime type or anything else a user can influence.
 */
export function generateStorageKey(workspaceId: string, fileId: string = randomUUID()): string {
  if (!isUuid(workspaceId) || !isUuid(fileId))
    throw new StorageKeyError(`${workspaceId}/${fileId}`);
  return `${workspaceId}/${fileId}`;
}

function assertValidKey(key: string): [string, string] {
  const parts = key.split('/');
  if (parts.length !== 2) throw new StorageKeyError(key);
  const [workspaceId, fileId] = parts;
  if (!isUuid(workspaceId) || !isUuid(fileId)) throw new StorageKeyError(key);
  return [workspaceId, fileId];
}

export class LocalStorageDriver implements StorageDriver {
  readonly kind = 'local' as const;
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  /**
   * Resolves a key to an absolute path and re-checks containment. The key
   * format already forbids traversal, but a second check costs nothing and
   * turns a future format change from a vulnerability into an exception.
   */
  private pathFor(key: string): string {
    assertValidKey(key);
    const path = resolve(join(this.root, key));
    if (path !== this.root && !path.startsWith(this.root + sep)) {
      throw new StorageKeyError(key);
    }
    return path;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data, { mode: 0o600, flag: 'w' });
  }

  async createReadStream(key: string): Promise<Readable> {
    const path = this.pathFor(key);
    await stat(path);
    return createReadStream(path);
  }

  async read(key: string): Promise<Buffer> {
    const { readFile } = await import('node:fs/promises');
    return readFile(this.pathFor(key));
  }

  async stat(key: string): Promise<StoredObjectInfo | null> {
    try {
      const result = await stat(this.pathFor(key));
      return { bytes: result.size };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  async deleteWorkspaceObjects(workspaceId: string): Promise<void> {
    // The key format makes a workspace a directory of its own. Validated as a
    // UUID first, so this can never be asked to remove the root or a sibling.
    if (!isUuid(workspaceId)) throw new StorageKeyError(workspaceId);
    const path = resolve(join(this.root, workspaceId));
    if (!path.startsWith(this.root + sep)) throw new StorageKeyError(workspaceId);
    await rm(path, { recursive: true, force: true });
  }

  async healthCheck(): Promise<{ ok: boolean; detail: string }> {
    try {
      await mkdir(this.root, { recursive: true });
      const probeKey = `${randomUUID()}/${randomUUID()}`;
      const probePath = join(this.root, probeKey);
      await mkdir(dirname(probePath), { recursive: true });
      await writeFile(probePath, Buffer.from('ok'), { mode: 0o600 });
      await rm(dirname(probePath), { recursive: true, force: true });
      return { ok: true, detail: `local storage writable at ${this.root}` };
    } catch (error) {
      return {
        ok: false,
        detail: `local storage is not writable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }
}

/**
 * Interface placeholder for hosted S3-compatible storage (milestone M6).
 *
 * Every method throws. This class exists so the shape of the hosted driver is
 * documented and so a future implementation has a named place to live — not so
 * that hosted mode appears to work. `loadConfig` rejects STORAGE_DRIVER=s3
 * before this can ever be constructed in a running server.
 */
export class S3StorageDriver implements StorageDriver {
  readonly kind = 's3' as const;

  private static unimplemented(): never {
    throw new Error(
      'The S3 storage driver is not implemented. Hosted object storage is milestone M6 ' +
        '(docs/spec/12_IMPLEMENTATION_PLAN.md); use STORAGE_DRIVER=local.',
    );
  }

  // Declared `async` so callers get a rejected promise rather than a
  // synchronous throw: a driver method is awaited, and the two failure modes
  // are handled differently by callers.
  async put(): Promise<void> {
    return S3StorageDriver.unimplemented();
  }

  async createReadStream(): Promise<Readable> {
    return S3StorageDriver.unimplemented();
  }

  async read(): Promise<Buffer> {
    return S3StorageDriver.unimplemented();
  }

  async stat(): Promise<StoredObjectInfo | null> {
    return S3StorageDriver.unimplemented();
  }

  async delete(): Promise<void> {
    return S3StorageDriver.unimplemented();
  }

  async deleteWorkspaceObjects(): Promise<void> {
    return S3StorageDriver.unimplemented();
  }

  async healthCheck(): Promise<{ ok: boolean; detail: string }> {
    return { ok: false, detail: 'S3 storage driver is not implemented (milestone M6).' };
  }
}

export function createStorageDriver(config: Config): StorageDriver {
  if (config.storageDriver === 's3') return new S3StorageDriver();
  return new LocalStorageDriver(config.filesRoot);
}
