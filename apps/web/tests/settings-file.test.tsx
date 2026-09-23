import { ApiError } from '@job-getter/api-client';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JobGetterApi } from '../src/api/client';
import { createFakeApi, makePreferencesView, renderApp } from './helpers';

async function openPreferences(client = createFakeApi()) {
  const result = renderApp({ client, route: '/settings/preferences' });
  await screen.findByRole('button', { name: 'Export settings' });
  return result;
}

function settingsFile(sources: unknown[] = []) {
  return {
    format: 'job-getter-settings',
    format_version: 1,
    exported_at: '2026-09-22T12:00:00.000Z',
    preferences: { ...makePreferencesView().config, target_titles: ['Imported title'] },
    sources,
  };
}

function jsonFile(value: unknown, name = 'settings.json') {
  return new File([typeof value === 'string' ? value : JSON.stringify(value)], name, {
    type: 'application/json',
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('settings file', () => {
  it('downloads the export as a dated JSON file holding exactly what the API returned', async () => {
    const user = userEvent.setup();
    const blobs: Blob[] = [];
    URL.createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob);
      return 'blob:settings';
    });
    URL.revokeObjectURL = vi.fn();
    const downloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloads.push(this.download);
    });
    const client = createFakeApi();
    await openPreferences(client);

    await user.click(screen.getByRole('button', { name: 'Export settings' }));

    expect(client.exportSettings).toHaveBeenCalledTimes(1);
    expect(downloads).toEqual(['job-getter-settings-2026-09-22.json']);
    const written = JSON.parse(await (blobs[0] as Blob).text());
    expect(written).toEqual(await (client.exportSettings as () => Promise<unknown>)());
  });

  it('asks before importing, then sends the file against the revision on screen', async () => {
    const user = userEvent.setup();
    const importSettings = vi.fn<JobGetterApi['importSettings']>(async () => ({
      preferences: makePreferencesView({
        revision: 3,
        config: { ...makePreferencesView().config, target_titles: ['Imported title'] },
      }),
      sources_created: 1,
      sources_already_present: 1,
    }));
    await openPreferences(createFakeApi({ importSettings }));
    const file = settingsFile([
      { connector: 'greenhouse', board_key: 'a', base_url: null, enabled: true },
      { connector: 'greenhouse', board_key: 'b', base_url: null, enabled: true },
    ]);

    await user.upload(
      screen.getByLabelText(/^Import a settings file/),
      jsonFile(file, 'mine.json'),
    );

    expect(await screen.findByText('Import mine.json?')).toBeTruthy();
    expect(screen.getByText(/Boards in the file: 2\./)).toBeTruthy();
    expect(importSettings).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Import' }));

    expect(importSettings).toHaveBeenCalledTimes(1);
    expect(importSettings.mock.calls[0]?.[0]).toEqual({
      body: { expected_revision: 2, settings: file },
    });
    expect(
      await screen.findByText(
        'Imported. Preferences are now at revision 3. Boards added: 1. Already here: 1.',
      ),
    ).toBeTruthy();
    // The form was rebuilt from the imported revision.
    expect(screen.getByText(/^Revision 3/)).toBeTruthy();
    expect(screen.queryByText('Import mine.json?')).toBeNull();
  });

  it('sends nothing when the person cancels', async () => {
    const user = userEvent.setup();
    const client = createFakeApi();
    await openPreferences(client);

    await user.upload(screen.getByLabelText(/^Import a settings file/), jsonFile(settingsFile()));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('button', { name: 'Import' })).toBeNull();
    expect(client.importSettings).not.toHaveBeenCalled();
  });

  it('refuses a file that is not JSON without asking the API', async () => {
    const user = userEvent.setup();
    const client = createFakeApi();
    await openPreferences(client);

    await user.upload(
      screen.getByLabelText(/^Import a settings file/),
      jsonFile('settings_version: 1', 'settings.json'),
    );

    expect(
      await screen.findByText('That file is not JSON, so it cannot be a settings file.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Import' })).toBeNull();
    expect(client.importSettings).not.toHaveBeenCalled();
  });

  it('shows the API’s refusal field by field', async () => {
    const user = userEvent.setup();
    const importSettings = vi.fn(async () => {
      throw new ApiError({
        status: 400,
        code: 'VALIDATION_ERROR',
        message: 'Review highlighted fields',
        fields: { 'settings.preferences.target_tiles': 'Unexpected property' },
        requestId: '99999999-9999-4999-8999-999999999999',
      });
    });
    await openPreferences(createFakeApi({ importSettings }));

    await user.upload(screen.getByLabelText(/^Import a settings file/), jsonFile(settingsFile()));
    await user.click(await screen.findByRole('button', { name: 'Import' }));

    const notice = await screen.findByText('Fields the server rejected');
    const alert = notice.closest('[role="alert"]') as HTMLElement;
    expect(within(alert).getByText('settings.preferences.target_tiles')).toBeTruthy();
    expect(screen.queryByText(/^Imported\./)).toBeNull();
  });
});
