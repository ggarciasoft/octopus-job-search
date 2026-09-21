import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NAV_ITEMS, PLACEHOLDER_SCREENS } from '../src/navigation';
import { renderApp } from './helpers';

describe('screens for milestones that do not exist yet', () => {
  it('has no unavailable navigation entry left, and says so explicitly', () => {
    // Profile and Settings became real in M1, Discover and Jobs in M2, CV
    // studio in M3, Applications and Tracker in M4. The list is empty, and
    // asserting that is the point: the moment a screen is added to the
    // navigation before it works, this fails. The per-screen cases below still
    // run for whatever the next milestone adds.
    expect(PLACEHOLDER_SCREENS.map((screenDef) => screenDef.path)).toEqual([]);
    expect(NAV_ITEMS.filter((item) => !item.available)).toEqual([]);
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
