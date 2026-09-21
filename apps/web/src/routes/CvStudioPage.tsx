import {
  ALL_RESUME_SECTION_KINDS,
  RESUME_PAGE_TARGET,
  type Locale,
  type ResumeDocument,
  type ResumeFinding,
  type ResumeMode,
  type ResumeValidation,
  type ResumeView,
} from '@job-getter/contracts';
import { Badge, Button, Callout, RadioGroup, Select, Spinner } from '@job-getter/ui';
import { useQuery } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../api/ApiProvider';
import { IdempotentIntent } from '../api/idempotency';
import { ErrorNotice } from '../components/ErrorNotice';
import { RESUME_FINDING_LABEL, RESUME_SECTION_LABEL } from '../discovery/labels';
import { useTaskPolling } from '../hooks/useTaskPolling';
import { useTranslation } from '../i18n/I18nProvider';
import { formatDateTime, formatNumber } from '../i18n/format';

/**
 * CV studio (M3, PR07).
 *
 * The screen exists to make a document reviewable, not to celebrate it. Three
 * rules shape it:
 *
 *  * **Generating is not approving.** The approve control is separate, says so,
 *    and the server refuses an approval on anything that is not ready. Nothing
 *    on this screen sends a CV anywhere.
 *  * **Findings are shown before downloads.** A user who scrolls to the buttons
 *    first should have passed what the checks removed on the way.
 *  * **Only the formats that exist are offered.** When the PDF could not be
 *    rendered there is no PDF button, and a sentence says why — rather than a
 *    button that fails when pressed (invariant 10).
 */

const PAGE_TARGETS = [1, 2, 3] as const;

function FindingRow({ finding }: { readonly finding: ResumeFinding }) {
  const { t } = useTranslation();
  return (
    <li
      className="flex flex-col gap-1 border-b border-slate-200 py-2 last:border-b-0"
      data-testid="resume-finding"
      data-code={finding.code}
      data-severity={finding.severity}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span>{t(RESUME_FINDING_LABEL[finding.code])}</span>
        <Badge tone={finding.removed ? 'danger' : 'warning'}>
          {finding.removed ? t('cvStudio.findingRemoved') : t('cvStudio.findingKept')}
        </Badge>
      </div>
      {finding.where === null ? null : (
        <span className="text-xs text-slate-600">{finding.where}</span>
      )}
      {finding.excerpt === null ? null : (
        /* The offending text verbatim, so the user can judge it themselves. */
        <q className="text-sm text-slate-800" data-testid="finding-excerpt">
          {finding.excerpt}
        </q>
      )}
    </li>
  );
}

