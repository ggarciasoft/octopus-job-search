import type { NoopEchoResult, TaskView } from '@job-getter/contracts';
import { Button, Callout, ProgressBar, Select, TextField } from '@job-getter/ui';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useApi } from '../api/ApiProvider';
import { IdempotentIntent } from '../api/idempotency';
import { useSession } from '../auth/AuthProvider';
import { ErrorNotice } from '../components/ErrorNotice';
import { TaskLifecycle, TaskStateBadge } from '../components/TaskLifecycle';
import { useTaskPolling, isTerminalTaskState } from '../hooks/useTaskPolling';
import { useTranslation } from '../i18n/I18nProvider';
import { elapsedSeconds, formatDateTime, formatNumber } from '../i18n/format';

const DELAY_OPTIONS = [0, 2_000, 10_000, 30_000] as const;

/**
 * Recognises the `noop_echo` result shape from the contract. The result field
 * of a task is `unknown` by design, so it is narrowed here rather than cast:
 * an unexpected shape is reported as unrecognised and shown raw, never
 * rendered as if the expected fields were present.
 */
function asNoopEchoResult(value: unknown): NoopEchoResult | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Record<string, unknown>;
  const isString = (key: string) => typeof candidate[key] === 'string';
  return isString('echoed') &&
    isString('worker_id') &&
    isString('worker_runtime') &&
    isString('processed_at')
    ? (candidate as unknown as NoopEchoResult)
    : null;
}

