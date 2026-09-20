import { describe, expect, it } from 'vitest';
import {
  STATUS_DESCRIPTORS,
  STATUS_KEYS,
  STATUS_VOCABULARY,
  describeStatus,
  isStatusKey,
  isSubmitted,
  isVerifiedSubmission,
} from './status';

describe('status vocabulary', () => {
  it('describes every required status from 08_UX_AND_CUSTOMIZATION.md', () => {
    expect([...STATUS_KEYS]).toEqual([
      'not_checked',
      'unknown',
      'needs_your_answer',
      'ready_for_review',
      'waiting_for_submission',
      'submitted_verified',
      'submitted_reported_by_you',
    ]);
  });

  it('gives every variant a distinct label and a distinct description', () => {
    const labels = STATUS_DESCRIPTORS.map((descriptor) => descriptor.defaultLabel);
    const descriptions = STATUS_DESCRIPTORS.map((descriptor) => descriptor.defaultDescription);

    expect(new Set(labels).size).toBe(STATUS_KEYS.length);
    expect(new Set(descriptions).size).toBe(STATUS_KEYS.length);
    for (const descriptor of STATUS_DESCRIPTORS) {
      expect(descriptor.defaultLabel.trim().length).toBeGreaterThan(0);
      expect(descriptor.defaultDescription.trim().length).toBeGreaterThan(0);
    }
  });

  it('keeps "submitted — reported by you" out of the verified category', () => {
    const reported = describeStatus('submitted_reported_by_you');
    const verified = describeStatus('submitted_verified');

    expect(isSubmitted('submitted_reported_by_you')).toBe(true);
    expect(isSubmitted('submitted_verified')).toBe(true);

    // The whole point of the split: both are "submitted", only one is evidence.
    expect(isVerifiedSubmission('submitted_reported_by_you')).toBe(false);
    expect(isVerifiedSubmission('submitted_verified')).toBe(true);
    expect(reported.evidence).toBe('user_reported');
    expect(verified.evidence).toBe('verified');

    expect(reported.defaultLabel).not.toBe(verified.defaultLabel);
    expect(reported.icon).not.toBe(verified.icon);
    expect(reported.tone).not.toBe(verified.tone);
    expect(reported.defaultLabel.toLowerCase()).not.toContain('verified');
    expect(reported.defaultDescription.toLowerCase()).toContain('no evidence');
  });

  it('reports no status other than submitted_verified as verified', () => {
    const verifiedKeys = STATUS_KEYS.filter((key) => isVerifiedSubmission(key));
    expect(verifiedKeys).toEqual(['submitted_verified']);
  });

  it('never treats "unknown" or "not checked" as a positive answer', () => {
    expect(describeStatus('unknown').evidence).toBe('insufficient');
    expect(describeStatus('not_checked').evidence).toBe('none');
    expect(isSubmitted('unknown')).toBe(false);
    expect(isSubmitted('not_checked')).toBe(false);
    expect(describeStatus('unknown').tone).not.toBe(describeStatus('not_checked').tone);
  });

  it('exposes stable catalogue keys for localisation', () => {
    for (const key of STATUS_KEYS) {
      expect(STATUS_VOCABULARY[key].labelKey).toBe(`status.${key}.label`);
      expect(STATUS_VOCABULARY[key].descriptionKey).toBe(`status.${key}.description`);
      expect(STATUS_VOCABULARY[key].key).toBe(key);
    }
  });

  it('rejects strings that are not part of the closed union', () => {
    expect(isStatusKey('submitted')).toBe(false);
    expect(isStatusKey('Submitted — verified')).toBe(false);
    expect(isStatusKey('submitted_verified')).toBe(true);
    expect(isStatusKey(undefined)).toBe(false);
  });
});
