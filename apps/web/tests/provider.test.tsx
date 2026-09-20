import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { JobGetterApi } from '../src/api/client';
import { createFakeApi, makeProviderView, renderApp } from './helpers';

async function openProvider(client = createFakeApi()) {
  const result = renderApp({ client, route: '/settings/provider' });
  await screen.findByRole('button', { name: 'Save provider settings' });
  return result;
}

describe('provider settings screen', () => {
  it('never prefills the API key and omits it from a save that did not touch it', async () => {
    const user = userEvent.setup();
    const view = makeProviderView({
      provider: 'openai_compatible',
      model: 'gpt-x',
      base_url: 'https://api.example.test/v1',
      api_key_set: true,
      api_key_masked: '••••abcd',
      sends_data_externally: true,
    });
    const putProviderSettings = vi.fn<JobGetterApi['putProviderSettings']>(async () => view);
    await openProvider(
      createFakeApi({ getProviderSettings: async () => view, putProviderSettings }),
    );

    const key = screen.getByLabelText(/^New API key/) as HTMLInputElement;
    expect(key.value).toBe('');
    expect(key.type).toBe('password');
    const status = screen.getByTestId('api-key-status');
    expect(status.dataset.set).toBe('true');
    expect(status.textContent).toBe('Set (ends in ••••abcd)');
    // The mask is the only thing on screen; no full key anywhere.
    expect(document.body.textContent).not.toContain('sk-');

    await user.click(screen.getByRole('button', { name: 'Save provider settings' }));

    expect(putProviderSettings).toHaveBeenCalledTimes(1);
    const body = putProviderSettings.mock.calls[0]?.[0]?.body as Record<string, unknown>;
    expect(body).not.toHaveProperty('api_key');
    expect(body).toMatchObject({
      provider: 'openai_compatible',
      model: 'gpt-x',
      base_url: 'https://api.example.test/v1',
      rate_card: null,
    });
  });

  it('sends a typed key, or null when clearing, and nothing else in between', async () => {
    const user = userEvent.setup();
    const view = makeProviderView({
      provider: 'ollama',
      model: 'llama3',
      base_url: 'http://localhost:11434',
      api_key_set: true,
      api_key_masked: '••••zz99',
    });
    const putProviderSettings = vi.fn<JobGetterApi['putProviderSettings']>(async () => view);
    await openProvider(
      createFakeApi({ getProviderSettings: async () => view, putProviderSettings }),
    );

    await user.type(screen.getByLabelText(/^New API key/), 'secret-value');
    await user.click(screen.getByRole('button', { name: 'Save provider settings' }));
    expect(putProviderSettings.mock.calls[0]?.[0]?.body).toMatchObject({ api_key: 'secret-value' });
    // After saving, the field is empty again: the key is write-only.
    expect((screen.getByLabelText(/^New API key/) as HTMLInputElement).value).toBe('');

    await user.click(screen.getByLabelText('Remove the stored API key'));
    await user.click(screen.getByRole('button', { name: 'Save provider settings' }));
    expect(putProviderSettings.mock.calls[1]?.[0]?.body).toMatchObject({ api_key: null });
  });

  it('shows the external-data notice for an external provider and not for a local one', async () => {
    const external = makeProviderView({
      provider: 'openai_compatible',
      model: 'gpt-x',
      base_url: 'https://api.example.test/v1',
      sends_data_externally: true,
    });
    const { unmount } = await openProvider(
      createFakeApi({ getProviderSettings: async () => external }),
    );
    const notice = screen.getByTestId('external-notice');
    expect(notice.textContent).toContain('sends the text of each task');
    expect(notice.closest('[role="status"], [role="alert"]')).toBeTruthy();
    unmount();

    const local = makeProviderView({
      provider: 'ollama',
      model: 'llama3',
      base_url: 'http://localhost:11434',
      sends_data_externally: false,
    });
    await openProvider(createFakeApi({ getProviderSettings: async () => local }));
    expect(screen.queryByTestId('external-notice')).toBeNull();
    expect(screen.getByText(/Task input stays local/)).toBeTruthy();
  });

  it('renders null probe fields as "not determined", never as a pass', async () => {
    const user = userEvent.setup();
    const testProviderSettings = vi.fn(async () => ({
      reachable: true,
      structured_output_supported: null,
      model_available: null,
      latency_ms: null,
      detail: 'GET /v1/models returned 200; the endpoint publishes no model list.',
    }));
    await openProvider(createFakeApi({ testProviderSettings }));

    await user.click(screen.getByRole('button', { name: 'Test connection' }));

    expect(testProviderSettings).toHaveBeenCalledTimes(1);
    const reachable = await screen.findByTestId('probe-reachable');
    expect(reachable.textContent).toBe('Yes');
    const model = screen.getByTestId('probe-model_available');
    const structured = screen.getByTestId('probe-structured_output_supported');
    expect(model.dataset.value).toBe('null');
    expect(model.textContent).toBe('Not determined');
    expect(structured.dataset.value).toBe('null');
    expect(structured.textContent).toBe('Not determined');
    expect(
      screen.getByText('GET /v1/models returned 200; the endpoint publishes no model list.'),
    ).toBeTruthy();
    // No latency was reported, so none is invented.
    expect(screen.getByText('Not reported')).toBeTruthy();
  });

  it('explains that cost is unknown without a rate card and that a cost budget is unenforceable', async () => {
    const user = userEvent.setup();
    await openProvider();

    expect(screen.getByTestId('cost-unknown-note').textContent).toContain(
      'cost is unknown, not zero',
    );
    expect(screen.queryByTestId('cost-budget-unenforceable')).toBeNull();

    await user.type(screen.getByLabelText(/^Daily cost budget/), '5');
    expect(screen.getByTestId('cost-budget-unenforceable').textContent).toContain(
      'this budget cannot be enforced',
    );

    await user.click(screen.getByLabelText('Provide a rate card'));
    expect(screen.queryByTestId('cost-budget-unenforceable')).toBeNull();
    expect(screen.getByLabelText(/^Input cost per million tokens/)).toBeTruthy();
  });

  it('sends base_url null for providers without an endpoint', async () => {
    const user = userEvent.setup();
    const putProviderSettings = vi.fn<JobGetterApi['putProviderSettings']>(async () =>
      makeProviderView({ provider: 'fake', model: 'fixture' }),
    );
    await openProvider(createFakeApi({ putProviderSettings }));

    await user.selectOptions(screen.getByLabelText(/^Provider/), 'fake');
    expect(screen.queryByLabelText(/^Base URL/)).toBeNull();
    await user.type(screen.getByLabelText(/^Model/), 'fixture');
    await user.click(screen.getByRole('button', { name: 'Save provider settings' }));

    expect(putProviderSettings.mock.calls[0]?.[0]?.body).toMatchObject({
      provider: 'fake',
      model: 'fixture',
      base_url: null,
    });
    expect(await screen.findByText('Provider settings saved.')).toBeTruthy();
  });
});
