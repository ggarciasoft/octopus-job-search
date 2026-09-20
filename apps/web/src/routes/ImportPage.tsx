import {
  ProfileImportFormatHint as FormatHintSchema,
  type CreateProfileImportRequest,
  type DraftFact,
  type FileUploadResponse,
  type ImportWarning,
  type Profile,
  type ProfileImportFormatHint,
  type ProfileImportView,
} from '@job-getter/contracts';
import {
  Badge,
  Button,
  Callout,
  Checkbox,
  Dialog,
  FormField,
  INPUT_CLASS,
  ProgressBar,
  RadioGroup,
  Select,
  Spinner,
  TextArea,
} from '@job-getter/ui';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useApi } from '../api/ApiProvider';
import { describeFailure } from '../api/errors';
import { IdempotentIntent } from '../api/idempotency';
import { useSession } from '../auth/AuthProvider';
import { ErrorNotice } from '../components/ErrorNotice';
import { FactStateBadge } from '../components/FactStateBadge';
import { TaskLifecycle, TaskStateBadge } from '../components/TaskLifecycle';
import { isTerminalTaskState, useTaskPolling } from '../hooks/useTaskPolling';
import { useTranslation } from '../i18n/I18nProvider';
import { formatNumber } from '../i18n/format';
import type { MessageKey } from '../i18n/messages';
import { FactForm } from '../profile/FactForm';
import { FactSummary } from '../profile/FactSummary';
import { asFactDraft, literalOptions } from '../profile/factValues';
import {
  FILE_INPUT_ACCEPT,
  NO_DECISION,
  buildAcceptedFields,
  checkUploadCandidate,
  isAccepted,
  type ConflictChoice,
  type DraftDecision,
} from '../profile/importReview';
import { useProfileQuery, useSetProfile } from '../profile/useProfile';

const LINK_CLASS =
  'text-sm font-medium text-sky-800 underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600';

const ALL_FORMAT_HINTS = literalOptions<ProfileImportFormatHint>(FormatHintSchema);
const FILE_FORMAT_HINTS = ALL_FORMAT_HINTS.filter((hint) => ['auto', 'pdf', 'docx'].includes(hint));
const TEXT_FORMAT_HINTS = ALL_FORMAT_HINTS.filter((hint) =>
  ['auto', 'linkedin_export_text', 'plain_text'].includes(hint),
);

type SourceMode = 'file' | 'text';

/**
 * Import review: choose a source, upload, queue extraction, follow the task,
 * then review every proposed fact one by one.
 *
 * Nothing is accepted by default. A draft reaches the profile only when the
 * user ticks it (or chooses replace / keep both for a conflict), and the
 * confirm request names exactly those drafts (06_AI_PROFILE_AND_CV.md: "No
 * extracted field is verified until user confirmation").
 */
