/**
 * Which adapter reads which page.
 *
 * The same rule `test_runner_lever.py` asserts in Chromium: no page is claimed
 * by two adapters. Lever's form shares Greenhouse's `#application-form` id, so
 * without Greenhouse's refusal a Lever page would be read by the wrong reader,
 * and a packet approved through the runner would read as stale here.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { ADAPTERS, pick } from '../src/adapters/index.js';
import { KNOWN_ADAPTERS, knownAdapter } from '../src/adapters/known.js';

function load(name: string, url: string): Document {
  const path = resolve(process.cwd(), '../../fixtures/ats-pages', name);
  return new JSDOM(readFileSync(path, 'utf-8'), { url }).window.document;
}

const LOCAL = 'http://127.0.0.1:9999/';

describe('picking an adapter', () => {
  it.each([
    ['greenhouse-application.html', 'greenhouse'],
    ['greenhouse-application-changed.html', 'greenhouse'],
    ['greenhouse-confirmation.html', 'greenhouse'],
    ['lever-application.html', 'lever'],
    ['lever-application-changed.html', 'lever'],
    ['unsupported-application.html', null],
  ])('%s is claimed by %s alone', (name, owner) => {
    const document = load(name, LOCAL + name);
    const claimed = ADAPTERS.filter((adapter) =>
      adapter.handles(LOCAL + name, adapter.marker(document)),
    ).map((adapter) => adapter.name);
    expect(claimed).toEqual(owner === null ? [] : [owner]);
    expect(pick(LOCAL + name, document)?.name ?? null).toBe(owner);
  });

  it('gives a Lever host to Lever even when the page is Greenhouse-shaped', () => {
    const url = 'https://jobs.lever.co/orbital-foods/1/apply';
    expect(pick(url, load('greenhouse-application.html', url))?.name).toBe('lever');
  });
});

describe('the adapters the service worker will name', () => {
  it('are exactly the ones the content script has', () => {
    expect(ADAPTERS.map(({ name, version }) => ({ name, version }))).toEqual(KNOWN_ADAPTERS);
  });

  it('never include one a page merely claims', () => {
    expect(knownAdapter({ name: 'lever', version: 'v1' })).toEqual({
      adapter: 'lever',
      adapterVersion: 'v1',
    });
    expect(knownAdapter({ name: 'lever', version: 'v2' })).toEqual({
      adapter: null,
      adapterVersion: null,
    });
    expect(knownAdapter('greenhouse')).toEqual({ adapter: null, adapterVersion: null });
  });
});
