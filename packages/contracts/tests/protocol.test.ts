/**
 * The extension/server protocol window: "support current and previous
 * protocol minor version" (10_DEPLOYMENT.md).
 *
 * There is only one version today, so the window is asserted against a
 * hypothetical server at 1.3. The rule has to be right before the first
 * extension that needs it is released, not after.
 */
import { describe, expect, it } from 'vitest';
import { EXTENSION_PROTOCOL_VERSION, extensionProtocolVerdict } from '../src/index.js';

describe('extensionProtocolVerdict', () => {
  it.each([
    ['1.3', true, undefined],
    ['1.2', true, undefined],
    ['1.1', false, 'too_old'],
    ['1.0', false, 'too_old'],
    ['0.9', false, 'too_old'],
    ['1.4', false, 'too_new'],
    ['2.0', false, 'too_new'],
    [' 1.2 ', true, undefined],
    ['1', false, 'malformed'],
    ['1.2.3', false, 'malformed'],
    ['v1.2', false, 'malformed'],
    ['', false, 'malformed'],
  ])('a server at 1.3 given %j: ok=%s', (sent, ok, reason) => {
    const verdict = extensionProtocolVerdict(sent, '1.3');
    expect(verdict.ok).toBe(ok);
    if (!verdict.ok) expect(verdict.reason).toBe(reason);
  });

  it('treats an extension that sends nothing as 1.0, which predates the header', () => {
    expect(extensionProtocolVerdict(undefined, '1.0')).toEqual({ ok: true });
    expect(extensionProtocolVerdict(undefined, '1.1')).toEqual({ ok: true });
    expect(extensionProtocolVerdict(undefined, '1.2')).toEqual({ ok: false, reason: 'too_old' });
  });

  it('accepts its own version', () => {
    expect(extensionProtocolVerdict(EXTENSION_PROTOCOL_VERSION)).toEqual({ ok: true });
  });
});