export function ImportPage() {
  const api = useApi();
  const { t, locale } = useTranslation();
  const session = useSession();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const profileQuery = useProfileQuery();
  const setProfile = useSetProfile();

  const [source, setSource] = useState<SourceMode>('file');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [pastedText, setPastedText] = useState('');
  const [textError, setTextError] = useState<string | null>(null);
  const [formatHint, setFormatHint] = useState<ProfileImportFormatHint>('auto');

  const [upload, setUpload] = useState<FileUploadResponse | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<unknown>(null);

  const intentRef = useRef(new IdempotentIntent());
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<unknown>(null);
  const [taskId, setTaskId] = useState<string | null>(() => searchParams.get('task'));

  const { task, error: pollError, isPaused, refresh } = useTaskPolling({ taskId });
  const terminal = task !== null && isTerminalTaskState(task.state);

  // The import row is read only once the task succeeded: a failed task already
  // carries the real error, and there is nothing to review behind it.
  const importQuery = useQuery({
    queryKey: ['profile-import', taskId],
    queryFn: ({ signal }) => api.getProfileImport({ params: { id: taskId as string }, signal }),
    enabled: taskId !== null && task?.state === 'succeeded',
  });

  const workerOffline = session !== null && !session.capabilities.worker_online;
  const importUnavailable = session !== null && !session.capabilities.profile_import;

  const onFileChange = (files: FileList | null) => {
    const candidate = files?.[0] ?? null;
    setUpload(null);
    setUploadError(null);
    if (candidate === null) {
      setFile(null);
      setFileError(null);
      return;
    }
    const rejection = checkUploadCandidate(candidate);
    if (rejection === 'too_large') {
      setFile(null);
      setFileError(t('import.fileTooLarge'));
      return;
    }
    if (rejection === 'wrong_type') {
      setFile(null);
      setFileError(t('import.fileWrongType'));
      return;
    }
    setFile(candidate);
    setFileError(null);
  };

  const onUpload = async () => {
    if (file === null) {
      setFileError(t('import.fileRequired'));
      return;
    }
    const body = new FormData();
    body.append('file', file, file.name);
    body.append('purpose', 'cv_original');
    setUploading(true);
    setUploadError(null);
    try {
      setUpload(await api.uploadFile({ body }));
    } catch (caught) {
      setUploadError(caught);
    } finally {
      setUploading(false);
    }
  };

  const onCreate = async () => {
    let body: CreateProfileImportRequest;
    if (source === 'file') {
      if (upload === null) {
        setFileError(t('import.uploadFirst'));
        return;
      }
      body = { file_id: upload.file.id, format_hint: formatHint };
    } else {
      const trimmed = pastedText.trim();
      if (trimmed === '') {
        setTextError(t('import.textRequired'));
        return;
      }
      setTextError(null);
      body = { pasted_text: pastedText, format_hint: formatHint };
    }

    const idempotencyKey = intentRef.current.keyFor(body);
    setCreating(true);
    setCreateError(null);
    try {
      const accepted = await api.createProfileImport({ body, idempotencyKey });
      intentRef.current.complete();
      setTaskId(accepted.task_id);
      setSearchParams({ task: accepted.task_id }, { replace: true });
    } catch (caught) {
      // Body untouched: a retry reuses the same key.
      setCreateError(caught);
    } finally {
      setCreating(false);
    }
  };

  /** Back to step 1 with a clean slate and a fresh idempotency intent. */
  const startOver = () => {
    setTaskId(null);
    setSearchParams({}, { replace: true });
    setUpload(null);
    setUploadError(null);
    setCreateError(null);
    setFile(null);
    setFileError(null);
    intentRef.current = new IdempotentIntent();
  };

  const queueBlocked =
    importUnavailable || (source === 'file' && upload !== null && upload.validation.encrypted);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-slate-900">{t('import.title')}</h1>
        <p className="max-w-3xl text-sm text-slate-700">{t('import.intro')}</p>
        <p className="text-sm">
          <Link to="/profile" className={LINK_CLASS}>
            {t('import.backToProfile')}
          </Link>
        </p>
      </header>

      {importUnavailable ? (
        <Callout tone="warning" title={t('import.unavailableTitle')}>
          <p>{t('import.unavailableBody')}</p>
        </Callout>
      ) : null}

      {workerOffline ? (
        <Callout tone="warning" title={t('dashboard.workerTitle')}>
          <p>{t('import.workerOfflineWarning')}</p>
        </Callout>
      ) : null}

      {taskId === null ? (
        <>
          <section className="flex max-w-3xl flex-col gap-4 rounded border border-slate-200 bg-white p-4">
            <h2 className="text-base font-semibold text-slate-900">{t('import.step1Title')}</h2>
            <RadioGroup<SourceMode>
              legend={t('import.sourceLegend')}
              name="import-source"
              value={source}
              onValueChange={(next) => {
                setSource(next);
                setFormatHint('auto');
              }}
              options={[
                {
                  value: 'file',
                  label: t('import.sourceFile'),
                  description: t('import.sourceFileDescription'),
                },
                {
                  value: 'text',
                  label: t('import.sourceText'),
                  description: t('import.sourceTextDescription'),
                },
              ]}
            />

            {source === 'file' ? (
              <>
                <FormField
                  label={t('import.fileLabel')}
                  description={t('import.fileDescription')}
                  error={fileError}
                  required
                >
                  {(field) => (
                    <input
                      {...field}
                      type="file"
                      accept={FILE_INPUT_ACCEPT}
                      className={INPUT_CLASS}
                      onChange={(event) => onFileChange(event.currentTarget.files)}
                    />
                  )}
                </FormField>
                <Select
                  label={t('import.formatHintLabel')}
                  description={t('import.formatHintDescription')}
                  value={formatHint}
                  options={FILE_FORMAT_HINTS.map((hint) => ({
                    value: hint,
                    label: t(`formatHint.${hint}`),
                  }))}
                  onChange={(event) =>
                    setFormatHint(event.currentTarget.value as ProfileImportFormatHint)
                  }
                />
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    variant="primary"
                    busy={uploading}
                    busyLabel={t('import.uploading')}
                    disabled={file === null}
                    onClick={() => void onUpload()}
                  >
                    {t('import.upload')}
                  </Button>
                  {file === null ? null : (
                    <span className="text-sm text-slate-700">
                      {t('import.selectedFile', {
                        name: file.name,
                        size: formatNumber(locale, Math.round(file.size / 1024)),
                      })}
                    </span>
                  )}
                </div>
                {uploadError === null ? null : <ErrorNotice error={uploadError} />}
                {upload === null ? null : <UploadValidation upload={upload} />}
              </>
            ) : (
              <>
                <TextArea
                  label={t('import.textLabel')}
                  description={t('import.textDescription')}
                  required
                  rows={12}
                  value={pastedText}
                  error={textError}
                  onChange={(event) => setPastedText(event.currentTarget.value)}
                />
                <Select
                  label={t('import.formatHintLabel')}
                  description={t('import.formatHintDescription')}
                  value={formatHint}
                  options={TEXT_FORMAT_HINTS.map((hint) => ({
                    value: hint,
                    label: t(`formatHint.${hint}`),
                  }))}
                  onChange={(event) =>
                    setFormatHint(event.currentTarget.value as ProfileImportFormatHint)
                  }
                />
              </>
            )}
          </section>

          <section className="flex max-w-3xl flex-col gap-4 rounded border border-slate-200 bg-white p-4">
            <h2 className="text-base font-semibold text-slate-900">{t('import.step2Title')}</h2>
            <p className="text-sm text-slate-700">{t('import.step2Body')}</p>
            {source === 'file' && upload !== null && upload.validation.encrypted ? (
              <Callout tone="warning">
                <p>{t('import.encryptedBlocked')}</p>
              </Callout>
            ) : null}
            {createError === null ? null : <ErrorNotice error={createError} />}
            <div>
              <Button
                variant="primary"
                busy={creating}
                busyLabel={t('import.queueing')}
                disabled={queueBlocked || (source === 'file' && upload === null)}
                onClick={() => void onCreate()}
              >
                {t('import.queue')}
              </Button>
            </div>
            <p className="text-xs text-slate-600">{t('diagnostics.idempotencyNote')}</p>
          </section>
        </>
      ) : (
        <section className="flex flex-col gap-4 rounded border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-slate-900">
              {t('import.taskTitle', { taskId })}
            </h2>
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

          {task === null ? null : (
            <>
              <TaskLifecycle current={task.state} />
              {task.state === 'queued' && workerOffline ? (
                <Callout tone="warning" title={t('diagnostics.queuedNoWorkerTitle')}>
                  <p data-testid="queued-no-worker">{t('diagnostics.queuedNoWorker')}</p>
                </Callout>
              ) : null}
              {task.progress === null ? (
                terminal ? null : (
                  <p className="text-sm text-slate-700">{t('diagnostics.progressNone')}</p>
                )
              ) : (
                <ProgressBar
                  percent={task.progress.percent}
                  label={t('diagnostics.progressLabel')}
                  stage={task.progress.stage}
                />
              )}
              {task.state === 'failed' ? (
                <Callout tone="error" title={t('import.failedTitle')}>
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
                  <div>
                    <Button onClick={startOver}>{t('import.startOver')}</Button>
                  </div>
                </Callout>
              ) : null}
              {task.state === 'cancelled' ? (
                <Callout tone="warning" title={t('diagnostics.cancelledTitle')}>
                  <p>{t('diagnostics.cancelledBody')}</p>
                </Callout>
              ) : null}
            </>
          )}

          {terminal && task.state === 'succeeded' ? (
            importQuery.isPending ? (
              <div className="flex items-center gap-2 text-sm text-slate-700">
                <Spinner label={t('import.loadingReview')} />
                <span>{t('import.loadingReview')}</span>
              </div>
            ) : importQuery.data === undefined ? (
              <div className="flex flex-col gap-2">
                <ErrorNotice
                  error={importQuery.error}
                  overrideMessage={t('import.reviewLoadFailed')}
                />
                <div>
                  <Button onClick={() => void importQuery.refetch()}>{t('action.retry')}</Button>
                </div>
              </div>
            ) : profileQuery.data === undefined ? (
              profileQuery.isPending ? (
                <div className="flex items-center gap-2 text-sm text-slate-700">
                  <Spinner label={t('profile.loading')} />
                  <span>{t('profile.loading')}</span>
                </div>
              ) : (
                <ErrorNotice error={profileQuery.error} overrideMessage={t('profile.loadFailed')} />
              )
            ) : (
              <ImportReview
                importView={importQuery.data}
                profile={profileQuery.data}
                onReloadProfile={() => void profileQuery.refetch()}
                onConfirmed={(updated) => {
                  setProfile(updated);
                  navigate('/profile');
                }}
              />
            )
          ) : null}
        </section>
      )}
    </div>
  );
}

