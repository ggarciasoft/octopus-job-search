import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';
import { testEnv } from './helpers/harness.js';

describe('configuration (10_DEPLOYMENT.md environment contract)', () => {
  it('accepts a complete local environment and normalises derived values', () => {
    const config = loadConfig(testEnv({ APP_ORIGIN: 'http://localhost:3000/' }));

    expect(config.appMode).toBe('local');
    expect(config.appOrigin).toBe('http://localhost:3000');
    expect(config.isHosted).toBe(false);
    expect(config.cookieSecure).toBe(false);
    expect(config.encryptionKey.byteLength).toBe(32);
    expect(config.storageDriver).toBe('local');
    expect(config.billingEnabled).toBe(false);
  });

  it('reports every missing variable at once rather than one per restart', () => {
    let error: unknown;
    try {
      loadConfig({ APP_MODE: 'local' });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ConfigError);
    const problems = (error as ConfigError).problems.join('\n');
    // A single run must name all of these; discovering them one restart at a
    // time is the failure mode this guards against.
    expect(problems).toContain('DATABASE_URL');
    expect(problems).toContain('SESSION_SECRET');
    expect(problems).toContain('ENCRYPTION_KEY');
    expect(problems).toContain('WORKER_AUTH_TOKEN');
    expect(problems).toContain('SETUP_TOKEN');
    expect((error as ConfigError).problems.length).toBeGreaterThanOrEqual(5);
  });

  it('enforces the minimum length on SESSION_SECRET', () => {
    expect(() => loadConfig(testEnv({ SESSION_SECRET: 'too-short' }))).toThrow(ConfigError);
  });

  it('requires ENCRYPTION_KEY to decode to exactly 32 bytes', () => {
    const sixteenBytes = Buffer.alloc(16, 1).toString('base64');
    let problems: readonly string[] = [];
    try {
      loadConfig(testEnv({ ENCRYPTION_KEY: sixteenBytes }));
    } catch (error) {
      problems = (error as ConfigError).problems;
    }
    expect(problems.join('\n')).toContain('exactly 32 bytes');
  });

  it('rejects an ENCRYPTION_KEY that is not valid base64', () => {
    expect(() => loadConfig(testEnv({ ENCRYPTION_KEY: 'not base64 !!!' }))).toThrow(ConfigError);
  });

  it('refuses to boot in hosted mode with a placeholder secret', () => {
    let problems: readonly string[] = [];
    try {
      loadConfig(
        testEnv({
          APP_MODE: 'hosted',
          APP_ORIGIN: 'https://jobs.example.org',
          SESSION_SECRET: 'changeme-changeme-changeme-changeme',
        }),
      );
    } catch (error) {
      problems = (error as ConfigError).problems;
    }
    expect(problems.join('\n')).toContain('SESSION_SECRET looks like a placeholder');
  });

  it('refuses hosted mode over plain http, because cookies are Secure there', () => {
    let problems: readonly string[] = [];
    try {
      loadConfig({
        ...testEnv({ APP_MODE: 'hosted', APP_ORIGIN: 'http://jobs.internal' }),
        SESSION_SECRET: 'Zk4tR9wQ2mP7xL1vB8nC3yH6jF0sD5gA',
        WORKER_AUTH_TOKEN: 'Qp8mN2vX7bL4kR9tY6wZ3cH1jS5dG0fA',
        SETUP_TOKEN: undefined,
      });
    } catch (error) {
      problems = (error as ConfigError).problems;
    }
    expect(problems.join('\n')).toContain('https');
  });

  it('refuses to share one secret between the session and worker principals', () => {
    const shared = 'Zk4tR9wQ2mP7xL1vB8nC3yH6jF0sD5gA';
    let problems: readonly string[] = [];
    try {
      loadConfig(
        testEnv({
          APP_MODE: 'hosted',
          APP_ORIGIN: 'https://jobs.internal',
          SESSION_SECRET: shared,
          WORKER_AUTH_TOKEN: shared,
          SETUP_TOKEN: undefined,
        }),
      );
    } catch (error) {
      problems = (error as ConfigError).problems;
    }
    expect(problems.join('\n')).toContain('must differ');
  });

  it('requires SETUP_TOKEN in local mode so an owner can actually be created', () => {
    let problems: readonly string[] = [];
    try {
      loadConfig(testEnv({ SETUP_TOKEN: undefined }));
    } catch (error) {
      problems = (error as ConfigError).problems;
    }
    expect(problems.join('\n')).toContain('SETUP_TOKEN is required in local mode');
  });

  it('refuses STORAGE_DRIVER=s3 rather than pretending hosted storage works', () => {
    let problems: readonly string[] = [];
    try {
      loadConfig(testEnv({ STORAGE_DRIVER: 's3' }));
    } catch (error) {
      problems = (error as ConfigError).problems;
    }
    // Invariant 10: an unimplemented backend must not look available.
    expect(problems.join('\n')).toContain('not implemented');
  });

  it('rejects a non-integer PORT and a malformed APP_ORIGIN together', () => {
    let problems: readonly string[] = [];
    try {
      loadConfig(testEnv({ PORT: 'eighty', APP_ORIGIN: 'not-a-url' }));
    } catch (error) {
      problems = (error as ConfigError).problems;
    }
    expect(problems.join('\n')).toContain('PORT');
    expect(problems.join('\n')).toContain('APP_ORIGIN');
  });

  it('parses ALLOWED_FETCH_HOSTS into a normalised list', () => {
    const config = loadConfig(
      testEnv({ ALLOWED_FETCH_HOSTS: 'Boards.Greenhouse.io, api.lever.co ,' }),
    );
    expect(config.allowedFetchHosts).toEqual(['boards.greenhouse.io', 'api.lever.co']);
  });
});
