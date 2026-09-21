import type { JobImportRequest, NormalizedJob } from '@job-getter/contracts';
import { Button, Callout, RadioGroup, TextArea, TextField } from '@job-getter/ui';
import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../api/ApiProvider';
import { describeFailure } from '../api/errors';
import { fieldError } from '../api/fieldErrors';
import { IdempotentIntent } from '../api/idempotency';
import { ExternalLink } from '../components/DiscoveryBadges';
import { ErrorNotice } from '../components/ErrorNotice';
import { TaskStateBadge } from '../components/TaskLifecycle';
import { useTaskPolling } from '../hooks/useTaskPolling';
import { useTranslation } from '../i18n/I18nProvider';
import { FETCH_WARNING_LABEL } from './labels';
import {
  classifyImportOutcome,
  readImportOutcome,
  refusalWarnings,
  type ImportOutcome,
} from './presentation';

const LINK_CLASS =
  'text-sm font-medium text-sky-800 underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600';

type ImportMode = 'url' | 'text';

/** The contract's minimum for a pasted description (`JobImportRequest`). */
const MIN_DESCRIPTION_CHARS = 20;

export interface ImportPanelProps {
  readonly discoveryUnavailable: boolean;
  readonly workerOffline: boolean;
}

/**
 * Manual import: a public URL *or* a pasted description, never both — the
 * body is built from the selected mode, so the two cannot be sent together.
 *
 * The outcome comes from the task: `job_import.job_id` when a job was
 * created; `candidates` when the page held several postings (the user picks
 * one, which is a second import by that posting's own URL); a refusal warning
 * when the fetch was blocked, denied, rate limited or disallowed by robots —
 * in which case the panel says so and offers paste mode, and never a way
 * around the refusal (05_DISCOVERY_CONNECTORS.md).
 */