/** The API's own verdict on the upload, shown as reported — never as "clean". */
function UploadValidation({ upload }: { readonly upload: FileUploadResponse }) {
  const { t, locale } = useTranslation();
  const { validation, file } = upload;
  const scanTone =
    validation.malware_scan === 'clean'
      ? 'success'
      : validation.malware_scan === 'quarantined'
        ? 'danger'
        : 'warning';
  return (
    <Callout
      tone={validation.encrypted || !validation.signature_ok ? 'warning' : 'info'}
      title={t('import.validationTitle')}
      live
    >
      <dl className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-[14rem_1fr]">
        <dt className="font-medium">{t('import.validationFile')}</dt>
        <dd>
          {file.original_name} · {file.mime} · {formatNumber(locale, file.bytes)} B
        </dd>
        <dt className="font-medium">{t('import.validationSignature')}</dt>
        <dd data-testid="validation-signature">
          {validation.signature_ok ? t('common.yes') : t('common.no')}
        </dd>
        <dt className="font-medium">{t('import.validationExtension')}</dt>
        <dd>{validation.extension_matches_signature ? t('common.yes') : t('common.no')}</dd>
        <dt className="font-medium">{t('import.validationEncrypted')}</dt>
        <dd>{validation.encrypted ? t('common.yes') : t('common.no')}</dd>
        <dt className="font-medium">{t('import.validationScan')}</dt>
        <dd>
          <Badge tone={scanTone}>
            <span data-testid="malware-scan" data-value={validation.malware_scan}>
              {t(`malwareScan.${validation.malware_scan}`)}
            </span>
          </Badge>
        </dd>
      </dl>
      {validation.warnings.length > 0 ? (
        <ul className="list-disc pl-5 text-sm">
          {validation.warnings.map((warning, index) => (
            <li key={index}>{warning}</li>
          ))}
        </ul>
      ) : null}
    </Callout>
  );
}

