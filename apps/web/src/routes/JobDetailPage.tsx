import type { JobDetailView, JobRequirement, JobView } from '@job-getter/contracts';
import { Badge, Button, Callout, Dialog, Disclosure, Spinner, TextField } from '@job-getter/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApi } from '../api/ApiProvider';
import { describeFailure } from '../api/errors';
import { ExternalLink, JobStatusBadge } from '../components/DiscoveryBadges';
import { ErrorNotice } from '../components/ErrorNotice';
import { FreshnessCell, SalaryCell, locationText } from '../discovery/JobCells';
import {
  CONNECTOR_LABEL,
  DUPLICATE_REASON_LABEL,
  INFERRED_FIELD_LABEL,
  JOB_EMPLOYMENT_TYPE_LABEL,
  REMOTE_TYPE_LABEL,
  REQUIREMENT_KIND_LABEL,
  REQUIREMENT_KIND_ORDER,
} from '../discovery/labels';
import { FitPanel, MatchCell } from '../discovery/MatchViews';
import { IdempotentIntent } from '../api/idempotency';
import { useTaskPolling } from '../hooks/useTaskPolling';
import { useTranslation } from '../i18n/I18nProvider';
import { formatDateTime } from '../i18n/format';

const LINK_CLASS =
  'text-sm font-medium text-sky-800 underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600';

export const jobQueryKey = (id: string) => ['job', id] as const;

/**
 * Job detail. Everything the connector read is shown with where it read it
 * from; everything it inferred is listed separately with its excerpt; and the
 * description is plain text, never markup (invariant 9: job pages are
 * untrusted data). "Prepare application" is M4 and is stated as absent — no
 * button exists that could look like it prepares one (invariant 10).
 */