export function ImportPanel({ discoveryUnavailable, workerOffline }: ImportPanelProps) {
  const api = useApi();
  const { t } = useTranslation();

  const [mode, setMode] = useState<ImportMode>('url');
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [company, setCompany] = useState('');
  const [title, setTitle] = useState('');
  const [applyUrl, setApplyUrl] = useState('');
  const [sourceError, setSourceError] = useState<string | null>(null);

  const intentRef = useRef(new IdempotentIntent());
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [taskId, setTaskId] = useState<string | null>(null);

  const { task, error: pollError, isPaused, refresh } = useTaskPolling({ taskId });

  const hints = (): Pick<JobImportRequest, 'company' | 'title' | 'apply_url'> => ({
    ...(company.trim() === '' ? {} : { company: company.trim() }),
    ...(title.trim() === '' ? {} : { title: title.trim() }),
    ...(applyUrl.trim() === '' ? {} : { apply_url: applyUrl.trim() }),
  });

  const buildBody = (): JobImportRequest | null => {
    if (mode === 'url') {
      const trimmed = url.trim();
      if (!/^https:\/\/\S+$/i.test(trimmed)) {
        setSourceError(t('jobImport.urlRequired'));
        return null;
      }
      return { url: trimmed, ...hints() };
    }
    if (text.trim().length < MIN_DESCRIPTION_CHARS) {
      setSourceError(t('jobImport.textRequired'));
      return null;
    }
    return { description_text: text, ...hints() };
  };

  const queue = async (body: JobImportRequest, intent: IdempotentIntent) => {
    const idempotencyKey = intent.keyFor(body);
    setSubmitting(true);
    setSubmitError(null);
    try {
      const accepted = await api.importJob({ body, idempotencyKey });
      intent.complete();
      setTaskId(accepted.task_id);
    } catch (caught) {
      // Body untouched: a retry reuses the same key.
      setSubmitError(caught);
    } finally {
      setSubmitting(false);
    }
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const body = buildBody();
    if (body === null) return;
    setSourceError(null);
    await queue(body, intentRef.current);
  };

  /** Choosing a candidate is a new intent: its own key, by the posting's own URL. */
  const chooseCandidate = async (candidate: NormalizedJob) => {
    intentRef.current = new IdempotentIntent();
    await queue({ url: candidate.canonical_url }, intentRef.current);
  };

  const startOver = () => {
    setTaskId(null);
    setSubmitError(null);
    intentRef.current = new IdempotentIntent();
  };

  /** Paste mode after a refusal: the refused URL becomes the apply-URL hint. */
  const switchToPaste = () => {
    if (applyUrl.trim() === '' && url.trim() !== '') setApplyUrl(url.trim());
    setMode('text');
    setSourceError(null);
    startOver();
  };

  const serverFields = submitError === null ? {} : describeFailure(submitError).fields;
  const outcome: ImportOutcome | null =
    task !== null && task.state === 'succeeded' ? readImportOutcome(task.result) : null;

  return (
    <section className="flex flex-col gap-4 rounded border border-slate-200 bg-white p-4">
      <div>
        <h2 className="text-base font-semibold text-slate-900">{t('jobImport.title')}</h2>
        <p className="mt-1 text-sm text-slate-700">{t('jobImport.intro')}</p>
      </div>

      {taskId === null ? (
        <form className="flex flex-col gap-3" onSubmit={(event) => void onSubmit(event)}>
          {discoveryUnavailable ? (
            <Callout tone="warning" live={false}>
              <p>{t('discover.controlUnavailable')}</p>
            </Callout>
          ) : null}
          <RadioGroup<ImportMode>
            legend={t('jobImport.modeLegend')}
            name="job-import-mode"
            value={mode}
            onValueChange={(next) => {
              setMode(next);
              setSourceError(null);
            }}
            options={[
              {
                value: 'url',
                label: t('jobImport.modeUrl'),
                description: t('jobImport.modeUrlDescription'),
                disabled: discoveryUnavailable,
              },
              {
                value: 'text',
                label: t('jobImport.modeText'),
                description: t('jobImport.modeTextDescription'),
                disabled: discoveryUnavailable,
              },
            ]}
          />
          {mode === 'url' ? (
            <TextField
              label={t('jobImport.url')}
              type="url"
              inputMode="url"
              required
              disabled={discoveryUnavailable}
              value={url}
              error={sourceError ?? fieldError(serverFields, 'url')}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setUrl(event.currentTarget.value)}
            />
          ) : (
            <TextArea
              label={t('jobImport.text')}
              description={t('jobImport.textDescription')}
              required
              rows={10}
              disabled={discoveryUnavailable}
              value={text}
              error={sourceError ?? fieldError(serverFields, 'description_text')}
              onChange={(event) => setText(event.currentTarget.value)}
            />
          )}
          <fieldset className="flex flex-col gap-3 border-0 p-0">
            <legend className="text-sm font-medium text-slate-800">
              {t('jobImport.hintsTitle')}
            </legend>
            <TextField
              label={t('jobImport.company')}
              value={company}
              disabled={discoveryUnavailable}
              error={fieldError(serverFields, 'company')}
              onChange={(event) => setCompany(event.currentTarget.value)}
            />
            <TextField
              label={t('jobImport.jobTitle')}
              value={title}
              disabled={discoveryUnavailable}
              error={fieldError(serverFields, 'title')}
              onChange={(event) => setTitle(event.currentTarget.value)}
            />
            <TextField
              label={t('jobImport.applyUrl')}
              description={t('jobImport.applyUrlDescription')}
              type="url"
              inputMode="url"
              value={applyUrl}
              disabled={discoveryUnavailable}
              error={fieldError(serverFields, 'apply_url')}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setApplyUrl(event.currentTarget.value)}
            />
          </fieldset>
          {submitError === null ? null : <ErrorNotice error={submitError} />}
          <div>
            <Button
              type="submit"
              variant="primary"
              disabled={discoveryUnavailable}
              busy={submitting}
              busyLabel={t('jobImport.submitting')}
            >
              {t('jobImport.submit')}
            </Button>
          </div>
          <p className="text-xs text-slate-600">{t('diagnostics.idempotencyNote')}</p>
        </form>
      ) : (
        <div className="flex flex-col gap-3" data-testid="import-task">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900">
              {t('jobImport.taskTitle', { taskId })}
            </h3>
            {task ? <TaskStateBadge state={task.state} /> : null}
          </div>

          {pollError === null ? null : (
            <div className="flex flex-col gap-2">
              <ErrorNotice error={pollError} overrideMessage={t('diagnostics.loadFailed')} />
              <div>
                <Button onClick={refresh}>{t('action.retry')}</Button>
              </div>
            </div>
          )}
          {isPaused ? (
            <p className="text-sm text-slate-600">{t('diagnostics.pollingPaused')}</p>
          ) : null}

          {task !== null && task.state === 'queued' && workerOffline ? (
            <Callout tone="warning" title={t('diagnostics.queuedNoWorkerTitle')}>
              <p data-testid="queued-no-worker">{t('jobImport.queuedNoWorker')}</p>
            </Callout>
          ) : null}

          {task !== null && task.state === 'failed' ? (
            <Callout tone="error" title={t('jobImport.failedTitle')}>
              {task.error === null ? (
                <p>{t('common.notReported')}</p>
              ) : (
                <>
                  <p>
                    <span className="font-medium">{t('diagnostics.failureCode')}: </span>
                    <code className="font-mono" data-testid="failure-code">
                      {task.error.code}
                    </code>
                  </p>
                  <p data-testid="failure-message">
                    <span className="font-medium">{t('diagnostics.failureMessage')}: </span>
                    {task.error.message}
                  </p>
                  <p>
                    {task.error.retryable
                      ? t('diagnostics.failureRetryable')
                      : t('diagnostics.failureNotRetryable')}
                  </p>
                </>
              )}
            </Callout>
          ) : null}

          {task !== null && task.state === 'cancelled' ? (
            <Callout tone="warning" title={t('diagnostics.cancelledTitle')}>
              <p>{t('diagnostics.cancelledBody')}</p>
            </Callout>
          ) : null}

          {task !== null && task.state === 'succeeded' ? (
            outcome === null ? (
              <Callout tone="warning">
                <p data-testid="import-unreadable">{t('jobImport.resultUnreadable')}</p>
              </Callout>
            ) : (
              <ImportOutcomeView
                outcome={outcome}
                submitting={submitting}
                submitError={submitError}
                onChoose={(candidate) => void chooseCandidate(candidate)}
                onSwitchToPaste={switchToPaste}
              />
            )
          ) : null}

          <div>
            <Button onClick={startOver}>{t('jobImport.startOver')}</Button>
          </div>
        </div>
      )}
    </section>
  );
}