function warningKey(code: ImportWarning['code']): MessageKey {
  return `importWarning.${code}`;
}

function ImportReview({
  importView,
  profile,
  onReloadProfile,
  onConfirmed,
}: {
  readonly importView: ProfileImportView;
  readonly profile: Profile;
  readonly onReloadProfile: () => void;
  readonly onConfirmed: (profile: Profile) => void;
}) {
  const api = useApi();
  const { t, locale } = useTranslation();
  const [decisions, setDecisions] = useState<Record<string, DraftDecision>>({});
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<unknown>(null);
  const [confirmEmptyOpen, setConfirmEmptyOpen] = useState(false);

  const conflictsByDraft = useMemo(() => {
    const map = new Map<string, ProfileImportView['conflicts']>();
    for (const conflict of importView.conflicts) {
      const list = map.get(conflict.draft_id) ?? [];
      list.push(conflict);
      map.set(conflict.draft_id, list);
    }
    return map;
  }, [importView.conflicts]);

  const conflictingIds = useMemo(() => new Set(conflictsByDraft.keys()), [conflictsByDraft]);
  const factsById = useMemo(
    () => new Map(profile.facts.map((fact) => [fact.id, fact])),
    [profile.facts],
  );

  const decisionFor = (draftId: string): DraftDecision => decisions[draftId] ?? NO_DECISION;
  const setDecision = (draftId: string, update: (current: DraftDecision) => DraftDecision) =>
    setDecisions((current) => ({ ...current, [draftId]: update(current[draftId] ?? NO_DECISION) }));

  const acceptedFields = buildAcceptedFields(importView.draft_facts, decisions, conflictingIds);
  const acceptedCount = acceptedFields.length;

  const confirm = async () => {
    setConfirming(true);
    setConfirmError(null);
    try {
      const updated = await api.confirmProfileImport({
        params: { id: importView.id },
        body: { expected_profile_revision: profile.revision, accepted_fields: acceptedFields },
      });
      onConfirmed(updated);
    } catch (caught) {
      // Decisions and edits are kept; a stale revision offers a reload.
      setConfirmError(caught);
    } finally {
      setConfirming(false);
    }
  };

  if (importView.status === 'confirmed') {
    return (
      <Callout tone="info" title={t('import.alreadyConfirmedTitle')}>
        <p>{t('import.alreadyConfirmedBody')}</p>
        <p>
          <Link to="/profile" className={LINK_CLASS}>
            {t('import.backToProfile')}
          </Link>
        </p>
      </Callout>
    );
  }

  if (importView.status === 'failed') {
    return (
      <Callout tone="error" title={t('import.failedTitle')}>
        {importView.error === null ? (
          <p>{t('common.notReported')}</p>
        ) : (
          <>
            <p>
              <span className="font-medium">{t('diagnostics.failureCode')}: </span>
              <code className="font-mono" data-testid="import-failure-code">
                {importView.error.code}
              </code>
            </p>
            <p>{importView.error.message}</p>
          </>
        )}
      </Callout>
    );
  }

  if (importView.status !== 'ready_for_review') {
    return (
      <Callout tone="warning">
        <p>{t('import.notReady', { status: importView.status })}</p>
      </Callout>
    );
  }

  return (
    <div className="flex flex-col gap-6" data-testid="import-review">
      <div className="flex flex-col gap-2">
        <h3 className="text-lg font-semibold text-slate-900">{t('import.reviewTitle')}</h3>
        <p className="text-sm text-slate-700">{t('import.reviewIntro')}</p>
        <p className="text-sm text-slate-700">
          {t('import.reviewCounts', {
            drafts: formatNumber(locale, importView.draft_facts.length),
            conflicts: formatNumber(locale, conflictingIds.size),
            warnings: formatNumber(locale, importView.warnings.length),
          })}
        </p>
      </div>

      {importView.warnings.length > 0 ? (
        <Callout tone="warning" title={t('import.warningsTitle')}>
          <ul className="flex flex-col gap-2">
            {importView.warnings.map((warning, index) => (
              <li key={index} data-testid="import-warning" data-code={warning.code}>
                <p>
                  <code className="font-mono text-xs">{warning.code}</code> —{' '}
                  {t(warningKey(warning.code))}
                </p>
                {/* The worker's own text, verbatim. */}
                <p className="text-xs text-slate-700">{warning.message}</p>
                {warning.detail ? <p className="text-xs text-slate-600">{warning.detail}</p> : null}
              </li>
            ))}
          </ul>
        </Callout>
      ) : null}

      {importView.draft_facts.length === 0 ? (
        <Callout tone="info" title={t('import.noDraftsTitle')}>
          <p>{t('import.noDraftsBody')}</p>
        </Callout>
      ) : (
        <ul className="flex flex-col gap-4">
          {importView.draft_facts.map((draft) => (
            <li key={draft.draft_id}>
              <DraftCard
                draft={draft}
                decision={decisionFor(draft.draft_id)}
                conflicts={conflictsByDraft.get(draft.draft_id) ?? []}
                existingFact={(id) => factsById.get(id) ?? null}
                editing={editingDraftId === draft.draft_id}
                onEdit={() => setEditingDraftId(draft.draft_id)}
                onCancelEdit={() => setEditingDraftId(null)}
                onEdited={(value) => {
                  setDecision(draft.draft_id, (current) => ({ ...current, editedValue: value }));
                  setEditingDraftId(null);
                }}
                onRevert={() =>
                  setDecision(draft.draft_id, (current) => {
                    const next: DraftDecision = {
                      accepted: current.accepted,
                      conflictChoice: current.conflictChoice,
                    };
                    return next;
                  })
                }
                onAcceptChange={(accepted) =>
                  setDecision(draft.draft_id, (current) => ({ ...current, accepted }))
                }
                onConflictChoice={(conflictChoice) =>
                  setDecision(draft.draft_id, (current) => ({ ...current, conflictChoice }))
                }
              />
            </li>
          ))}
        </ul>
      )}

      {confirmError === null ? null : (
        <div className="flex flex-col gap-2">
          <ErrorNotice error={confirmError} />
          {describeFailure(confirmError).isStale ? (
            <div>
              <Button onClick={onReloadProfile}>{t('profile.reload')}</Button>
            </div>
          ) : null}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 rounded border border-slate-200 bg-slate-50 p-3">
        <p className="text-sm text-slate-800" data-testid="accepted-count">
          {t('import.acceptedCount', {
            accepted: formatNumber(locale, acceptedCount),
            total: formatNumber(locale, importView.draft_facts.length),
          })}
        </p>
        <Button
          variant="primary"
          busy={confirming}
          busyLabel={t('import.confirming')}
          onClick={() => {
            if (acceptedCount === 0) setConfirmEmptyOpen(true);
            else void confirm();
          }}
        >
          {t('import.confirm')}
        </Button>
        <p className="text-xs text-slate-600">
          {t('import.confirmNote', { revision: profile.revision })}
        </p>
      </div>

      <Dialog
        open={confirmEmptyOpen}
        title={t('import.confirmEmptyTitle')}
        onClose={() => setConfirmEmptyOpen(false)}
        footer={
          <>
            <Button onClick={() => setConfirmEmptyOpen(false)}>{t('action.cancel')}</Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmEmptyOpen(false);
                void confirm();
              }}
            >
              {t('import.confirmEmptyAction')}
            </Button>
          </>
        }
      >
        <p>{t('import.confirmEmptyBody')}</p>
      </Dialog>
    </div>
  );
}

