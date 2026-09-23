/**
 * The settings file: GET /settings/export and POST /settings/import.
 *
 * What is asserted:
 *
 *  * the file carries preferences and boards and nothing else: no provider
 *    key, no provider at all, no answer bank, no board health;
 *  * an export imports into another workspace and reproduces it;
 *  * an import is all or nothing: an unknown key, a bad weight sum, a bad
 *    board or a stale revision leaves preferences *and* boards untouched;
 *  * boards are only ever added: one already present keeps its state, a
 *    blocked one stays blocked, and one the file omits is not deleted.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import {
  DEFAULT_PREFERENCES,
  DEFAULT_PROVIDER_LIMITS,
  SettingsFile,
  SettingsImportResult,
  type Preferences,
} from '@job-getter/contracts';
import {
  authed,
  completeSetup,
  createHarness,
  createSecondWorkspace,
  type Harness,
  type Session,
} from './helpers/harness.js';

let harness: Harness;
let session: Session;

beforeAll(async () => {
  harness = await createHarness();
}, 180_000);

afterAll(async () => {
  await harness.close();
});

beforeEach(async () => {
  await harness.reset();
  session = await completeSetup(harness);
});

const CUSTOM: Preferences = {
  ...DEFAULT_PREFERENCES,
  target_titles: ['Platform Engineer'],
  excluded_companies: ['Initech'],
  countries: ['ES'],
  match_weights: { skills: 50, role_title: 20, seniority: 10, work_arrangement: 10, industry: 10 },
  cv_language: 'es',
  resume_mode: 'original',
  prompt_style_suffix: 'Plain, short sentences.',
};

function exportSettings(as: Session = session) {
  return harness.app.inject(authed(as, { method: 'GET', url: '/api/v1/settings/export' }));
}

function importSettings(payload: Record<string, unknown>, as: Session = session) {
  return harness.app.inject(
    authed(as, { method: 'POST', url: '/api/v1/settings/import', payload }),
  );
}

async function revision(as: Session = session): Promise<number> {
  const response = await harness.app.inject(
    authed(as, { method: 'GET', url: '/api/v1/preferences' }),
  );
  return response.json().revision as number;
}

async function addSource(body: Record<string, unknown>, as: Session = session) {
  const response = await harness.app.inject(
    authed(as, { method: 'POST', url: '/api/v1/sources', payload: body }),
  );
  expect(response.statusCode).toBe(201);
  return response.json() as { id: string };
}

async function listSources(as: Session = session) {
  const response = await harness.app.inject(authed(as, { method: 'GET', url: '/api/v1/sources' }));
  return response.json().items as {
    connector: string;
    board_key: string;
    base_url: string | null;
    enabled: boolean;
    health: { state: string };
  }[];
}

function file(overrides: Record<string, unknown> = {}) {
  return {
    format: 'job-getter-settings',
    format_version: 1,
    exported_at: '2026-09-22T12:00:00.000Z',
    preferences: CUSTOM,
    sources: [
      { connector: 'greenhouse', board_key: 'northwind', base_url: null, enabled: true },
      {
        connector: 'lever',
        board_key: 'contoso',
        base_url: 'https://api.eu.lever.co',
        enabled: false,
      },
    ],
    ...overrides,
  };
}

/** Nothing about the workspace moved: preferences at revision 1, no boards. */
async function expectUntouched(as: Session = session) {
  expect(await revision(as)).toBe(1);
  expect(await listSources(as)).toEqual([]);
}

