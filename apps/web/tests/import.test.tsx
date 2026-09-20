import { ApiError } from '@job-getter/api-client';
import { MAX_UPLOAD_BYTES } from '@job-getter/contracts';
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { JobGetterApi } from '../src/api/client';
import {
  buildAcceptedFields,
  checkUploadCandidate,
  NO_DECISION,
} from '../src/profile/importReview';
import {
  FACT_ID,
  TASK_ID,
  createFakeApi,
  makeCapabilities,
  makeDraft,
  makeFact,
  makeImportView,
  makeMe,
  makeProfile,
  makeTask,
  renderApp,
  staleRevisionError,
} from './helpers';

const REVIEW_ROUTE = `/profile/import?task=${TASK_ID}`;

function importCapable() {
  return makeMe({ capabilities: makeCapabilities({ profile_import: true }) });
}

function succeededParseTask() {
  return makeTask({ type: 'parse_profile', state: 'succeeded', attempt: 1 });
}

function selectFile(input: HTMLElement, file: File) {
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
}

describe('import review: pure helpers', () => {
  it('rejects oversized and wrong-type files before any upload', () => {
    expect(
      checkUploadCandidate({ name: 'cv.pdf', size: MAX_UPLOAD_BYTES, type: 'application/pdf' }),
    ).toBeNull();
    expect(
      checkUploadCandidate({ name: 'cv.pdf', size: MAX_UPLOAD_BYTES + 1, type: 'application/pdf' }),
    ).toBe('too_large');
    expect(checkUploadCandidate({ name: 'cv.txt', size: 10, type: 'text/plain' })).toBe(
      'wrong_type',
    );
    expect(checkUploadCandidate({ name: 'cv.exe', size: 10, type: '' })).toBe('wrong_type');
    // A browser that reports no type is judged by extension only.
    expect(checkUploadCandidate({ name: 'cv.docx', size: 10, type: '' })).toBeNull();
  });

  it('sends nothing for unaccepted drafts and edited_value only when edited', () => {
    const drafts = [
      makeDraft({ draft_id: 'a' }),
      makeDraft({ draft_id: 'b' }),
      makeDraft({ draft_id: 'c' }),
    ];
    const fields = buildAcceptedFields(
      drafts,
      {
        a: { accepted: true, conflictChoice: null },
        b: { accepted: true, conflictChoice: null, editedValue: { canonical_name: 'X' } },
        c: NO_DECISION,
      },
      new Set(),
    );
    expect(fields).toEqual([
      { draft_id: 'a' },
      { draft_id: 'b', edited_value: { canonical_name: 'X' } },
    ]);
  });

  it('treats a conflicting draft as accepted only through replace or keep-both', () => {
    const drafts = [
      makeDraft({ draft_id: 'a' }),
      makeDraft({ draft_id: 'b' }),
      makeDraft({ draft_id: 'c' }),
    ];
    const conflicting = new Set(['a', 'b', 'c']);
    const fields = buildAcceptedFields(
      drafts,
      {
        // `accepted: true` is ignored for a conflict without an explicit choice.
        a: { accepted: true, conflictChoice: null },
        b: { accepted: false, conflictChoice: `replace:${FACT_ID}` },
        c: { accepted: false, conflictChoice: 'both' },
      },
      conflicting,
    );
    expect(fields).toEqual([{ draft_id: 'b', supersedes_fact_id: FACT_ID }, { draft_id: 'c' }]);
  });
});