export function JobDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const api = useApi();
  const { t, locale } = useTranslation();
  const queryClient = useQueryClient();

  const jobQuery = useQuery({
    queryKey: jobQueryKey(id),
    queryFn: ({ signal }) => api.getJob({ params: { id }, signal }),
    enabled: id !== '',
  });
  const job = jobQuery.data;

  const [pending, setPending] = useState<'save' | 'close' | 'correct' | null>(null);
  // The correction form, open only when asked for: a posting's own words are
  // the default, and an always-editable heading invites edits nobody wanted.
  const [correcting, setCorrecting] = useState<{ title: string; company: string } | null>(null);
  const [patchError, setPatchError] = useState<unknown>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const nowMs = Date.now();

  // Scoring is a task, so it is queued and followed like any other. The intent
  // keeps one idempotency key per attempt, so a retry after a network error
  // re-sends the same request rather than queueing a second score.
  const matchIntent = useRef(new IdempotentIntent());
  const [matchTaskId, setMatchTaskId] = useState<string | null>(null);
  const [matchQueueError, setMatchQueueError] = useState<unknown>(null);
  const [queueingMatch, setQueueingMatch] = useState(false);

  const { task: matchTask, error: matchPollError } = useTaskPolling({
    taskId: matchTaskId,
    onTerminal: () => {
      // The score lives on the job, not on the task result, so the job is what
      // gets refetched.
      void jobQuery.refetch();
      setMatchTaskId(null);
    },
  });

  const checkFit = async () => {
    const key = matchIntent.current.keyFor({ job: id, revision: job?.revision ?? null });
    setQueueingMatch(true);
    setMatchQueueError(null);
    try {
      const accepted = await api.matchJob({ params: { id }, idempotencyKey: key });
      matchIntent.current.complete();
      setMatchTaskId(accepted.task_id);
    } catch (caught) {
      setMatchQueueError(caught);
    } finally {
      setQueueingMatch(false);
    }
  };

  /** `PATCH /jobs/:id` answers a `JobView`; the detail-only fields are kept. */
  const applyPatched = (current: JobDetailView, patched: JobView) => {
    queryClient.setQueryData<JobDetailView>(jobQueryKey(id), { ...current, ...patched });
  };

  const toggleSaved = async (current: JobDetailView) => {
    setPending('save');
    setPatchError(null);
    try {
      const patched = await api.patchJob({
        params: { id: current.id },
        body: { expected_revision: current.revision, saved: !current.saved },
      });
      applyPatched(current, patched);
    } catch (caught) {
      setPatchError(caught);
    } finally {
      setPending(null);
    }
  };

  const saveCorrection = async (current: JobDetailView) => {
    if (correcting === null) return;
    setPending('correct');
    setPatchError(null);
    try {
      const patched = await api.patchJob({
        params: { id: current.id },
        body: {
          expected_revision: current.revision,
          title: correcting.title.trim(),
          company: correcting.company.trim(),
        },
      });
      applyPatched(current, patched);
      setCorrecting(null);
    } catch (caught) {
      // The form stays open with what was typed still in it.
      setPatchError(caught);
    } finally {
      setPending(null);
    }
  };

  const markClosed = async (current: JobDetailView) => {
    setPending('close');
    setPatchError(null);
    try {
      const patched = await api.patchJob({
        params: { id: current.id },
        body: { expected_revision: current.revision, status: 'closed' },
      });
      applyPatched(current, patched);
      setConfirmClose(false);
    } catch (caught) {
      // The dialog stays open with the error: the user decides what to do next.
      setPatchError(caught);
    } finally {
      setPending(null);
    }
  };

  if (jobQuery.isPending) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-700">
        <Spinner label={t('jobDetail.loading')} />
        <span>{t('jobDetail.loading')}</span>
      </div>
    );
  }

  if (job === undefined) {
    return (
      <div className="flex flex-col gap-3">
        <ErrorNotice error={jobQuery.error} overrideMessage={t('jobDetail.loadFailed')} />
        <div className="flex gap-2">
          <Button onClick={() => void jobQuery.refetch()}>{t('action.retry')}</Button>
          <Link to="/jobs" className={LINK_CLASS}>
            {t('jobDetail.back')}
          </Link>
        </div>
      </div>
    );
  }

  const stale = patchError !== null && describeFailure(patchError).isStale;
  const requirementsByKind = groupRequirements(job.requirements);

  return (
    <div className="flex flex-col gap-6" data-testid="job-detail" data-revision={job.revision}>
      <p>
        <Link to="/jobs" className={LINK_CLASS}>
          {t('jobDetail.back')}
        </Link>
      </p>

      <header className="flex flex-col gap-2">
        {/* Title and company are the posting's own words: verbatim, unless the
            user corrected them, which the badge below says outright. */}
        <h1 className="text-2xl font-semibold text-slate-900">{job.title}</h1>
        <p className="text-base text-slate-800">{job.company}</p>
        {job.edited_fields.length === 0 ? null : (
          <p className="text-xs text-slate-600" data-testid="job-corrected">
            {t('jobDetail.correctedNote')}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <JobStatusBadge status={job.status} />
          {job.saved ? <Badge tone="info">{t('jobs.savedBadge')}</Badge> : null}
          {job.excluded_reason === null ? null : (
            <Badge tone="attention">{t('jobs.excluded', { reason: job.excluded_reason })}</Badge>
          )}
          <MatchCell match={job.match} />
          <span className="text-xs text-slate-600">
            {t('jobDetail.revision', { revision: job.revision })}
          </span>
        </div>
      </header>

      {patchError === null ? null : (
        <div className="flex flex-col gap-2">
          <ErrorNotice error={patchError} />
          {stale ? (
            <div>
              <Button
                onClick={() => {
                  // Reload the server copy; the open dialog (if any) stays open.
                  void jobQuery.refetch();
                }}
              >
                {t('jobDetail.reload')}
              </Button>
            </div>
          ) : null}
        </div>
      )}

      <section className="flex flex-wrap items-center gap-2">
        <Button
          busy={pending === 'save'}
          busyLabel={t('jobs.saving')}
          disabled={pending !== null}
          onClick={() => void toggleSaved(job)}
        >
          {job.saved ? t('jobs.unsave') : t('jobs.save')}
        </Button>
        {job.status === 'closed' ? null : (
          <Button disabled={pending !== null} onClick={() => setConfirmClose(true)}>
            {t('jobDetail.markClosed')}
          </Button>
        )}
        {correcting === null ? (
          <Button
            disabled={pending !== null}
            onClick={() => setCorrecting({ title: job.title, company: job.company })}
          >
            {t('jobDetail.correct')}
          </Button>
        ) : null}
        <Button
          busy={queueingMatch || matchTaskId !== null}
          busyLabel={t('jobDetail.checkingFit')}
          disabled={pending !== null}
          onClick={() => void checkFit()}
        >
          {job.match === null ? t('jobDetail.checkFit') : t('jobDetail.recheckFit')}
        </Button>
        <p className="basis-full text-sm text-slate-700" data-testid="prepare-unavailable">
          {t('jobDetail.prepareUnavailable')}
        </p>
      </section>

      {matchQueueError === null ? null : (
        <ErrorNotice error={matchQueueError} overrideMessage={t('jobDetail.fitFailed')} />
      )}
      {matchPollError === null ? null : (
        <ErrorNotice error={matchPollError} overrideMessage={t('jobDetail.fitFailed')} />
      )}
      {matchTask !== null && matchTask.state === 'failed' ? (
        <Callout tone="warning" title={t('jobDetail.fitFailed')}>
          {/* The worker's own words, never a rewritten reassurance. */}
          <p data-testid="fit-failed">{matchTask.error?.message ?? ''}</p>
        </Callout>
      ) : null}
      {matchTaskId === null ? null : (
        <p className="text-sm text-slate-700" data-testid="fit-queued">
          {t('jobDetail.fitQueued')}
        </p>
      )}

      {job.match === null || job.match_explanation === null ? (
        <p className="text-sm text-slate-700" data-testid="fit-not-checked">
          {t('jobDetail.fitNotChecked')}
        </p>
      ) : (
        <FitPanel match={job.match} explanation={job.match_explanation} />
      )}

      {correcting === null ? null : (
        <section
          className="flex flex-col gap-3 rounded border border-slate-300 p-4"
          data-testid="job-correction"
        >
          <h2 className="text-base font-semibold text-slate-900">{t('jobDetail.correctTitle')}</h2>
          {/* Why the field exists at all: an unstructured page is read as
              visible text, and the import says so rather than pretending. */}
          <p className="text-sm text-slate-700">{t('jobDetail.correctHelp')}</p>
          <TextField
            label={t('jobDetail.correctTitleLabel')}
            value={correcting.title}
            disabled={pending !== null}
            onChange={(event) => {
              // Read before the updater runs: React clears `currentTarget`
              // once the handler returns, and the updater may run after.
              const value = event.currentTarget.value;
              setCorrecting((current) =>
                current === null ? current : { ...current, title: value },
              );
            }}
          />
          <TextField
            label={t('jobDetail.correctCompanyLabel')}
            value={correcting.company}
            disabled={pending !== null}
            onChange={(event) => {
              // Read before the updater runs: React clears `currentTarget`
              // once the handler returns, and the updater may run after.
              const value = event.currentTarget.value;
              setCorrecting((current) =>
                current === null ? current : { ...current, company: value },
              );
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              busy={pending === 'correct'}
              busyLabel={t('jobDetail.correctSaving')}
              // Neither may be blanked: both words travel into the packet an
              // employer receives, so an empty one is not a correction.
              disabled={
                pending !== null ||
                correcting.title.trim() === '' ||
                correcting.company.trim() === ''
              }
              onClick={() => void saveCorrection(job)}
            >
              {t('jobDetail.correctSave')}
            </Button>
            <Button
              variant="secondary"
              disabled={pending !== null}
              onClick={() => setCorrecting(null)}
            >
              {t('jobDetail.correctCancel')}
            </Button>
          </div>
        </section>
      )}

      <Section title={t('jobDetail.summaryTitle')}>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Entry term={t('jobDetail.remoteType')}>{t(REMOTE_TYPE_LABEL[job.remote_type])}</Entry>
          <Entry term={t('jobDetail.employmentType')}>
            {job.employment_type === null
              ? t('jobDetail.notStated')
              : t(JOB_EMPLOYMENT_TYPE_LABEL[job.employment_type])}
          </Entry>
          <Entry term={t('jobDetail.language')}>{job.language ?? t('jobDetail.notStated')}</Entry>
          <Entry term={t('jobDetail.publishedAt')}>
            {formatDateTime(locale, job.published_at) ?? t('jobDetail.notStated')}
          </Entry>
        </dl>
      </Section>

      <Section title={t('jobDetail.locationsTitle')}>
        {job.locations.length === 0 ? (
          <p className="text-sm text-slate-700">{t('jobDetail.locationsNone')}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm text-slate-800">
            {job.locations.map((location, index) => (
              <li key={index}>
                <span>{locationText(location) || t('jobDetail.notStated')}</span>
                {location.source_excerpt === null ? null : (
                  <span className="block text-xs text-slate-600">
                    {t('jobDetail.readFrom', { excerpt: location.source_excerpt })}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t('jobDetail.eligibilityTitle')}>
        {job.eligible_countries === null ? (
          <Callout tone="warning" live={false}>
            <p data-testid="eligibility" data-eligibility="not_stated">
              {t('jobDetail.eligibilityNotStated')}
            </p>
          </Callout>
        ) : (
          <p className="text-sm text-slate-800" data-testid="eligibility" data-eligibility="stated">
            {t('jobDetail.eligibilityCountries', { countries: job.eligible_countries.join(', ') })}
          </p>
        )}
      </Section>

      <Section title={t('jobDetail.salaryTitle')}>
        <div className="flex flex-col gap-1 text-sm">
          <SalaryCell salary={job.salary} />
          {job.salary === null ? null : (
            <>
              <p className="text-slate-700">
                {t('jobDetail.salaryAsStated', { excerpt: job.salary.source_excerpt })}
              </p>
              <p className="text-xs text-slate-600">{t('jobDetail.salaryNoConversion')}</p>
            </>
          )}
        </div>
      </Section>

      <Section title={t('jobDetail.requirementsTitle')}>
        {job.requirements.length === 0 ? (
          <p className="text-sm text-slate-700" data-testid="requirements-none">
            {t('jobDetail.requirementsNone')}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {REQUIREMENT_KIND_ORDER.map((kind) => {
              const items = requirementsByKind[kind];
              if (items.length === 0) return null;
              return (
                <div key={kind} data-testid={`requirements-${kind}`}>
                  <h3 className="text-sm font-semibold text-slate-900">
                    {t(REQUIREMENT_KIND_LABEL[kind])}
                  </h3>
                  <ul className="mt-1 flex flex-col gap-2">
                    {items.map((requirement, index) => (
                      <li key={index} className="flex flex-col gap-1 text-sm text-slate-800">
                        {/* Requirement text and evidence are the posting's words: verbatim. */}
                        <span>{requirement.text}</span>
                        <Disclosure summary={t('jobDetail.evidenceExcerpt')} data-testid="evidence">
                          <p className="whitespace-pre-wrap">{requirement.evidence_excerpt}</p>
                        </Disclosure>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <Section title={t('jobDetail.inferredTitle')}>
        {job.inferred.length === 0 ? (
          <p className="text-sm text-slate-700">{t('jobDetail.inferredNone')}</p>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-slate-700">{t('jobDetail.inferredIntro')}</p>
            <ul className="flex flex-col gap-2">
              {job.inferred.map((entry, index) => (
                <li
                  key={`${entry.field}-${index}`}
                  className="rounded border border-amber-200 bg-amber-50 p-3 text-sm"
                  data-testid="inferred-field"
                  data-field={entry.field}
                >
                  <p className="font-medium text-slate-900">
                    {t(INFERRED_FIELD_LABEL[entry.field])}
                  </p>
                  <p className="text-slate-700">{t('jobDetail.inferredFrom')}</p>
                  <blockquote className="mt-1 whitespace-pre-wrap border-l-2 border-amber-300 pl-2 text-slate-800">
                    {entry.source_excerpt}
                  </blockquote>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Section title={t('jobDetail.descriptionTitle')}>
        <p className="text-xs text-slate-600">{t('jobDetail.descriptionNote')}</p>
        {/* Plain text on purpose: an HTML string here is displayed, not rendered. */}
        <pre
          className="mt-2 max-h-[32rem] overflow-auto whitespace-pre-wrap rounded border border-slate-200 bg-slate-50 p-3 font-sans text-sm text-slate-800"
          data-testid="description-text"
        >
          {job.description_text}
        </pre>
      </Section>

      <Section title={t('jobDetail.provenanceTitle')}>
        <ul className="flex flex-col gap-3">
          {job.sources.map((source) => (
            <li
              key={source.id}
              className="flex flex-col gap-1 rounded border border-slate-200 p-3 text-sm"
              data-testid="provenance"
              data-connector={source.connector}
            >
              <span className="font-medium text-slate-900">
                {t(CONNECTOR_LABEL[source.connector])}
              </span>
              <span>
                <span className="text-slate-600">{t('jobDetail.provenanceExternalId')}: </span>
                <code className="font-mono text-xs">{source.external_id}</code>
              </span>
              <span>
                <span className="text-slate-600">{t('jobDetail.provenanceCanonical')}: </span>
                <ExternalLink href={source.canonical_url}>{source.canonical_url}</ExternalLink>
              </span>
              <span>
                <span className="text-slate-600">{t('jobDetail.provenanceApply')}: </span>
                {source.apply_url === null ? (
                  t('jobDetail.provenanceApplyNone')
                ) : (
                  <ExternalLink href={source.apply_url}>{source.apply_url}</ExternalLink>
                )}
              </span>
              <span className="text-xs text-slate-600">
                {t('jobDetail.provenanceRetrieved', {
                  when: formatDateTime(locale, source.retrieved_at) ?? t('common.notReported'),
                })}
              </span>
              {source.source_id === null &&
              (source.connector === 'greenhouse' || source.connector === 'lever') ? (
                <span className="text-xs text-slate-600">
                  {t('jobDetail.provenanceSourceRemoved')}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </Section>

      <Section title={t('jobDetail.duplicatesTitle')}>
        {job.possible_duplicates.length === 0 ? (
          <p className="text-sm text-slate-700">{t('jobDetail.duplicatesNone')}</p>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-slate-700">{t('jobDetail.duplicatesIntro')}</p>
            <ul className="flex flex-col gap-1 text-sm">
              {job.possible_duplicates.map((duplicate) => (
                <li key={duplicate.job_id} data-testid="duplicate">
                  <Link to={`/jobs/${duplicate.job_id}`} className={LINK_CLASS}>
                    {t(DUPLICATE_REASON_LABEL[duplicate.reason])}
                  </Link>
                  <span className="block text-xs text-slate-600">{duplicate.detail}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Section title={t('jobDetail.freshnessTitle')}>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Entry term={t('jobDetail.firstSeen')}>
            {formatDateTime(locale, job.first_seen_at) ?? t('common.notReported')}
          </Entry>
          <Entry term={t('jobDetail.lastSeen')}>
            {formatDateTime(locale, job.last_seen_at) ?? t('common.notReported')}
          </Entry>
          <Entry term={t('jobDetail.lastFetched')}>
            <span className="flex flex-col gap-1">
              <span>{formatDateTime(locale, job.last_fetched_at) ?? t('common.notReported')}</span>
              <FreshnessCell job={job} nowMs={nowMs} />
            </span>
          </Entry>
          <Entry term={t('jobDetail.contentHash')}>
            <code className="font-mono text-xs break-all">{job.content_hash}</code>
          </Entry>
        </dl>
      </Section>

      <Dialog
        open={confirmClose}
        title={t('jobDetail.markClosedTitle')}
        onClose={() => setConfirmClose(false)}
        footer={
          <>
            <Button onClick={() => setConfirmClose(false)}>{t('action.cancel')}</Button>
            <Button
              variant="danger"
              busy={pending === 'close'}
              busyLabel={t('jobDetail.closing')}
              onClick={() => void markClosed(job)}
            >
              {t('jobDetail.markClosedConfirm')}
            </Button>
          </>
        }
      >
        <p>{t('jobDetail.markClosedBody')}</p>
        {patchError === null ? null : <ErrorNotice error={patchError} />}
        {stale ? (
          <div>
            <Button onClick={() => void jobQuery.refetch()}>{t('jobDetail.reload')}</Button>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}

function groupRequirements(
  requirements: readonly JobRequirement[],
): Record<JobRequirement['kind'], JobRequirement[]> {
  const groups: Record<JobRequirement['kind'], JobRequirement[]> = {
    required: [],
    preferred: [],
    unknown: [],
  };
  for (const requirement of requirements) groups[requirement.kind].push(requirement);
  return groups;
}

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded border border-slate-200 bg-white p-4">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      {children}
    </section>
  );
}

function Entry({ term, children }: { readonly term: string; readonly children: ReactNode }) {
  return (
    <div className="rounded border border-slate-200 bg-slate-50 p-3">
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-600">{term}</dt>
      <dd className="mt-1 text-sm text-slate-900">{children}</dd>
    </div>
  );
}