export function DiagnosticsPage() {
  const api = useApi();
  const { t, locale } = useTranslation();
  const session = useSession();

  const [message, setMessage] = useState('');
  const [delayMs, setDelayMs] = useState<number>(0);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<unknown>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelAcknowledged, setCancelAcknowledged] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // One intent object for the lifetime of the screen; it decides when a submit
  // is a retry (same key) and when it is new work (new key).
  const intentRef = useRef(new IdempotentIntent());

  const { task, error: pollError, isPolling, isPaused } = useTaskPolling({ taskId });

  const active = task !== null && !isTerminalTaskState(task.state);

  // Elapsed time ticks only while something is actually running.
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [active]);

  const elapsed = useMemo(() => {
    if (!task) return null;
    const until = isTerminalTaskState(task.state) ? new Date(task.updated_at).getTime() : now;
    return elapsedSeconds(task.created_at, until);
  }, [task, now]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = message.trim();
    const nextMessageError = trimmed === '' ? t('diagnostics.messageRequired') : null;
    setMessageError(nextMessageError);
    if (nextMessageError) return;

    const body = delayMs > 0 ? { message: trimmed, delay_ms: delayMs } : { message: trimmed };
    const idempotencyKey = intentRef.current.keyFor(body);

    setSubmitting(true);
    setSubmitError(null);
    try {
      const accepted = await api.createDiagnosticTask({ body, idempotencyKey });
      intentRef.current.complete();
      setCancelAcknowledged(false);
      setCancelError(null);
      setTaskId(accepted.task_id);
    } catch (caught) {
      // The message and delay stay exactly as typed; retrying reuses the key.
      setSubmitError(caught);
    } finally {
      setSubmitting(false);
    }
  };

  const onCancel = async () => {
    if (taskId === null) return;
    setCancelling(true);
    setCancelError(null);
    try {
      const updated = await api.cancelTask({ params: { id: taskId } });
      setCancelAcknowledged(updated.cancel_requested);
    } catch (caught) {
      setCancelError(caught);
    } finally {
      setCancelling(false);
    }
  };

  const workerOffline = session !== null && !session.capabilities.worker_online;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-slate-900">{t('diagnostics.title')}</h1>
        <p className="max-w-3xl text-sm text-slate-700">{t('diagnostics.intro')}</p>
      </header>

      {workerOffline ? (
        <Callout tone="warning" title={t('dashboard.workerTitle')}>
          <p>{t('diagnostics.workerOfflineWarning')}</p>
        </Callout>
      ) : null}

      <section className="flex max-w-2xl flex-col gap-4 rounded border border-slate-200 bg-white p-4">
        <h2 className="text-base font-semibold text-slate-900">{t('diagnostics.formTitle')}</h2>

        {submitError === null ? null : <ErrorNotice error={submitError} />}

        <form className="flex flex-col gap-4" onSubmit={(event) => void onSubmit(event)} noValidate>
          <TextField
            label={t('diagnostics.messageLabel')}
            description={t('diagnostics.messageDescription')}
            value={message}
            required
            maxLength={500}
            error={messageError}
            onChange={(event) => setMessage(event.currentTarget.value)}
          />
          <Select
            label={t('diagnostics.delayLabel')}
            description={t('diagnostics.delayDescription')}
            value={String(delayMs)}
            options={DELAY_OPTIONS.map((value) => ({
              value: String(value),
              label:
                value === 0
                  ? t('diagnostics.delayNone')
                  : value === 2_000
                    ? t('diagnostics.delayShort')
                    : value === 10_000
                      ? t('diagnostics.delayMedium')
                      : t('diagnostics.delayLong'),
            }))}
            onChange={(event) => setDelayMs(Number(event.currentTarget.value))}
          />
          <div className="flex items-center gap-3">
            <Button type="submit" variant="primary" busy={submitting} busyLabel={t('diagnostics.busy')}>
              {t('diagnostics.submit')}
            </Button>
          </div>
          <p className="text-xs text-slate-600">{t('diagnostics.idempotencyNote')}</p>
        </form>
      </section>

      {taskId === null ? null : (
        <section className="flex flex-col gap-4 rounded border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-slate-900">
              {t('diagnostics.taskTitle', { taskId })}
            </h2>
            {task ? <TaskStateBadge state={task.state} /> : null}
          </div>

          {pollError === null ? null : (
            <ErrorNotice error={pollError} overrideMessage={t('diagnostics.loadFailed')} />
          )}

          {isPaused ? (
            <p className="text-sm text-slate-600">{t('diagnostics.pollingPaused')}</p>
          ) : null}

          {task === null ? null : (
            <>
              <TaskLifecycle current={task.state} />

              {task.state === 'queued' && workerOffline ? (
                // A queued task with no worker is not "in progress"; saying so
                // plainly beats an animated bar that implies something is
                // happening (invariant 10: never report work that is not real).
                <Callout tone="warning" title={t('diagnostics.queuedNoWorkerTitle')}>
                  <p data-testid="queued-no-worker">{t('diagnostics.queuedNoWorker')}</p>
                </Callout>
              ) : null}

              {task.progress === null ? (
                // No progress reported: a sentence, not an indeterminate bar.
                // An animated bar would be motion the worker never claimed.
                <p className="text-sm text-slate-700">{t('diagnostics.progressNone')}</p>
              ) : (
                <ProgressBar
                  percent={task.progress.percent}
                  label={t('diagnostics.progressLabel')}
                  stage={task.progress.stage}
                />
              )}

              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Entry
                  term={t('tasks.columnAttempt')}
                  value={t('diagnostics.attempt', {
                    attempt: formatNumber(locale, task.attempt),
                    max: formatNumber(locale, task.max_attempts),
                  })}
                />
                <Entry
                  term={t('diagnostics.elapsed')}
                  value={
                    elapsed === null
                      ? t('common.notReported')
                      : t('diagnostics.elapsedValue', { seconds: formatNumber(locale, elapsed) })
                  }
                />
                <Entry
                  term={t('diagnostics.createdAt')}
                  value={formatDateTime(locale, task.created_at) ?? t('common.notReported')}
                />
              </dl>

              {task.cancel_requested || cancelAcknowledged ? (
                <Callout tone="warning" title={t('tasks.cancelRequestedShort')}>
                  <p>{t('diagnostics.cancelRequested')}</p>
                </Callout>
              ) : null}

              {cancelError === null ? null : <ErrorNotice error={cancelError} />}

              {isTerminalTaskState(task.state) ? null : (
                <div>
                  <Button
                    variant="danger"
                    busy={cancelling}
                    busyLabel={t('diagnostics.cancelBusy')}
                    onClick={() => void onCancel()}
                  >
                    {t('diagnostics.cancel')}
                  </Button>
                </div>
              )}

              <TaskOutcome task={task} />

              <details className="rounded border border-slate-200 p-3">
                <summary className="cursor-pointer text-sm font-medium text-slate-800">
                  {t('diagnostics.rawResult')}
                </summary>
                {task.result === null || task.result === undefined ? (
                  <p className="mt-2 text-sm text-slate-700">{t('diagnostics.rawResultNone')}</p>
                ) : (
                  <pre className="mt-2 overflow-auto rounded bg-slate-900 p-3 text-xs text-slate-100">
                    {JSON.stringify(task.result, null, 2)}
                  </pre>
                )}
              </details>

              {isPolling ? null : (
                <p className="text-xs text-slate-600">{t('diagnostics.startAnother')}</p>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}

/**
 * The terminal outcome. A failure shows the real code and the real message and
 * renders no success text at all; a success is only claimed when the API
 * reported `succeeded`.
 */
function TaskOutcome({ task }: { readonly task: TaskView }) {
  const { t, locale } = useTranslation();

  if (task.state === 'failed') {
    return (
      <Callout tone="error" title={t('diagnostics.failedTitle')}>
        {task.error === null ? (
          <p>{t('common.notReported')}</p>
        ) : (
          <>
            <p>
              <span className="font-medium">{t('diagnostics.failureCode')}: </span>
              {/* Machine code, shown verbatim so it can be searched in logs. */}
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
    );
  }

  if (task.state === 'cancelled') {
    return (
      <Callout tone="warning" title={t('diagnostics.cancelledTitle')}>
        <p>{t('diagnostics.cancelledBody')}</p>
      </Callout>
    );
  }

  if (task.state !== 'succeeded') return null;

  const result = asNoopEchoResult(task.result);

  return (
    <Callout tone="success" title={t('diagnostics.succeededTitle')}>
      <p>{t('diagnostics.succeededBody')}</p>
      {result === null ? (
        <p>{t('diagnostics.resultUnrecognised')}</p>
      ) : (
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Entry term={t('diagnostics.workerId')} value={result.worker_id} mono />
          <Entry term={t('diagnostics.workerRuntime')} value={result.worker_runtime} mono />
          <Entry
            term={t('diagnostics.processedAt')}
            value={formatDateTime(locale, result.processed_at) ?? result.processed_at}
          />
          {/*
            The echoed message is the user's own text coming back from the
            worker. It is shown exactly as returned and is never translated
            (08_UX_AND_CUSTOMIZATION.md: do not silently translate stored facts).
          */}
          <Entry term={t('diagnostics.echoed')} value={result.echoed} />
        </dl>
      )}
    </Callout>
  );
}

function Entry({
  term,
  value,
  mono = false,
}: {
  readonly term: string;
  readonly value: string;
  readonly mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-600">{term}</dt>
      <dd className={`mt-0.5 text-sm text-slate-900 ${mono ? 'font-mono text-xs break-all' : ''}`}>
        {value}
      </dd>
    </div>
  );
}