describe('GET /settings/export', () => {
  it('is a valid settings file of the defaults on a fresh workspace', async () => {
    const response = await exportSettings();
    expect(response.statusCode).toBe(200);
    expect(Value.Check(SettingsFile, response.json())).toBe(true);
    expect(response.json().preferences).toEqual(DEFAULT_PREFERENCES);
    expect(response.json().sources).toEqual([]);
  });

  it('carries no provider key, no provider, no answers and no board health', async () => {
    const secret = 'sk-test-0123456789abcdefTAIL';
    const provider = await harness.app.inject(
      authed(session, {
        method: 'PUT',
        url: '/api/v1/settings/providers',
        payload: {
          provider: 'openai_compatible',
          model: 'gpt-4o-mini',
          base_url: 'https://api.example.com/v1',
          limits: DEFAULT_PROVIDER_LIMITS,
          rate_card: null,
          api_key: secret,
        },
      }),
    );
    expect(provider.statusCode).toBe(200);
    const answer = await harness.app.inject(
      authed(session, {
        method: 'PUT',
        url: '/api/v1/answer-bank',
        payload: {
          question_key: 'phone',
          label: 'Phone',
          answer: '+34 600 000 000',
          sensitivity: 'sensitive',
          scope: 'general',
          scope_id: null,
        },
      }),
    );
    expect(answer.statusCode).toBe(200);
    await addSource({ connector: 'greenhouse', board_key: 'northwind' });

    const text = (await exportSettings()).body;
    expect(text).not.toContain(secret);
    expect(text).not.toContain('TAIL');
    expect(text).not.toContain('api.example.com');
    expect(text).not.toContain('600 000 000');
    expect(text).not.toContain('health');
    expect(Object.keys(JSON.parse(text)).sort()).toEqual([
      'exported_at',
      'format',
      'format_version',
      'preferences',
      'sources',
    ]);
  });

  it('exports only its own workspace', async () => {
    await addSource({ connector: 'greenhouse', board_key: 'northwind' });
    const other = await createSecondWorkspace(harness);
    expect((await exportSettings(other)).json().sources).toEqual([]);
  });

  it('refuses a request with no session', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/api/v1/settings/export' });
    expect(response.statusCode).toBe(401);
  });
});

