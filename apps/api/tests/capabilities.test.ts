/**
 * `GET /me` must not under-report what this build can do.
 *
 * This file exists because of a real defect. `CREATING_OPERATION` is a
 * `Partial<Record<TaskType, string>>`, so implementing a task type without
 * adding it there compiles cleanly and silently drops the capability. That is
 * exactly what happened to `match_job`: the route was registered, the worker
 * claimed the task and scored the job, and `GET /me` still advertised only the
 * four M2 task types. It was caught by a live run, not by the suite.
 *
 * The rule the suite now enforces is the one the omission broke: every
 * implemented task type is either reachable through a registered route or
 * explicitly declared internal-only. Nothing may be neither.
 */
import { describe, expect, it } from 'vitest';
import { IMPLEMENTED_TASK_TYPES } from '@job-getter/contracts';
import { enqueueableTaskTypes, unclassifiedTaskTypes } from '../src/routes/capabilities.js';
import { DEFERRED_OPERATIONS } from '../src/routes/index.js';

describe('advertised task types', () => {
  it('classifies every implemented task type', () => {
    // The failure message names what was forgotten, so the next person does
    // not have to read this file to find out what to do.
    expect(unclassifiedTaskTypes()).toEqual([]);
  });

  it('advertises every implemented task type whose route is registered', () => {
    const advertised = enqueueableTaskTypes();
    for (const type of IMPLEMENTED_TASK_TYPES) {
      if (unclassifiedTaskTypes().includes(type)) continue;
      // A type is absent only if its creating route is still deferred.
      if (!advertised.includes(type)) {
        expect(
          Object.keys(DEFERRED_OPERATIONS).length,
          `${type} is implemented but unreachable`,
        ).toBeGreaterThan(0);
      }
    }
    expect(advertised).toContain('match_job');
  });

  it('never advertises a task type the contract does not call implemented', () => {
    for (const type of enqueueableTaskTypes()) {
      expect(IMPLEMENTED_TASK_TYPES).toContain(type);
    }
  });

  it('never advertises a type whose creating route is deferred', () => {
    for (const type of enqueueableTaskTypes()) {
      expect(Object.keys(DEFERRED_OPERATIONS)).not.toContain(type);
    }
  });
});
