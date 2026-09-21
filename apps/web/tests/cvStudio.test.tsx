/**
 * The CV studio (M3, PR07).
 *
 * The screen's job is to make a generated document reviewable before anyone
 * sends it under their own name, so the assertions are about what it refuses
 * to imply:
 *
 *  * generating a CV never approves it, and the screen says so;
 *  * validation is described as a set of checks, never as proof of accuracy;
 *  * a removed claim is shown with the text that was removed;
 *  * only the formats that actually exist are offered for download.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { JobGetterApi } from '../src/api/client';
import { RESUME_ID, createFakeApi, makeResume, renderApp } from './helpers';

async function openStudio(api: JobGetterApi) {
  renderApp({ client: api, route: '/cv-studio' });
  await screen.findByRole('heading', { name: 'CV studio', level: 1 });
}

/**
 * Open the studio and generate, which is the only way to reach a resume: the
 * contract has no list route, so the screen cannot show an earlier CV until
 * one is asked for in this session.
 */
async function generate(api: JobGetterApi) {
  const user = userEvent.setup();
  await openStudio(api);
  await user.click(screen.getByRole('button', { name: 'Generate' }));
  return user;
}

describe('generating a CV', () => {
  it('asks for a tailored CV by default and queues one', async () => {
    const user = userEvent.setup();
    const createResume = vi.fn<JobGetterApi['createResume']>(async () => ({
      task_id: RESUME_ID,
      status: 'queued' as const,
    }));
    await openStudio(createFakeApi({ createResume }));

    await user.click(screen.getByRole('button', { name: 'Generate' }));
    await waitFor(() => expect(createResume).toHaveBeenCalledTimes(1));

    const call = createResume.mock.lastCall?.[0];
    expect(call?.body).toMatchObject({ mode: 'tailored' });
    expect(call?.idempotencyKey).toBeTruthy();
    // No file is sent in tailored mode; the server rejects one outright.
    expect(call?.body).not.toHaveProperty('input_file_id');
  });

  it('offers the original-file mode as a distinct choice', async () => {
    const user = userEvent.setup();
    await openStudio(createFakeApi());

    await user.click(screen.getByRole('radio', { name: /Send the file I uploaded/ }));

    expect(screen.getByText(/sent byte for byte/)).toBeTruthy();
    expect(screen.getByText(/never converted, re-rendered or tailored/)).toBeTruthy();
    // Nothing can be sent until a file is named.
    expect(screen.getByRole('button', { name: 'Use this file' }).hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('says a queued CV runs locally unless a provider is configured', async () => {
    await generate(
      createFakeApi({
        getResume: async () => makeResume({ status: 'queued', document: null, validation: null }),
      }),
    );

    const queued = await screen.findByTestId('resume-queued');
    expect(queued.textContent).toContain('runs locally unless you configured a provider');
  });

  it('shows the server error when generation fails', async () => {
    await generate(
      createFakeApi({
        getResume: async () =>
          makeResume({
            status: 'failed',
            document: null,
            validation: null,
            error_code: 'PROVIDER_UNAVAILABLE',
            error_message: 'The provider did not answer.',
          }),
      }),
    );

    const failed = await screen.findByTestId('resume-failed');
    expect(failed.textContent).toBe('The provider did not answer.');
  });
});

describe('the review panel', () => {
  it('describes the checks without claiming the CV is accurate', async () => {
    await generate(createFakeApi());

    const notice = (await screen.findByTestId('review-notice')).textContent ?? '';
    expect(notice).toContain('cannot judge whether a sentence oversells');
    expect(notice).toContain('reading this yourself is not optional');
    // The words that would turn a check into a guarantee.
    expect(notice).not.toMatch(/\bverified\b/i);
    expect(notice).not.toMatch(/\bguarantee/i);
    expect(notice).not.toMatch(/\bproof\b/i);
  });

  it('shows a removed claim with the text that was removed', async () => {
    await generate(
      createFakeApi({
        getResume: async () =>
          makeResume({
            validation: {
              ...makeResume().validation!,
              passed_automatic_checks: false,
              findings: [
                {
                  code: 'NUMBER_NOT_IN_FACTS',
                  severity: 'blocking',
                  where: 'experience[0].bullets[0]',
                  excerpt: 'Cut ingestion latency by 40%',
                  removed: true,
                },
              ],
            },
          }),
      }),
    );

    const finding = await screen.findByTestId('resume-finding');
    expect(finding.dataset.code).toBe('NUMBER_NOT_IN_FACTS');
    expect(within(finding).getByText('Removed from the CV')).toBeTruthy();
    expect(within(finding).getByTestId('finding-excerpt').textContent).toContain('40%');
    expect(finding.textContent).toContain('none of the cited facts contain');
  });

  it('says nothing was flagged when the checks found nothing', async () => {
    await generate(createFakeApi());

    expect((await screen.findByTestId('checks-passed')).textContent).toBe(
      'Automatic checks found nothing to flag.',
    );
    expect(screen.queryByTestId('resume-finding')).toBeNull();
  });

  it('records that the document was assembled without a model', async () => {
    await generate(createFakeApi());

    const provenance = (await screen.findByTestId('resume-provenance')).textContent ?? '';
    expect(provenance).toContain('simple/v1');
    expect(provenance).toContain('with no model involved');
  });

  it('names the provider and prompt when a model was involved', async () => {
    await generate(
      createFakeApi({
        getResume: async () =>
          makeResume({
            validation: {
              ...makeResume().validation!,
              provenance: {
                template_version: 'simple/v1',
                prompt_version: 'render_cv/v1',
                provider: 'ollama',
                model: 'llama3',
                deterministic: false,
              },
            },
          }),
      }),
    );

    const provenance = (await screen.findByTestId('resume-provenance')).textContent ?? '';
    expect(provenance).toContain('ollama');
    expect(provenance).toContain('llama3');
    expect(provenance).toContain('render_cv/v1');
  });
});

describe('the document preview', () => {
  it('renders the document the user would send', async () => {
    await generate(createFakeApi());

    const preview = await screen.findByTestId('document-preview');
    expect(preview.textContent).toContain('Ada Lovelace');
    expect(preview.textContent).toContain('Senior Backend Engineer');
    expect(preview.textContent).toContain('Orbital Foods');
    expect(within(preview).getByTestId('document-bullet').textContent).toBe(
      'Ran the ingestion pipeline',
    );
  });

  it('says a document with no sections is empty rather than showing nothing', async () => {
    await generate(
      createFakeApi({
        getResume: async () =>
          makeResume({
            document: { ...makeResume().document!, sections: [] },
          }),
      }),
    );

    expect((await screen.findByTestId('document-empty')).textContent).toContain(
      'Confirm some profile facts',
    );
  });
});

describe('downloads', () => {
  it('offers both formats when both exist', async () => {
    await generate(createFakeApi());

    await screen.findByTestId('downloads');
    expect(screen.getByTestId('download-pdf')).toBeTruthy();
    expect(screen.getByTestId('download-docx')).toBeTruthy();
    expect(screen.queryByTestId('pdf-unavailable')).toBeNull();
  });

  it('omits the PDF button and says why when it could not be rendered', async () => {
    await generate(createFakeApi({ getResume: async () => makeResume({ pdf_file_id: null }) }));

    await screen.findByTestId('downloads');
    // Absent, not broken.
    expect(screen.queryByTestId('download-pdf')).toBeNull();
    expect(screen.getByTestId('download-docx')).toBeTruthy();
    expect(screen.getByTestId('pdf-unavailable').textContent).toContain(
      'absent rather than broken',
    );
  });

  it('does not promise the CV parses in any employer system', async () => {
    await generate(createFakeApi());

    const notice = (await screen.findByTestId('ats-notice')).textContent ?? '';
    expect(notice).toContain('cannot guarantee');
    expect(notice).not.toMatch(/ATS[- ]compatible/i);
  });

  it('offers the user their own file back in original mode', async () => {
    await generate(
      createFakeApi({
        getResume: async () =>
          makeResume({
            mode: 'original',
            document: null,
            validation: null,
            pdf_file_id: null,
            docx_file_id: null,
            input_file_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
          }),
      }),
    );

    await screen.findByTestId('downloads');
    expect(screen.getByTestId('download-original')).toBeTruthy();
    expect(screen.queryByTestId('download-pdf')).toBeNull();
    // Nothing was generated, so there is nothing to review.
    expect(screen.queryByTestId('validation-panel')).toBeNull();
  });
});

describe('approval', () => {
  it('says out loud that generating is not approving', async () => {
    await generate(createFakeApi());

    const notice = (await screen.findByTestId('approve-notice')).textContent ?? '';
    expect(notice).toContain('Nothing is approved by generating it');
    expect(screen.getByRole('button', { name: /I have read this and approve it/ })).toBeTruthy();
  });

  it('records an explicit approval', async () => {
    const user = userEvent.setup();
    const approveResume = vi.fn<JobGetterApi['approveResume']>(async () =>
      makeResume({ approved_at: '2026-09-21T12:00:00.000Z' }),
    );
    await generate(createFakeApi({ approveResume }));

    await user.click(
      await screen.findByRole('button', { name: /I have read this and approve it/ }),
    );
    await waitFor(() => expect(approveResume).toHaveBeenCalledTimes(1));

    expect(approveResume.mock.lastCall?.[0]?.body).toEqual({ approved: true });
  });

  it('shows an existing approval with its date, and offers to withdraw it', async () => {
    await generate(
      createFakeApi({
        getResume: async () => makeResume({ approved_at: '2026-09-21T12:00:00.000Z' }),
      }),
    );

    expect((await screen.findByTestId('approved-at')).textContent).toContain('Approved on');
    expect(screen.getByRole('button', { name: 'Withdraw approval' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /I have read this and approve it/ })).toBeNull();
  });
});
