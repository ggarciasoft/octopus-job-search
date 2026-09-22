/**
 * What the extension decides to do with a page, before it touches one.
 *
 * `decide` is the extension's whole judgement and it is a pure function, so
 * every refusal below is asserted without a browser, a network or a tab. The
 * refusals are the interesting half: an extension that fills the wrong page,
 * or fills a question it was supposed to leave, is worse than one that does
 * nothing.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { FillSessionGrant } from '@job-getter/contracts';
import {
  decide,
  formFingerprint,
  formFingerprintMaterial,
  withBlockedAttachment,
} from '../src/session.js';

const ORIGIN = 'https://boards.greenhouse.io';

function grant(overrides: Partial<FillSessionGrant> = {}): FillSessionGrant {
  return {
    session_id: '00000000-0000-4000-8000-000000000001',
    nonce: 'n'.repeat(43),
    expires_at: new Date(Date.now() + 600_000).toISOString(),
    application_id: '00000000-0000-4000-8000-000000000002',
    packet_id: '00000000-0000-4000-8000-000000000003',
    content_hash: 'a'.repeat(64),
    origin: ORIGIN,
    destination: {
      url: `${ORIGIN}/acme/jobs/1`,
      origin: ORIGIN,
      connector: 'greenhouse',
      connector_version: 'greenhouse/v1',
    },
    job: {
      job_id: '00000000-0000-4000-8000-000000000004',
      company: 'Northwind Robotics',
      title: 'Senior Platform Engineer',
    },
    resume_file_id: null,
    resume_sha256: null,
    resume_filename: null,
    fields: [
      {
        question_key: 'first_name',
        label: 'First name',
        answer: 'Ada',
        required: true,
        sensitivity: 'standard',
      },
    ],
    known_form_fingerprint: null,
    adapter: 'greenhouse',
    ...overrides,
  };
}

const IDENTITY = { company: 'Northwind Robotics', title: 'Senior Platform Engineer' };

function page(rows: unknown, overrides: { url?: string; identity?: unknown } = {}) {
  return {
    url: overrides.url ?? `${ORIGIN}/acme/jobs/1`,
    identity: overrides.identity ?? IDENTITY,
    fields: rows,
  };
}

function options(inspected: ReturnType<typeof page>) {
  const material = formFingerprintMaterial(inspected);
  return {
    fingerprint:
      material === ''
        ? null
        : formFingerprint(createHash('sha256').update(material, 'utf-8').digest('hex')),
    adapter: 'greenhouse',
    adapterVersion: 'v1',
  };
}

function run(rows: unknown, overrides: Parameters<typeof page>[1] = {}, session = grant()) {
  const inspected = page(rows, overrides);
  return decide(session, inspected, options(inspected));
}

const NAME_ROW = { selector: '#first_name', label: 'First name', kind: 'text', required: true };

describe('decide', () => {
  it('fills a matching page and waits for the person to submit', () => {
    const decision = run([NAME_ROW]);
    expect(decision.kind).toBe('fill');
    if (decision.kind !== 'fill') return;

    expect(decision.instructions).toEqual([
      { selector: '#first_name', kind: 'text', values: ['Ada'] },
    ]);
    // There is no `submitted` outcome for the extension to report.
    expect(decision.report.outcome).toBe('awaiting_user_submit');
    expect(decision.report.form_fingerprint).toMatch(/^v1:[0-9a-f]{32}$/);
  });

  it('refuses a tab that navigated away from the granted origin', () => {
    const decision = run([NAME_ROW], { url: 'https://attacker.example/apply' });
    expect(decision.kind).toBe('refuse');
    expect(decision).toMatchObject({ reason: expect.stringContaining('attacker.example') });
  });

  it('refuses a page whose job is not the one this packet names', () => {
    const decision = run([NAME_ROW], { identity: { company: 'Globex', title: 'Chef' } });
    expect(decision.kind).toBe('refuse');
    if (decision.kind !== 'refuse') return;
    // AT17: the packet and its approval survive, so the person can apply.
    expect(decision.report.outcome).toBe('unsupported');
  });

  it('refuses a page that declines to say whose it is', () => {
    const decision = run([NAME_ROW], { identity: {} });
    expect(decision.kind).toBe('refuse');
  });

  it('reports a page with no readable form as unsupported, not as an empty form', () => {
    const decision = run([]);
    expect(decision.kind).toBe('refuse');
    if (decision.kind !== 'refuse') return;
    expect(decision.report.outcome).toBe('unsupported');
    expect(decision.report.form_fingerprint).toBeNull();
  });

  it('pauses on a required question the packet cannot answer (AT14)', () => {
    const decision = run([
      NAME_ROW,
      {
        selector: '#referral',
        label: 'Internal referral code',
        kind: 'text',
        required: true,
      },
    ]);
    expect(decision.kind).toBe('fill');
    if (decision.kind !== 'fill') return;

    expect(decision.report.outcome).toBe('needs_input');
    expect(decision.report.unresolved_fields).toHaveLength(1);
    expect(decision.report.unresolved_fields[0]).toMatchObject({
      question_key: 'internal_referral_code',
      reason: 'new_question',
      required: true,
    });
    // And it is not in the list of things to type.
    expect(decision.instructions.map((item) => item.selector)).toEqual(['#first_name']);
  });

  it('leaves a demographic question alone even when the packet answers it', () => {
    const session = grant({
      fields: [
        {
          question_key: 'gender',
          label: 'Gender',
          answer: 'Woman',
          required: false,
          sensitivity: 'never_reuse',
        },
      ],
    });
    const decision = run(
      [{ selector: '#gender', label: 'Gender', kind: 'select', options: ['Woman', 'Man'] }],
      {},
      session,
    );
    expect(decision.kind).toBe('fill');
    if (decision.kind !== 'fill') return;

    expect(decision.instructions).toEqual([]);
    expect(decision.report.unresolved_fields[0]).toMatchObject({ reason: 'never_inferable' });
  });

  it('refuses to guess at a near-miss option on a work-authorization question', () => {
    const session = grant({
      fields: [
        {
          question_key: 'are_you_authorized_to_work',
          label: 'Are you authorized to work?',
          answer: 'Yes',
          required: true,
          sensitivity: 'standard',
        },
      ],
    });
    const decision = run(
      [
        {
          selector: '#auth',
          label: 'Are you authorized to work?',
          kind: 'select',
          required: true,
          options: ['Yes, with sponsorship', 'No'],
        },
      ],
      {},
      session,
    );
    expect(decision.kind).toBe('fill');
    if (decision.kind !== 'fill') return;

    expect(decision.instructions).toEqual([]);
    expect(decision.report.unresolved_fields[0]).toMatchObject({ reason: 'needs_exact_mapping' });
  });

  it('asks the person to attach the CV when the session carries no file', () => {
    const decision = run([{ selector: '#cv', label: 'Resume', kind: 'file', required: true }]);
    expect(decision.kind).toBe('fill');
    if (decision.kind !== 'fill') return;

    expect(decision.attachment).toBeNull();
    expect(decision.report.unresolved_fields[0]).toMatchObject({ reason: 'file_upload_blocked' });
    expect(decision.report.outcome).toBe('needs_input');
  });

  it('plans the attachment when the session names one', () => {
    const session = grant({
      resume_file_id: '00000000-0000-4000-8000-000000000005',
      resume_sha256: 'b'.repeat(64),
      resume_filename: 'cv.pdf',
    });
    const decision = run(
      [{ selector: '#cv', label: 'Resume', kind: 'file', required: true }],
      {},
      session,
    );
    expect(decision.kind).toBe('fill');
    if (decision.kind !== 'fill') return;
    expect(decision.attachment).toMatchObject({
      selector: '#cv',
      questionKey: 'resume',
      required: true,
    });
  });
});

describe('withBlockedAttachment', () => {
  it('turns a CV that would not attach into an unresolved question', () => {
    const session = grant({
      resume_file_id: '00000000-0000-4000-8000-000000000005',
      resume_sha256: 'b'.repeat(64),
      resume_filename: 'cv.pdf',
    });
    const decision = run(
      [NAME_ROW, { selector: '#cv', label: 'Resume/CV', kind: 'file', required: true }],
      {},
      session,
    );
    expect(decision.kind).toBe('fill');
    if (decision.kind !== 'fill') return;
    // Planned, so the report says nothing about it yet.
    expect(decision.report.outcome).toBe('awaiting_user_submit');

    // The page would not take it. The person must be told, or they would
    // believe a CV was sent.
    const blocked = withBlockedAttachment(decision.report, decision.attachment!);
    expect(blocked.outcome).toBe('needs_input');
    expect(blocked.unresolved_fields.at(-1)).toMatchObject({
      question_key: 'resume_cv',
      reason: 'file_upload_blocked',
      required: true,
    });
  });
});