function DocumentPreview({ document }: { readonly document: ResumeDocument }) {
  const { t } = useTranslation();

  if (document.sections.length === 0) {
    return (
      <p className="text-sm text-slate-700" data-testid="document-empty">
        {t('cvStudio.documentEmpty')}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="document-preview">
      <div>
        <p className="text-lg font-semibold">{document.contact.full_name}</p>
        <p className="text-sm text-slate-700">
          {[document.contact.email, document.contact.phone, document.contact.location]
            .filter((part) => part !== null)
            .join(' · ')}
        </p>
      </div>
      {document.sections.map((section) => (
        <section key={section.kind} data-testid="document-section" data-kind={section.kind}>
          {/* The heading the worker produced, already in the CV's language. */}
          <h3 className="font-semibold">{section.heading}</h3>
          <ul className="flex flex-col gap-2">
            {section.entries.map((entry, index) => (
              <li key={`${section.kind}-${index}`} data-testid="document-entry">
                <div className="flex flex-wrap items-baseline gap-2">
                  {entry.title === null ? null : <span className="font-medium">{entry.title}</span>}
                  {entry.organization === null ? null : (
                    <span className="text-slate-700">{entry.organization}</span>
                  )}
                  {entry.start_month === null && entry.end_month === null ? null : (
                    <span className="text-xs text-slate-600">
                      {[entry.start_month, entry.current ? null : entry.end_month]
                        .filter((part) => part !== null)
                        .join(' – ')}
                    </span>
                  )}
                </div>
                {entry.detail === null ? null : (
                  <p className="text-sm text-slate-700">{entry.detail}</p>
                )}
                {entry.bullets.length === 0 ? null : (
                  <ul className="ml-4 list-disc">
                    {entry.bullets.map((bullet, bulletIndex) => (
                      <li key={bulletIndex} className="text-sm" data-testid="document-bullet">
                        {bullet.text}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function ValidationPanel({ validation }: { readonly validation: ResumeValidation }) {
  const { t, locale } = useTranslation();
  const blocking = validation.findings.filter((finding) => finding.severity === 'blocking');

  return (
    <section className="flex flex-col gap-3" data-testid="validation-panel">
      <h2 className="text-lg font-semibold">{t('cvStudio.reviewHeading')}</h2>
      {/* Never "verified" or "accurate": validation is not proof. */}
      <p className="text-sm text-slate-700" data-testid="review-notice">
        {t('cvStudio.reviewNotice')}
      </p>

      {validation.passed_automatic_checks ? (
        <p data-testid="checks-passed">{t('cvStudio.checksPassed')}</p>
      ) : (
        <Callout tone="warning" title={t('cvStudio.findingsHeading')}>
          <p data-testid="checks-failed">
            {t('cvStudio.checksFailed', { count: formatNumber(locale, blocking.length) })}
          </p>
        </Callout>
      )}

      {validation.findings.length === 0 ? null : (
        <ul className="flex flex-col" data-testid="finding-list">
          {validation.findings.map((finding, index) => (
            <FindingRow key={`${finding.code}-${index}`} finding={finding} />
          ))}
        </ul>
      )}

      <p className="text-xs text-slate-600" data-testid="resume-provenance">
        {t('cvStudio.provenance', {
          template: validation.provenance.template_version,
          source: validation.provenance.deterministic
            ? t('cvStudio.provenanceDeterministic')
            : t('cvStudio.provenanceModel', {
                provider: validation.provenance.provider ?? '',
                model: validation.provenance.model ?? '',
                prompt: validation.provenance.prompt_version ?? '',
              }),
        })}
      </p>
      <p className="text-xs text-slate-600">
        {t('cvStudio.factsCited', { count: formatNumber(locale, validation.fact_ids.length) })}
        {validation.pdf_pages === null
          ? ''
          : ` ${t('cvStudio.pages', { count: formatNumber(locale, validation.pdf_pages) })}`}
      </p>
    </section>
  );
}

export function CvStudioPage() {
  const api = useApi();
  const { t, locale } = useTranslation();

  const [mode, setMode] = useState<ResumeMode>('tailored');
  const [jobId, setJobId] = useState('');
  const [language, setLanguage] = useState<Locale>(locale);
  const [pageTarget, setPageTarget] = useState<number>(RESUME_PAGE_TARGET.default);
  const [inputFileId, setInputFileId] = useState('');
  const [resumeId, setResumeId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [approveError, setApproveError] = useState<unknown>(null);
  const [approving, setApproving] = useState(false);
  const intent = useRef(new IdempotentIntent());

  const jobsQuery = useQuery({
    queryKey: ['jobs', 'cv-studio'],
    queryFn: ({ signal }) => api.listJobs({ query: { limit: 100 }, signal }),
  });

  const resumeQuery = useQuery({
    queryKey: ['resume', resumeId],
    queryFn: ({ signal }) => api.getResume({ params: { id: resumeId as string }, signal }),
    enabled: resumeId !== null,
  });
  const resume: ResumeView | undefined = resumeQuery.data;

  // A queued resume is followed through its task; original mode has none.
  const { task } = useTaskPolling({
    taskId: resume?.status === 'queued' ? (resume.task_id ?? null) : null,
    onTerminal: () => void resumeQuery.refetch(),
  });

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const body = {
      mode,
      ...(jobId === '' ? {} : { job_id: jobId }),
      ...(mode === 'original' && inputFileId !== '' ? { input_file_id: inputFileId } : {}),
      language,
      page_target: pageTarget,
    };
    setSubmitting(true);
    setSubmitError(null);
    try {
      const accepted = await api.createResume({
        body,
        idempotencyKey: intent.current.keyFor(body),
      });
      intent.current.complete();
      setResumeId(accepted.task_id);
    } catch (caught) {
      // The body is untouched, so a retry reuses the same key.
      setSubmitError(caught);
    } finally {
      setSubmitting(false);
    }
  };

  const setApproval = async (approved: boolean) => {
    if (resume === undefined) return;
    setApproving(true);
    setApproveError(null);
    try {
      await api.approveResume({ params: { id: resume.id }, body: { approved } });
      await resumeQuery.refetch();
    } catch (caught) {
      setApproveError(caught);
    } finally {
      setApproving(false);
    }
  };

  const jobs = jobsQuery.data?.items ?? [];
  const pdfMissing =
    resume?.status === 'ready' && resume.mode === 'tailored' && resume.pdf_file_id === null;

  return (
    <div className="flex flex-col gap-6" data-testid="cv-studio">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{t('cvStudio.title')}</h1>
        <p className="max-w-3xl text-sm text-slate-700">{t('cvStudio.intro')}</p>
      </header>

      <form
        className="flex flex-col gap-4 rounded border border-slate-200 bg-white p-4"
        onSubmit={(event) => void onSubmit(event)}
        aria-label={t('cvStudio.modeLegend')}
      >
        <RadioGroup<ResumeMode>
          legend={t('cvStudio.modeLegend')}
          name="resume-mode"
          value={mode}
          onValueChange={setMode}
          options={[
            {
              value: 'tailored',
              label: t('cvStudio.modeTailored'),
              description: t('cvStudio.modeTailoredDescription'),
            },
            {
              value: 'original',
              label: t('cvStudio.modeOriginal'),
              description: t('cvStudio.modeOriginalDescription'),
            },
          ]}
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select
            label={t('cvStudio.job')}
            value={jobId}
            options={[
              { value: '', label: t('cvStudio.jobNone') },
              ...jobs.map((job) => ({
                value: job.id,
                label: `${job.title} — ${job.company}`,
              })),
            ]}
            onChange={(event) => setJobId(event.currentTarget.value)}
          />
          {mode === 'tailored' ? (
            <Select
              label={t('cvStudio.language')}
              value={language}
              options={[
                { value: 'en', label: 'English' },
                { value: 'es', label: 'Español' },
              ]}
              onChange={(event) => setLanguage(event.currentTarget.value as Locale)}
            />
          ) : null}
        </div>

        {mode === 'tailored' ? (
          <Select
            label={t('cvStudio.pageTarget')}
            value={String(pageTarget)}
            options={PAGE_TARGETS.map((count) => ({
              value: String(count),
              label:
                count === 1
                  ? t('cvStudio.pageTargetOptionOne')
                  : t('cvStudio.pageTargetOption', { count: formatNumber(locale, count) }),
            }))}
            onChange={(event) => setPageTarget(Number(event.currentTarget.value))}
          />
        ) : (
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium" htmlFor="input-file-id">
              {t('cvStudio.file')}
            </label>
            <input
              id="input-file-id"
              className="rounded border border-slate-300 px-3 py-2"
              value={inputFileId}
              onChange={(event) => setInputFileId(event.currentTarget.value)}
            />
            <p className="text-xs text-slate-600">
              {t('cvStudio.fileNone')}{' '}
              <Link to="/profile" className="underline underline-offset-2">
                {t('cvStudio.fileUploadLink')}
              </Link>
            </p>
          </div>
        )}

        <div>
          <Button
            type="submit"
            variant="primary"
            busy={submitting}
            busyLabel={t('cvStudio.generating')}
            disabled={mode === 'original' && inputFileId === ''}
          >
            {mode === 'tailored' ? t('cvStudio.generate') : t('cvStudio.useOriginal')}
          </Button>
        </div>
      </form>

      {submitError === null ? null : (
        <ErrorNotice error={submitError} overrideMessage={t('cvStudio.failed')} />
      )}
      {resumeQuery.isError ? (
        <ErrorNotice error={resumeQuery.error} overrideMessage={t('cvStudio.loadFailed')} />
      ) : null}

      {resume?.status === 'queued' ? (
        <p className="flex items-center gap-2 text-sm text-slate-700" data-testid="resume-queued">
          <Spinner label={t('cvStudio.generating')} />
          {t('cvStudio.queued')}
        </p>
      ) : null}

      {resume?.status === 'failed' ? (
        <Callout tone="warning" title={t('cvStudio.failed')}>
          {/* The server's own words, never a rewritten reassurance. */}
          <p data-testid="resume-failed">{resume.error_message ?? task?.error?.message ?? ''}</p>
        </Callout>
      ) : null}

      {resume?.status === 'ready' && resume.validation !== null ? (
        <ValidationPanel validation={resume.validation} />
      ) : null}

      {resume?.status === 'ready' && resume.document !== null ? (
        <section className="flex flex-col gap-3 rounded border border-slate-200 bg-white p-4">
          <h2 className="text-lg font-semibold">{t('cvStudio.documentHeading')}</h2>
          <DocumentPreview document={resume.document} />
        </section>
      ) : null}

      {resume?.status === 'ready' ? (
        <section className="flex flex-col gap-2" data-testid="downloads">
          <h2 className="text-lg font-semibold">{t('cvStudio.downloadsHeading')}</h2>
          <div className="flex flex-wrap gap-2">
            {resume.pdf_file_id === null ? null : (
              <a
                className="rounded border border-slate-300 px-3 py-2 text-sm underline underline-offset-2"
                href={`/api/v1/files/${resume.pdf_file_id}/download`}
                data-testid="download-pdf"
              >
                {t('cvStudio.downloadPdf')}
              </a>
            )}
            {resume.docx_file_id === null ? null : (
              <a
                className="rounded border border-slate-300 px-3 py-2 text-sm underline underline-offset-2"
                href={`/api/v1/files/${resume.docx_file_id}/download`}
                data-testid="download-docx"
              >
                {t('cvStudio.downloadDocx')}
              </a>
            )}
            {resume.input_file_id === null ? null : (
              <a
                className="rounded border border-slate-300 px-3 py-2 text-sm underline underline-offset-2"
                href={`/api/v1/files/${resume.input_file_id}/download`}
                data-testid="download-original"
              >
                {t('cvStudio.downloadOriginal')}
              </a>
            )}
          </div>
          {pdfMissing ? (
            <p className="text-sm text-slate-700" data-testid="pdf-unavailable">
              {t('cvStudio.pdfUnavailable')}
            </p>
          ) : null}
          {resume.mode === 'tailored' ? (
            <p className="text-xs text-slate-600" data-testid="ats-notice">
              {t('cvStudio.atsNotice')}
            </p>
          ) : null}
        </section>
      ) : null}

      {resume?.status === 'ready' ? (
        <section className="flex flex-col gap-2" data-testid="approval">
          <h2 className="text-lg font-semibold">{t('cvStudio.approveHeading')}</h2>
          {/* Generating is not approving, and the screen says so out loud. */}
          <p className="text-sm text-slate-700" data-testid="approve-notice">
            {t('cvStudio.approveNotice')}
          </p>
          {approveError === null ? null : (
            <ErrorNotice error={approveError} overrideMessage={t('cvStudio.approveFailed')} />
          )}
          {resume.approved_at === null ? (
            <div>
              <Button
                variant="primary"
                busy={approving}
                onClick={() => void setApproval(true)}
                data-testid="approve"
              >
                {t('cvStudio.approve')}
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Badge tone="success">
                <span data-testid="approved-at">
                  {t('cvStudio.approved', {
                    date: formatDateTime(locale, resume.approved_at) ?? resume.approved_at,
                  })}
                </span>
              </Badge>
              <Button busy={approving} onClick={() => void setApproval(false)}>
                {t('cvStudio.withdraw')}
              </Button>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}

/** Exported for the label-completeness test. */
export const RESUME_SECTION_KINDS = ALL_RESUME_SECTION_KINDS;
export { RESUME_SECTION_LABEL };
