/**
 * GET/PATCH /profile.
 *
 * What is asserted here is behaviour, not wiring: a value that does not match
 * the schema its `kind` selects is refused; a "current" role with an end date
 * is refused; a stale `expected_revision` changes nothing; and one workspace
 * cannot touch another's facts.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Value } from '@sinclair/typebox/value';
import { Profile as ProfileSchema } from '@job-getter/contracts';
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

export const EXPERIENCE = {
  employer: 'Acme Robotics',
  title: 'Senior Engineer',
  start_month: '2020-01',
  end_month: '2022-06',
  current: false,
  employment_type: 'full_time',
  bullets: [{ text: 'Shipped the gripper firmware.', evidence_reference: 'cv.pdf p1' }],
  skills: ['c++'],
} as const;

const CONTACT = {
  full_name: 'Ada Lovelace',
  email: 'ada@example.invalid',
} as const;

function getProfile(as: Session = session) {
  return harness.app.inject(authed(as, { method: 'GET', url: '/api/v1/profile' }));
}

function patchProfile(payload: Record<string, unknown>, as: Session = session) {
  return harness.app.inject(authed(as, { method: 'PATCH', url: '/api/v1/profile', payload }));
}

describe('GET /profile', () => {
  it('returns the empty profile the owner setup created, matching the contract', async () => {
    const response = await getProfile();
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(Value.Check(ProfileSchema, body)).toBe(true);
    expect(body.revision).toBe(1);
    expect(body.confirmed_revision).toBeNull();
    expect(body.contact).toBeNull();
    expect(body.facts).toEqual([]);
  });

  it('creates the row on demand for a workspace provisioned outside setup', async () => {
    const other = await createSecondWorkspace(harness);
    const response = await getProfile(other);
    expect(response.statusCode).toBe(200);
    expect(response.json().revision).toBe(1);
  });

  it('requires a session', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/api/v1/profile' });
    expect(response.statusCode).toBe(401);
  });
});

describe('PATCH /profile', () => {
  it('adds a fact, bumps the revision once and records confirmed_revision', async () => {
    const response = await patchProfile({
      expected_revision: 1,
      contact: CONTACT,
      changes: [{ op: 'upsert', kind: 'experience', value: EXPERIENCE, confirmed: true }],
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(Value.Check(ProfileSchema, body)).toBe(true);
    expect(body.revision).toBe(2);
    expect(body.confirmed_revision).toBe(2);
    expect(body.contact).toEqual(CONTACT);
    expect(body.facts).toHaveLength(1);
    expect(body.facts[0].kind).toBe('experience');
    expect(body.facts[0].confirmed).toBe(true);
    expect(body.facts[0].revision).toBe(2);
  });

  it('leaves confirmed_revision alone when only unconfirmed facts change', async () => {
    const response = await patchProfile({
      expected_revision: 1,
      changes: [{ op: 'upsert', kind: 'experience', value: EXPERIENCE, confirmed: false }],
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().revision).toBe(2);
    expect(response.json().confirmed_revision).toBeNull();
  });

  it('updates and deletes an existing fact by id', async () => {
    const created = await patchProfile({
      expected_revision: 1,
      changes: [{ op: 'upsert', kind: 'experience', value: EXPERIENCE, confirmed: true }],
    });
    const factId = created.json().facts[0].id;

    const updated = await patchProfile({
      expected_revision: 2,
      changes: [
        {
          op: 'upsert',
          id: factId,
          kind: 'experience',
          value: { ...EXPERIENCE, title: 'Staff Engineer' },
          confirmed: true,
        },
      ],
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().facts).toHaveLength(1);
    expect(updated.json().facts[0].value.title).toBe('Staff Engineer');

    const deleted = await patchProfile({
      expected_revision: 3,
      changes: [{ op: 'delete', id: factId }],
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json().facts).toEqual([]);
  });

  it('rejects a stale expected_revision with 409 STALE_REVISION and writes nothing', async () => {
    await patchProfile({
      expected_revision: 1,
      changes: [{ op: 'upsert', kind: 'experience', value: EXPERIENCE, confirmed: true }],
    });

    const stale = await patchProfile({
      expected_revision: 1,
      changes: [
        {
          op: 'upsert',
          kind: 'skill',
          value: {
            canonical_name: 'Rust',
            aliases: [],
            user_declared_proficiency: null,
            years: null,
          },
          confirmed: true,
        },
      ],
    });

    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('STALE_REVISION');

    const after = await getProfile();
    expect(after.json().revision).toBe(2);
    expect(after.json().facts).toHaveLength(1);
  });

  describe('value validation against the kind', () => {
    it('rejects a value that belongs to a different kind', async () => {
      const response = await patchProfile({
        expected_revision: 1,
        // A perfectly valid *skill* value, submitted as an experience.
        changes: [
          {
            op: 'upsert',
            kind: 'experience',
            value: {
              canonical_name: 'TypeScript',
              aliases: [],
              user_declared_proficiency: null,
              years: null,
            },
            confirmed: true,
          },
        ],
      });

      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe('UNPROCESSABLE');
      expect((await getProfile()).json().facts).toEqual([]);
    });

    it('rejects an unknown property inside a fact value', async () => {
      const response = await patchProfile({
        expected_revision: 1,
        changes: [
          {
            op: 'upsert',
            kind: 'experience',
            value: { ...EXPERIENCE, years_of_experience: 12 },
            confirmed: true,
          },
        ],
      });
      expect(response.statusCode).toBe(422);
    });

    it('rejects current: true together with a non-null end_month', async () => {
      const response = await patchProfile({
        expected_revision: 1,
        changes: [
          {
            op: 'upsert',
            kind: 'experience',
            value: { ...EXPERIENCE, current: true, end_month: '2023-01' },
            confirmed: true,
          },
        ],
      });

      expect(response.statusCode).toBe(422);
      expect(response.json().error.fields).toMatchObject({
        'changes.0.end_month': expect.stringContaining('null'),
      });
    });

    it('accepts current: true with a null end_month', async () => {
      const response = await patchProfile({
        expected_revision: 1,
        changes: [
          {
            op: 'upsert',
            kind: 'experience',
            value: { ...EXPERIENCE, current: true, end_month: null },
            confirmed: true,
          },
        ],
      });
      expect(response.statusCode).toBe(200);
    });

    it('rejects an end_month that precedes start_month', async () => {
      const response = await patchProfile({
        expected_revision: 1,
        changes: [
          {
            op: 'upsert',
            kind: 'experience',
            value: { ...EXPERIENCE, start_month: '2022-06', end_month: '2020-01' },
            confirmed: true,
          },
        ],
      });
      expect(response.statusCode).toBe(422);
      expect(response.json().error.fields).toHaveProperty('changes.0.end_month');
    });

    it('rejects education that ends before it starts', async () => {
      const response = await patchProfile({
        expected_revision: 1,
        changes: [
          {
            op: 'upsert',
            kind: 'education',
            value: {
              institution: 'University',
              degree: 'BSc',
              subject: 'CS',
              start_month: '2015-09',
              end_month: '2014-09',
              current: false,
            },
            confirmed: true,
          },
        ],
      });
      expect(response.statusCode).toBe(422);
    });

    it('rejects the whole batch when one change is invalid', async () => {
      const response = await patchProfile({
        expected_revision: 1,
        changes: [
          { op: 'upsert', kind: 'experience', value: EXPERIENCE, confirmed: true },
          {
            op: 'upsert',
            kind: 'experience',
            value: { ...EXPERIENCE, current: true },
            confirmed: true,
          },
        ],
      });

      expect(response.statusCode).toBe(422);
      const after = await getProfile();
      expect(after.json().revision).toBe(1);
      expect(after.json().facts).toEqual([]);
    });
  });

  it('rejects an unknown top-level key in the patch body', async () => {
    const response = await patchProfile({
      expected_revision: 1,
      changes: [],
      sneaky: true,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('never accepts a client-supplied workspace_id', async () => {
    const other = await createSecondWorkspace(harness);
    const response = await patchProfile({
      expected_revision: 1,
      workspace_id: other.workspaceId,
      changes: [],
    });
    expect(response.statusCode).toBe(400);
  });

  describe('workspace isolation', () => {
    it("reports another workspace's fact id as absent", async () => {
      const other = await createSecondWorkspace(harness);
      const created = await patchProfile(
        {
          expected_revision: 1,
          changes: [{ op: 'upsert', kind: 'experience', value: EXPERIENCE, confirmed: true }],
        },
        other,
      );
      expect(created.statusCode).toBe(200);
      const foreignFactId = created.json().facts[0].id;

      const response = await patchProfile({
        expected_revision: 1,
        changes: [
          {
            op: 'upsert',
            id: foreignFactId,
            kind: 'experience',
            value: EXPERIENCE,
            confirmed: true,
          },
        ],
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('NOT_FOUND');

      // Byte-identical to a genuinely absent id.
      const absent = await patchProfile({
        expected_revision: 1,
        changes: [
          {
            op: 'upsert',
            id: randomUUID(),
            kind: 'experience',
            value: EXPERIENCE,
            confirmed: true,
          },
        ],
      });
      expect(absent.statusCode).toBe(404);
      expect(absent.json().error.message).toBe(response.json().error.message);

      // The other workspace's fact is untouched.
      const otherAfter = await getProfile(other);
      expect(otherAfter.json().facts).toHaveLength(1);
      expect(otherAfter.json().facts[0].value.title).toBe(EXPERIENCE.title);
    });

    it('keeps each workspace on its own revision counter', async () => {
      const other = await createSecondWorkspace(harness);
      await patchProfile({ expected_revision: 1, changes: [] });
      await patchProfile({ expected_revision: 2, changes: [] });

      expect((await getProfile()).json().revision).toBe(3);
      expect((await getProfile(other)).json().revision).toBe(1);
    });
  });
});