describe('import review screen', () => {
  it('starts every draft unaccepted and sends an edited value only after opt-in', async () => {
    const user = userEvent.setup();
    const confirmProfileImport = vi.fn<JobGetterApi['confirmProfileImport']>(async () =>
      makeProfile({ revision: 4 }),
    );
    const api = createFakeApi({
      getMe: async () => importCapable(),
      getTask: async () => succeededParseTask(),
      getProfileImport: async () => makeImportView(),
      confirmProfileImport,
    });
    renderApp({ client: api, route: REVIEW_ROUTE });

    await screen.findByTestId('import-review');
    const draft = screen.getByTestId('draft');
    expect(draft.dataset.accepted).toBe('false');
    expect(screen.getByTestId('accepted-count').textContent).toBe('0 of 1 drafts will be added');
    const accept = within(draft).getByLabelText(
      'Accept this draft into my profile',
    ) as HTMLInputElement;
    expect(accept.checked).toBe(false);
    // Source and proposal side by side, with the locator and excerpt verbatim.
    expect(within(draft).getByText('Skills: Python, SQL')).toBeTruthy();
    expect(within(draft).getByText('page 1')).toBeTruthy();
    expect(within(draft).getByText(/a parsing aid only, never a confirmation/)).toBeTruthy();
    // A draft is a draft, never a confirmed fact.
    expect(within(draft).getByTestId('fact-state').dataset.confirmed).toBe('false');

    await user.click(within(draft).getByRole('button', { name: 'Edit value' }));
    const name = within(draft).getByLabelText(/^Skill name/) as HTMLInputElement;
    await user.clear(name);
    await user.type(name, 'Python 3');
    await user.click(within(draft).getByRole('button', { name: 'Apply edit' }));
    expect(within(draft).getByText('Edited by you')).toBeTruthy();
    expect(within(draft).getByText('Python 3')).toBeTruthy();
    // Editing does not accept: the user still has to opt in.
    expect(draft.dataset.accepted).toBe('false');

    await user.click(accept);
    expect(draft.dataset.accepted).toBe('true');
    expect(screen.getByTestId('accepted-count').textContent).toBe('1 of 1 drafts will be added');

    await user.click(screen.getByRole('button', { name: 'Confirm selection' }));

    expect(confirmProfileImport).toHaveBeenCalledTimes(1);
    const call = confirmProfileImport.mock.calls[0]?.[0];
    if (call === undefined) throw new Error('confirmProfileImport was not called');
    expect(call.params.id).toBe(makeImportView().id);
    expect(call.body.expected_profile_revision).toBe(3);
    expect(call.body.accepted_fields).toEqual([
      {
        draft_id: 'draft-1',
        edited_value: {
          canonical_name: 'Python 3',
          aliases: ['py'],
          user_declared_proficiency: null,
          years: null,
        },
      },
    ]);
    expect(call.body.accepted_fields[0]).not.toHaveProperty('supersedes_fact_id');

    // Confirmation lands on the profile.
    expect(await screen.findByRole('heading', { name: 'Profile', level: 1 })).toBeTruthy();
  });

  it('shows both values for a conflict and sends supersedes_fact_id only for "replace"', async () => {
    const user = userEvent.setup();
    const existing = makeFact({
      id: FACT_ID,
      kind: 'skill',
      confirmed: true,
      value: {
        canonical_name: 'Python',
        aliases: [],
        user_declared_proficiency: 'advanced',
        years: 5,
      },
    });
    const view = makeImportView({
      draft_facts: [
        makeDraft({
          draft_id: 'draft-1',
          value: {
            canonical_name: 'python',
            aliases: ['py3'],
            user_declared_proficiency: null,
            years: null,
          },
        }),
        makeDraft({
          draft_id: 'draft-2',
          kind: 'language',
          value: { code: 'es', declared_level: 'native' },
          source_excerpt: 'Spanish (native)',
        }),
      ],
      conflicts: [
        {
          draft_id: 'draft-1',
          existing_fact_id: FACT_ID,
          reason: 'The skill "Python" is already confirmed.',
        },
      ],
    });
    const confirmProfileImport = vi.fn<JobGetterApi['confirmProfileImport']>(async () =>
      makeProfile({ revision: 4 }),
    );
    const api = createFakeApi({
      getMe: async () => importCapable(),
      getProfile: async () => makeProfile({ facts: [existing] }),
      getTask: async () => succeededParseTask(),
      getProfileImport: async () => view,
      confirmProfileImport,
    });
    renderApp({ client: api, route: REVIEW_ROUTE });

    await screen.findByTestId('import-review');
    const [conflicting, plain] = screen.getAllByTestId('draft') as [HTMLElement, HTMLElement];

    // Both values are visible: the confirmed one and the proposal.
    expect(within(conflicting).getByText('The skill "Python" is already confirmed.')).toBeTruthy();
    expect(within(conflicting).getByText('Python')).toBeTruthy();
    expect(within(conflicting).getByText('python')).toBeTruthy();
    expect(within(conflicting).getByText('Advanced')).toBeTruthy();
    const states = within(conflicting).getAllByTestId('fact-state');
    expect(states.map((node) => node.dataset.confirmed).sort()).toEqual(['false', 'true']);

    // The three explicit choices, none preselected; no plain accept checkbox.
    const group = within(conflicting).getByRole('group', { name: 'What should happen?' });
    const keep = within(group).getByLabelText(/Keep the existing fact/) as HTMLInputElement;
    const replace = within(group).getByLabelText(/Replace the existing fact/) as HTMLInputElement;
    const both = within(group).getByLabelText('Keep both') as HTMLInputElement;
    expect([keep.checked, replace.checked, both.checked]).toEqual([false, false, false]);
    expect(within(conflicting).queryByLabelText('Accept this draft into my profile')).toBeNull();
    expect(conflicting.dataset.accepted).toBe('false');
    expect(screen.getByTestId('accepted-count').textContent).toBe('0 of 2 drafts will be added');

    await user.click(keep);
    expect(conflicting.dataset.accepted).toBe('false');
    await user.click(both);
    expect(conflicting.dataset.accepted).toBe('true');
    await user.click(replace);
    expect(conflicting.dataset.accepted).toBe('true');
    expect(screen.getByTestId('accepted-count').textContent).toBe('1 of 2 drafts will be added');

    // The second draft is left unaccepted on purpose.
    expect(plain.dataset.accepted).toBe('false');

    await user.click(screen.getByRole('button', { name: 'Confirm selection' }));

    expect(confirmProfileImport).toHaveBeenCalledTimes(1);
    expect(confirmProfileImport.mock.calls[0]?.[0]).toMatchObject({
      body: {
        expected_profile_revision: 3,
        accepted_fields: [{ draft_id: 'draft-1', supersedes_fact_id: FACT_ID }],
      },
    });
    expect(confirmProfileImport.mock.calls[0]?.[0]?.body.accepted_fields).toHaveLength(1);
  });

  it('asks before confirming with nothing accepted, and keeps decisions on a 409', async () => {
    const user = userEvent.setup();
    const confirmProfileImport = vi.fn().mockRejectedValueOnce(staleRevisionError());
    const api = createFakeApi({
      getMe: async () => importCapable(),
      getTask: async () => succeededParseTask(),
      confirmProfileImport,
    });
    renderApp({ client: api, route: REVIEW_ROUTE });

    await screen.findByTestId('import-review');
    await user.click(screen.getByRole('button', { name: 'Confirm selection' }));
    // Nothing was sent yet: the dialog says every draft would be discarded.
    expect(confirmProfileImport).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'Confirm with nothing accepted?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(confirmProfileImport).not.toHaveBeenCalled();

    await user.click(screen.getByLabelText('Accept this draft into my profile'));
    await user.click(screen.getByRole('button', { name: 'Confirm selection' }));

    expect(confirmProfileImport).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('STALE_REVISION')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Reload the profile/ })).toBeTruthy();
    // The decision survived the failure.
    expect(
      (screen.getByLabelText('Accept this draft into my profile') as HTMLInputElement).checked,
    ).toBe(true);
    expect(screen.getByTestId('draft').dataset.accepted).toBe('true');
  });

  it('lists extraction warnings with their code and human copy', async () => {
    const api = createFakeApi({
      getMe: async () => importCapable(),
      getTask: async () => succeededParseTask(),
      getProfileImport: async () =>
        makeImportView({
          draft_facts: [],
          warnings: [
            {
              code: 'NO_PROVIDER_CONFIGURED',
              message: 'No AI provider configured; drafts not inferred.',
            },
            {
              code: 'PROMPT_INJECTION_TEXT_IGNORED',
              message: 'Removed 1 instruction-like line.',
              detail: 'line 12',
            },
          ],
        }),
    });
    renderApp({ client: api, route: REVIEW_ROUTE });

    await screen.findByTestId('import-review');
    const warnings = screen.getAllByTestId('import-warning');
    expect(warnings.map((node) => node.dataset.code)).toEqual([
      'NO_PROVIDER_CONFIGURED',
      'PROMPT_INJECTION_TEXT_IGNORED',
    ]);
    expect(warnings[0]?.textContent).toContain('NO_PROVIDER_CONFIGURED');
    expect(warnings[0]?.textContent).toContain(
      'No AI provider is configured, so no draft facts were inferred',
    );
    expect(warnings[0]?.textContent).toContain('No AI provider configured; drafts not inferred.');
    expect(warnings[1]?.textContent).toContain('treated as data only');
    expect(warnings[1]?.textContent).toContain('line 12');
    expect(screen.getByText('No drafts were extracted')).toBeTruthy();
  });

  it('shows the real failure code of a failed extraction and no review', async () => {
    const api = createFakeApi({
      getMe: async () => importCapable(),
      getTask: async () =>
        makeTask({
          type: 'parse_profile',
          state: 'failed',
          attempt: 1,
          error: {
            code: 'ENCRYPTED_DOCUMENT',
            message: 'The PDF is encrypted and cannot be read.',
            retryable: false,
          },
        }),
    });
    renderApp({ client: api, route: REVIEW_ROUTE });

    expect(await screen.findByText('Extraction failed')).toBeTruthy();
    expect(screen.getByTestId('failure-code').textContent).toBe('ENCRYPTED_DOCUMENT');
    expect(screen.getByTestId('failure-message').textContent).toContain(
      'The PDF is encrypted and cannot be read.',
    );
    expect(screen.getByText('The server considers this failure final.')).toBeTruthy();
    expect(screen.queryByTestId('import-review')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Confirm selection' })).toBeNull();
    expect(api.getProfileImport).not.toHaveBeenCalled();
  });

  it('says plainly that a queued import will not run while no worker is online', async () => {
    const api = createFakeApi({
      getMe: async () =>
        makeMe({ capabilities: makeCapabilities({ profile_import: true, worker_online: false }) }),
      getTask: async () => makeTask({ type: 'parse_profile', state: 'queued' }),
    });
    const { container } = renderApp({ client: api, route: REVIEW_ROUTE });

    const explanation = await screen.findByTestId('queued-no-worker');
    expect(explanation.textContent).toContain('no worker online');
    expect(explanation.textContent).toContain('it is not running at all');
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(0);
    expect(screen.queryByTestId('import-review')).toBeNull();
  });

  it('queues pasted text with one idempotency key reused on retry', async () => {
    const user = userEvent.setup();
    const createProfileImport = vi
      .fn()
      .mockRejectedValueOnce(new ApiError({ status: 503, code: 'INTERNAL_ERROR', message: 'Down' }))
      .mockResolvedValue({ task_id: TASK_ID, status: 'queued' as const });
    const api = createFakeApi({
      getMe: async () => importCapable(),
      createProfileImport,
      getTask: async () => makeTask({ type: 'parse_profile', state: 'queued' }),
    });
    renderApp({ client: api, route: '/profile/import' });

    await user.click(await screen.findByLabelText('Paste text'));
    await user.type(screen.getByLabelText(/^Pasted text/), 'Jane Doe\nEngineer at Acme');
    await user.selectOptions(screen.getByLabelText(/^Format hint/), 'linkedin_export_text');
    await user.click(screen.getByRole('button', { name: 'Queue extraction' }));

    expect(await screen.findByText('That did not work')).toBeTruthy();
    expect((screen.getByLabelText(/^Pasted text/) as HTMLTextAreaElement).value).toBe(
      'Jane Doe\nEngineer at Acme',
    );

    await user.click(screen.getByRole('button', { name: 'Queue extraction' }));
    expect(createProfileImport).toHaveBeenCalledTimes(2);
    const [first, second] = createProfileImport.mock.calls.map((call) => call[0]);
    expect(first.body).toEqual({
      pasted_text: 'Jane Doe\nEngineer at Acme',
      format_hint: 'linkedin_export_text',
    });
    expect(first.body).not.toHaveProperty('file_id');
    expect(typeof first.idempotencyKey).toBe('string');
    expect(second.idempotencyKey).toBe(first.idempotencyKey);

    expect(await screen.findByText(`Extraction task ${TASK_ID}`)).toBeTruthy();
    expect(api.uploadFile).not.toHaveBeenCalled();
  });

  it('rejects oversized and wrong-type files in the browser before any upload call', async () => {
    const api = createFakeApi({ getMe: async () => importCapable() });
    renderApp({ client: api, route: '/profile/import' });

    const input = await screen.findByLabelText(/^Document/);

    const tooLarge = new File([new Uint8Array(8)], 'cv.pdf', { type: 'application/pdf' });
    Object.defineProperty(tooLarge, 'size', { value: MAX_UPLOAD_BYTES + 1 });
    selectFile(input, tooLarge);
    expect(screen.getByRole('alert').textContent).toBe(
      'That file is larger than 10 MiB and was not uploaded.',
    );
    expect(
      (screen.getByRole('button', { name: 'Upload document' }) as HTMLButtonElement).disabled,
    ).toBe(true);

    const wrongType = new File(['hello'], 'cv.txt', { type: 'text/plain' });
    selectFile(input, wrongType);
    expect(screen.getByRole('alert').textContent).toBe(
      'Only PDF and DOCX files are accepted. That file was not uploaded.',
    );
    expect(
      (screen.getByRole('button', { name: 'Upload document' }) as HTMLButtonElement).disabled,
    ).toBe(true);

    expect(api.uploadFile).not.toHaveBeenCalled();
    expect(api.createProfileImport).not.toHaveBeenCalled();
  });

  it('uploads an accepted file and shows the validation block honestly', async () => {
    const user = userEvent.setup();
    const api = createFakeApi({ getMe: async () => importCapable() });
    renderApp({ client: api, route: '/profile/import' });

    const input = await screen.findByLabelText(/^Document/);
    selectFile(input, new File(['%PDF-1.7'], 'cv.pdf', { type: 'application/pdf' }));
    expect(screen.queryByRole('alert')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Upload document' }));

    expect(api.uploadFile).toHaveBeenCalledTimes(1);
    const body = (api.uploadFile as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]?.body as FormData;
    expect(body.get('purpose')).toBe('cv_original');
    expect((body.get('file') as File).name).toBe('cv.pdf');

    // "skipped" is shown as skipped, never as clean.
    const scan = await screen.findByTestId('malware-scan');
    expect(scan.dataset.value).toBe('skipped_not_configured');
    expect(scan.textContent).toContain('Not scanned');
    expect(scan.textContent).not.toMatch(/^Scanned: clean/);
    expect(screen.getByTestId('validation-signature').textContent).toBe('Yes');

    await user.click(screen.getByRole('button', { name: 'Queue extraction' }));
    expect(api.createProfileImport).toHaveBeenCalledTimes(1);
    expect((api.createProfileImport as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]?.body).toEqual({
      file_id: '77777777-7777-4777-8777-777777777777',
      format_hint: 'auto',
    });
  });

  it('disables queueing when the API reports profile import is unavailable', async () => {
    renderApp({ route: '/profile/import' });

    expect(
      await screen.findByText('Profile import is not available on this installation'),
    ).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Queue extraction' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