function DraftCard({
  draft,
  decision,
  conflicts,
  existingFact,
  editing,
  onEdit,
  onCancelEdit,
  onEdited,
  onRevert,
  onAcceptChange,
  onConflictChoice,
}: {
  readonly draft: DraftFact;
  readonly decision: DraftDecision;
  readonly conflicts: ProfileImportView['conflicts'];
  readonly existingFact: (id: string) => Profile['facts'][number] | null;
  readonly editing: boolean;
  readonly onEdit: () => void;
  readonly onCancelEdit: () => void;
  readonly onEdited: (value: unknown) => void;
  readonly onRevert: () => void;
  readonly onAcceptChange: (accepted: boolean) => void;
  readonly onConflictChoice: (choice: ConflictChoice) => void;
}) {
  const { t, locale } = useTranslation();
  const hasConflict = conflicts.length > 0;
  const accepted = isAccepted(decision, hasConflict);
  const edited = 'editedValue' in decision;
  const shown = asFactDraft(draft.kind, edited ? decision.editedValue : draft.value);

  return (
    <article
      data-testid="draft"
      data-draft-id={draft.draft_id}
      data-accepted={String(accepted)}
      className={`flex flex-col gap-3 rounded border bg-white p-4 ${
        accepted ? 'border-emerald-400' : 'border-dashed border-sky-400'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <FactStateBadge confirmed={false} />
        <Badge tone="neutral">{t(`factKind.${draft.kind}`)}</Badge>
        {edited ? <Badge tone="info">{t('import.editedBadge')}</Badge> : null}
        {hasConflict ? <Badge tone="attention">{t('import.conflictBadge')}</Badge> : null}
        {accepted ? <Badge tone="success">{t('import.acceptedBadge')}</Badge> : null}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1 rounded bg-slate-50 p-3">
          <h4 className="text-sm font-semibold text-slate-900">{t('import.sourceTitle')}</h4>
          {draft.source_excerpt === null ? (
            <p className="text-sm text-slate-600">{t('import.noExcerpt')}</p>
          ) : (
            <blockquote className="whitespace-pre-wrap border-l-2 border-slate-300 pl-2 text-sm text-slate-800">
              {draft.source_excerpt}
            </blockquote>
          )}
          <p className="text-xs text-slate-600">
            {t('import.locator')}:{' '}
            {draft.source_locator === null ? (
              t('common.notReported')
            ) : (
              <code className="font-mono">{draft.source_locator}</code>
            )}
          </p>
          <p className="text-xs text-slate-600">
            {t('import.confidence', {
              value: formatNumber(locale, Math.round(draft.confidence * 100)),
            })}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <h4 className="text-sm font-semibold text-slate-900">{t('import.proposedTitle')}</h4>
          {editing && shown !== null ? (
            <FactForm
              initial={shown}
              mode="review"
              submitLabel={t('import.applyEdit')}
              onCancel={onCancelEdit}
              onSubmit={(next) => onEdited(next.value)}
            />
          ) : shown === null ? (
            <p className="text-sm text-rose-800">{t('profile.valueUnreadable')}</p>
          ) : (
            <>
              <FactSummary draft={shown} />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={onEdit}>
                  {t('import.editValue')}
                </Button>
                {edited ? (
                  <Button size="sm" onClick={onRevert}>
                    {t('import.revertEdit')}
                  </Button>
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>

      {hasConflict ? (
        <div className="flex flex-col gap-3 rounded border border-violet-300 bg-violet-50 p-3">
          <h4 className="text-sm font-semibold text-violet-950">{t('import.conflictTitle')}</h4>
          {conflicts.map((conflict) => {
            const existing = existingFact(conflict.existing_fact_id);
            const existingDraft =
              existing === null ? null : asFactDraft(existing.kind, existing.value);
            return (
              <div
                key={conflict.existing_fact_id}
                className="flex flex-col gap-2 rounded bg-white p-3"
              >
                {/* The API's reason, verbatim. */}
                <p className="text-sm text-slate-800">{conflict.reason}</p>
                <div className="flex items-center gap-2">
                  <FactStateBadge confirmed={true} />
                  <span className="text-xs text-slate-600">
                    <code className="font-mono">{conflict.existing_fact_id}</code>
                  </span>
                </div>
                {existingDraft === null ? (
                  <p className="text-sm text-slate-600">{t('import.existingMissing')}</p>
                ) : (
                  <FactSummary draft={existingDraft} />
                )}
              </div>
            );
          })}
          <RadioGroup<ConflictChoice>
            legend={t('import.conflictLegend')}
            description={t('import.conflictDescription')}
            name={`conflict-${draft.draft_id}`}
            value={decision.conflictChoice}
            onValueChange={onConflictChoice}
            options={[
              {
                value: 'keep_existing',
                label: t('import.conflictKeep'),
                description: t('import.conflictKeepDescription'),
              },
              ...conflicts.map((conflict) => ({
                value: `replace:${conflict.existing_fact_id}` as ConflictChoice,
                label:
                  conflicts.length === 1
                    ? t('import.conflictReplace')
                    : t('import.conflictReplaceOne', { id: conflict.existing_fact_id }),
                description: t('import.conflictReplaceDescription'),
              })),
              {
                value: 'both',
                label: t('import.conflictBoth'),
                description: t('import.conflictBothDescription'),
              },
            ]}
          />
        </div>
      ) : (
        <Checkbox
          label={t('import.acceptLabel')}
          description={t('import.acceptDescription')}
          checked={decision.accepted}
          onChange={(event) => onAcceptChange(event.currentTarget.checked)}
        />
      )}
    </article>
  );
}
