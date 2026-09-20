import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PLACEHOLDER_SCREENS } from '../src/navigation';
import { renderApp } from './helpers';

describe('screens for milestones that do not exist yet', () => {
  it('registers every unavailable navigation entry as an explanation', () => {
    // Profile and Settings became real screens in M1; the rest still wait.
    expect(PLACEHOLDER_SCREENS.map((screenDef) => screenDef.path)).toEqual([
      '/discover',
      '/jobs',
      '/cv-studio',
      '/applications',
      '/tracker',
    ]);
  });

  for (const placeholder of PLACEHOLDER_SCREENS) {
    it(`explains ${placeholder.path} and renders no form that could submit`, async () => {
      const { container } = renderApp({ route: placeholder.path });

      await screen.findByText('Not implemented');
      expect(screen.getByText(`Delivered in milestone ${placeholder.milestone}.`)).toBeTruthy();
      expect(
        screen.getByText(/No example jobs, matches or applications are shown here/),
      ).toBeTruthy();

      // Nothing here can pretend to do work: no form, no input, no submit.
      expect(container.querySelectorAll('form')).toHaveLength(0);
      expect(container.querySelectorAll('input')).toHaveLength(0);
      expect(container.querySelectorAll('textarea')).toHaveLength(0);
      expect(screen.queryByRole('button', { name: /save|create|run|generate|apply/i })).toBeNull();

      // It does point at the one record of what is built.
      expect(
        screen.getByRole('link', { name: /Implementation status/ }).getAttribute('href'),
      ).toContain('IMPLEMENTATION_STATUS.md');
    });
  }

  it('does not invent rows for a task list that is empty', async () => {
    const { container } = renderApp({ route: '/tasks' });

    await screen.findByText('No tasks have run yet');
    expect(screen.getByText(/This is an empty list, not a failed query/)).toBeTruthy();
    // Suggestions, never fabricated examples.
    expect(screen.getByText(/Run the M0 diagnostics probe/)).toBeTruthy();
    expect(screen.getByText(/Check that the worker is online/)).toBeTruthy();
    expect(container.querySelectorAll('table')).toHaveLength(0);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(0);
  });
});