interface ImportOutcomeViewProps {
  readonly outcome: ImportOutcome;
  readonly submitting: boolean;
  readonly submitError: unknown;
  readonly onChoose: (candidate: NormalizedJob) => void;
  readonly onSwitchToPaste: () => void;
}

function ImportOutcomeView({
  outcome,
  submitting,
  submitError,
  onChoose,
  onSwitchToPaste,
}: ImportOutcomeViewProps) {
  const { t } = useTranslation();
  const kind = classifyImportOutcome(outcome);

  return (
    <div className="flex flex-col gap-3" data-testid="import-outcome" data-outcome={kind}>
      {kind === 'created' ? (
        <Callout tone="success" title={t('jobImport.createdTitle')} live>
          <p>{t('jobImport.createdBody')}</p>
          {outcome.job === null ? null : (
            // Title and company are the posting's own words: verbatim.
            <p className="font-medium">
              {outcome.job.title} — {outcome.job.company}
            </p>
          )}
          <p>
            <Link
              to={`/jobs/${outcome.jobId}`}
              className={LINK_CLASS}
              data-testid="import-job-link"
            >
              {t('jobImport.openJob')}
            </Link>
          </p>
        </Callout>
      ) : null}

      {kind === 'needs_choice' ? (
        <div className="flex flex-col gap-2">
          <Callout tone="info" live={false} title={t('jobImport.chooseTitle')}>
            <p>{t('jobImport.chooseBody')}</p>
          </Callout>
          {submitError === null ? null : <ErrorNotice error={submitError} />}
          <ul className="flex flex-col gap-2">
            {outcome.candidates.map((candidate, index) => (
              <li
                key={`${candidate.canonical_url}-${index}`}
                data-testid="candidate"
                className="flex flex-col gap-1 rounded border border-slate-200 p-3"
              >
                <span className="text-sm font-medium text-slate-900">
                  {candidate.title} — {candidate.company}
                </span>
                <ExternalLink
                  href={candidate.canonical_url}
                  className="text-xs text-sky-800 underline"
                >
                  {candidate.canonical_url}
                </ExternalLink>
                <div>
                  <Button
                    size="sm"
                    variant="primary"
                    busy={submitting}
                    busyLabel={t('jobImport.submitting')}
                    onClick={() => onChoose(candidate)}
                  >
                    {t('jobImport.choose')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {kind === 'refused' ? (
        <Callout tone="warning" title={t('jobImport.refusedTitle')}>
          <p data-testid="import-refused">{t('jobImport.refusedBody')}</p>
          <ul className="list-disc pl-5">
            {refusalWarnings(outcome).map((warning, index) => (
              <li key={`${warning.code}-${index}`}>
                {t(FETCH_WARNING_LABEL[warning.code])}{' '}
                <code className="font-mono text-xs">{warning.code}</code>
              </li>
            ))}
          </ul>
          <div>
            <Button onClick={onSwitchToPaste}>{t('jobImport.switchToPaste')}</Button>
          </div>
        </Callout>
      ) : null}

      {kind === 'nothing_found' ? (
        <Callout tone="warning" title={t('jobImport.nothingTitle')}>
          <p data-testid="import-nothing">{t('jobImport.nothingBody')}</p>
          <div>
            <Button onClick={onSwitchToPaste}>{t('jobImport.switchToPaste')}</Button>
          </div>
        </Callout>
      ) : null}

      {outcome.warnings.length > 0 ? (
        <div>
          <h4 className="text-sm font-semibold text-slate-900">{t('jobImport.warningsTitle')}</h4>
          <ul className="mt-1 list-disc pl-5 text-sm text-slate-700">
            {outcome.warnings.map((warning, index) => (
              <li key={`${warning.code}-${index}`} data-testid="import-warning">
                <span>{t(FETCH_WARNING_LABEL[warning.code])}</span>{' '}
                <code className="font-mono text-xs">{warning.code}</code>
                {/* The worker's own message is data: verbatim. */}
                {warning.message ? <span className="block text-xs">{warning.message}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
