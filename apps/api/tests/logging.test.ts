/**
 * Redaction is a hard requirement, not best effort (09_SECURITY_PRIVACY.md:
 * "Do not log CV text, answers, tokens or raw prompts").
 *
 * These tests write to an in-memory destination and inspect the actual JSON
 * lines pino produced.
 */
import { describe, expect, it } from 'vitest';
import { Writable } from 'node:stream';
import { createLogger, redactObject } from '../src/logging.js';

function captureLogs(run: (logger: ReturnType<typeof createLogger>) => void): string {
  let output = '';
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      output += String(chunk);
      callback();
    },
  });
  const logger = createLogger({ level: 'trace', destination });
  run(logger);
  return output;
}

describe('log redaction', () => {
  it('never emits a password, token, cookie or Authorization header', () => {
    const output = captureLogs((logger) => {
      logger.info(
        {
          req: {
            headers: {
              authorization: 'Bearer super-secret-worker-token',
              cookie: 'jg_session=the-real-session-token',
              'x-csrf-token': 'the-real-csrf-token',
              'x-lease-token': 'the-real-lease-token',
            },
          },
          body: { password: 'correct horse battery staple', setup_token: 'the-setup-token' },
        },
        'sensitive',
      );
    });

    expect(output).not.toContain('super-secret-worker-token');
    expect(output).not.toContain('the-real-session-token');
    expect(output).not.toContain('the-real-csrf-token');
    expect(output).not.toContain('the-real-lease-token');
    expect(output).not.toContain('correct horse battery staple');
    expect(output).not.toContain('the-setup-token');
    expect(output).toContain('[redacted]');
  });

  it('never emits task payloads, results or CV text', () => {
    const output = captureLogs((logger) => {
      logger.info(
        {
          payload: { message: 'PRIVATE CV CONTENT' },
          result: { echoed: 'PRIVATE RESULT' },
          input: { inline_text: 'ten years at ACME Corp' },
        },
        'task',
      );
    });

    expect(output).not.toContain('PRIVATE CV CONTENT');
    expect(output).not.toContain('PRIVATE RESULT');
    expect(output).not.toContain('ACME Corp');
  });

  it('keeps the operational fields that make a log useful', () => {
    const output = captureLogs((logger) => {
      logger.info(
        {
          request_id: '8b1f3e2c-0d4a-4b6c-9e8f-1a2b3c4d5e6f',
          task_id: '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f',
          duration_ms: 42,
          error_code: 'PROVIDER_UNAVAILABLE',
        },
        'request completed',
      );
    });

    expect(output).toContain('8b1f3e2c-0d4a-4b6c-9e8f-1a2b3c4d5e6f');
    expect(output).toContain('1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f');
    expect(output).toContain('"duration_ms":42');
    expect(output).toContain('PROVIDER_UNAVAILABLE');
  });

  it('emits structured JSON, one object per line', () => {
    const output = captureLogs((logger) => {
      logger.info({ request_id: 'abc' }, 'first');
      logger.warn({ request_id: 'def' }, 'second');
    });

    const lines = output.trim().split('\n');
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      const parsed = JSON.parse(line) as { message: string; service: string; time: string };
      expect(parsed.service).toBe('api');
      expect(typeof parsed.message).toBe('string');
      expect(Number.isNaN(Date.parse(parsed.time))).toBe(false);
    }
  });
});

describe('redactObject', () => {
  it('censors by key name at any depth', () => {
    const result = redactObject({
      safe: 'kept',
      nested: { api_key: 'sk-live-123', answer: 'my salary expectation' },
    }) as Record<string, Record<string, string>>;

    expect(result['safe']).toBe('kept');
    expect(result['nested']!['api_key']).toBe('[redacted]');
    expect(result['nested']!['answer']).toBe('[redacted]');
  });

  it('bounds depth, breadth and string length', () => {
    let deep: Record<string, unknown> = { value: 'bottom' };
    for (let level = 0; level < 10; level += 1) deep = { deep };
    expect(JSON.stringify(redactObject(deep))).toContain('[truncated]');

    const wide = Object.fromEntries(
      Array.from({ length: 100 }, (_unused, index) => [`k${index}`, index]),
    );
    expect(JSON.stringify(redactObject(wide))).toContain('[truncated]');

    expect(redactObject('x'.repeat(500))).toBe('[truncated]');
  });
});