describe('POST /settings/import', () => {
  it('reproduces one workspace in another', async () => {
    await importSettings({ expected_revision: 1, settings: file() });
    const exported = (await exportSettings()).json();

    const other = await createSecondWorkspace(harness);
    const response = await importSettings({ expected_revision: 1, settings: exported }, other);

    expect(response.statusCode).toBe(200);
    expect(Value.Check(SettingsImportResult, response.json())).toBe(true);
    expect(response.json().preferences.revision).toBe(2);
    expect(response.json().preferences.config).toEqual(CUSTOM);
    expect(response.json().sources_created).toBe(2);
    expect(response.json().sources_already_present).toBe(0);

    const again = (await exportSettings(other)).json();
    expect(again.preferences).toEqual(exported.preferences);
    expect(again.sources).toEqual(exported.sources);
  });

  it('keeps a board’s disabled state from the file when it creates it', async () => {
    await importSettings({ expected_revision: 1, settings: file() });
    const lever = (await listSources()).find((source) => source.connector === 'lever');
    expect(lever).toMatchObject({ enabled: false, base_url: 'https://api.eu.lever.co' });
  });

  it('adds only boards that are missing, and leaves the others as they were', async () => {
    const existing = await addSource({ connector: 'greenhouse', board_key: 'northwind' });
    await addSource({ connector: 'greenhouse', board_key: 'not-in-the-file' });
    // A board a site refused: only the person's own "try again" may clear it.
    await harness.db
      .updateTable('sources')
      .set({ enabled: false, health_state: 'blocked', consecutive_denials: 3 })
      .where('id', '=', existing.id)
      .execute();

    const response = await importSettings({ expected_revision: 1, settings: file() });
    expect(response.statusCode).toBe(200);
    expect(response.json().sources_created).toBe(1);
    expect(response.json().sources_already_present).toBe(1);

    const after = await listSources();
    expect(after.map((source) => source.board_key).sort()).toEqual([
      'contoso',
      'northwind',
      'not-in-the-file',
    ]);
    const stored = await harness.db
      .selectFrom('sources')
      .select(['enabled', 'health_state', 'consecutive_denials'])
      .where('id', '=', existing.id)
      .executeTakeFirstOrThrow();
    expect(stored).toEqual({ enabled: false, health_state: 'blocked', consecutive_denials: 3 });
  });

  it('can be applied twice, the second time adding nothing', async () => {
    await importSettings({ expected_revision: 1, settings: file() });
    const second = await importSettings({ expected_revision: 2, settings: file() });
    expect(second.statusCode).toBe(200);
    expect(second.json().sources_created).toBe(0);
    expect(second.json().sources_already_present).toBe(2);
    expect(await listSources()).toHaveLength(2);
  });

  it('records the import in the audit log without its contents', async () => {
    await importSettings({ expected_revision: 1, settings: file() });
    const events = await harness.db
      .selectFrom('audit_events')
      .select(['action', 'metadata'])
      .where('action', 'in', ['settings.imported', 'source.created'])
      .execute();

    expect(events.filter((event) => event.action === 'source.created')).toHaveLength(2);
    const imported = events.find((event) => event.action === 'settings.imported');
    expect(imported?.metadata).toMatchObject({
      revision: 2,
      sources_in_file: 2,
      sources_created: 2,
      weights_changed: true,
    });
    const logged = JSON.stringify(events);
    expect(logged).not.toContain('Platform Engineer');
    expect(logged).not.toContain('Initech');
    expect(logged).not.toContain('northwind');
  });

  describe('refuses the whole file, changing nothing', () => {
    it('for an unknown top-level key', async () => {
      const response = await importSettings({
        expected_revision: 1,
        settings: file({ provider_api_key: 'sk-nope' }),
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('VALIDATION_ERROR');
      expect(Object.keys(response.json().error.fields).join(' ')).toContain('provider_api_key');
      await expectUntouched();
    });

    it('for an unknown key inside a preference', async () => {
      const response = await importSettings({
        expected_revision: 1,
        settings: file({ preferences: { ...CUSTOM, target_tiles: ['typo'] } }),
      });
      expect(response.statusCode).toBe(400);
      expect(Object.keys(response.json().error.fields).join(' ')).toContain('target_tiles');
      await expectUntouched();
    });

    it('for an unknown key inside a board', async () => {
      const response = await importSettings({
        expected_revision: 1,
        settings: file({
          sources: [
            {
              connector: 'greenhouse',
              board_key: 'northwind',
              base_url: null,
              enabled: true,
              health: 'ok',
            },
          ],
        }),
      });
      expect(response.statusCode).toBe(400);
      await expectUntouched();
    });

    it.each([
      ['another format', { format: 'something-else' }],
      ['a newer format version', { format_version: 2 }],
      [
        'a connector that is not a board',
        {
          sources: [{ connector: 'manual', board_key: 'x', base_url: null, enabled: true }],
        },
      ],
    ])('for %s', async (_label, overrides) => {
      const response = await importSettings({ expected_revision: 1, settings: file(overrides) });
      expect(response.statusCode).toBe(400);
      await expectUntouched();
    });

    it('when the match weights do not sum to 100', async () => {
      const response = await importSettings({
        expected_revision: 1,
        settings: file({
          preferences: { ...CUSTOM, match_weights: { ...CUSTOM.match_weights, skills: 51 } },
        }),
      });
      expect(response.statusCode).toBe(422);
      expect(response.json().error.fields).toHaveProperty('match_weights');
      await expectUntouched();
    });

    it('when a board is listed twice, naming the second', async () => {
      const northwind = {
        connector: 'greenhouse',
        board_key: 'northwind',
        base_url: null,
        enabled: true,
      };
      const response = await importSettings({
        expected_revision: 1,
        settings: file({ sources: [northwind, northwind] }),
      });
      expect(response.statusCode).toBe(422);
      expect(response.json().error.fields).toHaveProperty(['settings.sources.1.board_key']);
      await expectUntouched();
    });

    it.each([
      ['an endpoint Greenhouse does not have', 'greenhouse', 'https://api.lever.co'],
      ['an undocumented host', 'lever', 'https://internal.example'],
      ['plain http', 'lever', 'http://api.lever.co'],
    ])('for a board with %s', async (_label, connector, baseUrl) => {
      const response = await importSettings({
        expected_revision: 1,
        settings: file({
          sources: [
            { connector: 'greenhouse', board_key: 'fine', base_url: null, enabled: true },
            { connector, board_key: 'bad', base_url: baseUrl, enabled: true },
          ],
        }),
      });
      expect(response.statusCode).toBe(422);
      expect(response.json().error.fields).toHaveProperty(['settings.sources.1.base_url']);
      await expectUntouched();
    });

    it('when preferences changed since the file was chosen', async () => {
      await harness.app.inject(
        authed(session, {
          method: 'PUT',
          url: '/api/v1/preferences',
          payload: {
            expected_revision: 1,
            config: { ...DEFAULT_PREFERENCES, scan_interval_hours: 12 },
          },
        }),
      );
      const response = await importSettings({ expected_revision: 1, settings: file() });
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe('STALE_REVISION');
      expect(await revision()).toBe(2);
      expect(await listSources()).toEqual([]);
    });
  });

  it('refuses a request without the anti-CSRF token', async () => {
    const response = await harness.app.inject(
      authed(session, {
        method: 'POST',
        url: '/api/v1/settings/import',
        payload: { expected_revision: 1, settings: file() },
        headers: { 'x-csrf-token': '' },
      }),
    );
    expect(response.statusCode).toBe(403);
    await expectUntouched();
  });
});
