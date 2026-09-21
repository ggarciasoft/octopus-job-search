import {
  BOARD_CONNECTOR_IDS,
  CreateSourceRequest as CreateSourceRequestSchema,
  type CreateSourceRequest,
  type SourceView,
} from '@job-getter/contracts';
import {
  Button,
  Callout,
  Checkbox,
  Dialog,
  EmptyState,
  Select,
  SkeletonRow,
  Table,
  TextField,
} from '@job-getter/ui';
import { useId, useRef, useState, type FormEvent } from 'react';
import { useApi } from '../api/ApiProvider';
import { describeFailure } from '../api/errors';
import { fieldError } from '../api/fieldErrors';
import { IdempotentIntent } from '../api/idempotency';
import { SourceHealthBadge } from '../components/DiscoveryBadges';
import { ErrorNotice } from '../components/ErrorNotice';
import { useTranslation } from '../i18n/I18nProvider';
import { formatDateTime, formatNumber } from '../i18n/format';
import { CONNECTOR_LABEL } from './labels';

type BoardConnector = (typeof BOARD_CONNECTOR_IDS)[number];

/**
 * The documented Lever EU endpoint. The API accepts `base_url` only for hosts
 * on its allow-list for the connector (`api.lever.co`, `api.eu.lever.co`), so
 * the form offers the one alternative as a toggle rather than a free URL.
 */
export const LEVER_EU_BASE_URL = 'https://api.eu.lever.co';

/** The contract's own pattern for a board key, applied before the request. */
const BOARD_KEY_PATTERN = new RegExp(CreateSourceRequestSchema.properties.board_key.pattern ?? '');

export function isScannable(source: SourceView): boolean {
  return source.enabled && source.health.state !== 'blocked';
}

export interface BoardsPanelProps {
  readonly sources: readonly SourceView[] | undefined;
  readonly isLoading: boolean;
  readonly loadError: unknown;
  /** The API reports `job_discovery: false`: every control is off with the reason. */
  readonly discoveryUnavailable: boolean;
  readonly onChanged: () => void;
  readonly onFollowScan: (scanOrTaskId: string) => void;
}

export function BoardsPanel({
  sources,
  isLoading,
  loadError,
  discoveryUnavailable,
  onChanged,
  onFollowScan,
}: BoardsPanelProps) {
  const api = useApi();
  const { t, locale } = useTranslation();
  const reasonId = useId();

  // One idempotency intent per board: a retry of "scan this board" reuses its
  // key; a different board is a different intent.
  const scanIntents = useRef(new Map<string, IdempotentIntent>());
  const [busy, setBusy] = useState<Record<string, 'scan' | 'toggle' | 'delete' | undefined>>({});
  const [rowError, setRowError] = useState<Record<string, unknown>>({});
  const [pendingDelete, setPendingDelete] = useState<SourceView | null>(null);

  const setRowBusy = (id: string, value: 'scan' | 'toggle' | 'delete' | undefined) =>
    setBusy((current) => ({ ...current, [id]: value }));
  const setError = (id: string, error: unknown) =>
    setRowError((current) => ({ ...current, [id]: error }));

  const scanNow = async (source: SourceView) => {
    let intent = scanIntents.current.get(source.id);
    if (!intent) {
      intent = new IdempotentIntent();
      scanIntents.current.set(source.id, intent);
    }
    const idempotencyKey = intent.keyFor({ source_id: source.id });
    setRowBusy(source.id, 'scan');
    setError(source.id, null);
    try {
      const accepted = await api.scanSource({ params: { id: source.id }, idempotencyKey });
      intent.complete();
      onFollowScan(accepted.task_id);
      onChanged();
    } catch (caught) {
      // Key kept: a retry is the same intent.
      setError(source.id, caught);
    } finally {
      setRowBusy(source.id, undefined);
    }
  };

  const setEnabled = async (source: SourceView, enabled: boolean) => {
    setRowBusy(source.id, 'toggle');
    setError(source.id, null);
    try {
      await api.patchSource({ params: { id: source.id }, body: { enabled } });
      onChanged();
    } catch (caught) {
      setError(source.id, caught);
    } finally {
      setRowBusy(source.id, undefined);
    }
  };

  const confirmDelete = async () => {
    if (pendingDelete === null) return;
    const source = pendingDelete;
    setRowBusy(source.id, 'delete');
    setError(source.id, null);
    try {
      await api.deleteSource({ params: { id: source.id } });
      setPendingDelete(null);
      onChanged();
    } catch (caught) {
      setError(source.id, caught);
      setPendingDelete(null);
    } finally {
      setRowBusy(source.id, undefined);
    }
  };

  const scanReason = (source: SourceView): string | null => {
    if (discoveryUnavailable) return t('discover.controlUnavailable');
    if (!source.enabled) return t('boards.scanDisabledReason');
    if (source.health.state === 'blocked') return t('boards.scanBlockedReason');
    return null;
  };

  return (
    <section className="flex flex-col gap-4 rounded border border-slate-200 bg-white p-4">
      <div>
        <h2 className="text-base font-semibold text-slate-900">{t('boards.title')}</h2>
        <p className="mt-1 text-sm text-slate-700">{t('boards.intro')}</p>
      </div>

      {loadError ? (
        <ErrorNotice error={loadError} overrideMessage={t('boards.loadFailed')} />
      ) : null}

      {isLoading || sources === undefined ? (
        loadError ? null : (
          <SkeletonRow label={t('boards.loading')} columns={6} rows={2} />
        )
      ) : (
        <Table<SourceView>
          caption={t('boards.caption')}
          captionHidden
          rows={sources}
          rowKey={(row) => row.id}
          empty={
            <EmptyState
              title={t('boards.emptyTitle')}
              body={t('boards.emptyBody')}
              suggestions={[t('boards.emptySuggestionAdd'), t('boards.emptySuggestionImport')]}
            />
          }
          columns={[
            {
              key: 'board',
              header: t('boards.columnBoard'),
              rowHeader: true,
              cell: (row) => (
                <span className="flex flex-col gap-1" data-testid={`board-${row.board_key}`}>
                  <span>{t(CONNECTOR_LABEL[row.connector])}</span>
                  {/* Board keys are identifiers the user typed: verbatim. */}
                  <code className="font-mono text-xs">{row.board_key}</code>
                  {row.base_url === null ? null : (
                    <span className="text-xs font-normal text-slate-600">
                      {t('boards.endpoint', { url: row.base_url })}
                    </span>
                  )}
                </span>
              ),
            },
            {
              key: 'health',
              header: t('boards.columnHealth'),
              cell: (row) => (
                <span className="flex flex-col items-start gap-1">
                  <SourceHealthBadge state={row.health.state} />
                  {row.health.detail === null ? null : (
                    <span className="text-xs text-slate-700">{row.health.detail}</span>
                  )}
                  {row.health.last_error_code === null ? null : (
                    <span className="text-xs text-slate-700">
                      {t('boards.lastError', { code: row.health.last_error_code })}
                    </span>
                  )}
                  {row.health.consecutive_failures > 0 ? (
                    <span className="text-xs text-slate-700">
                      {t('boards.consecutiveFailures', {
                        count: formatNumber(locale, row.health.consecutive_failures),
                      })}
                    </span>
                  ) : null}
                </span>
              ),
            },
            {
              key: 'lastSuccess',
              header: t('boards.columnLastSuccess'),
              cell: (row) =>
                formatDateTime(locale, row.last_success_at) ?? t('boards.neverSucceeded'),
            },
            {
              key: 'nextScan',
              header: t('boards.columnNextScan'),
              cell: (row) =>
                !isScannable(row)
                  ? t('boards.nextScanNotScheduled')
                  : (formatDateTime(locale, row.next_scan_after) ?? t('boards.nextScanDue')),
            },
            {
              key: 'jobs',
              header: t('boards.columnJobs'),
              cell: (row) => (
                <span data-testid="board-job-count">{formatNumber(locale, row.job_count)}</span>
              ),
            },
            {
              key: 'actions',
              header: t('boards.columnActions'),
              cell: (row) => {
                const reason = scanReason(row);
                const rowBusy = busy[row.id];
                const rowReasonId = `${reasonId}-${row.id}`;
                return (
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="primary"
                        size="sm"
                        data-testid="scan-now"
                        disabled={reason !== null || rowBusy !== undefined}
                        busy={rowBusy === 'scan'}
                        busyLabel={t('boards.scanning')}
                        aria-describedby={reason === null ? undefined : rowReasonId}
                        onClick={() => void scanNow(row)}
                      >
                        {t('boards.scanNow')}
                      </Button>
                      {row.last_scan_id === null ? null : (
                        <Button size="sm" onClick={() => onFollowScan(row.last_scan_id as string)}>
                          {t('boards.viewLastScan')}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        disabled={discoveryUnavailable || rowBusy !== undefined}
                        busy={rowBusy === 'toggle'}
                        busyLabel={t('boards.updating')}
                        onClick={() => void setEnabled(row, !row.enabled)}
                      >
                        {row.enabled
                          ? row.health.state === 'blocked'
                            ? t('boards.reenable')
                            : t('boards.disable')
                          : t('boards.enable')}
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={discoveryUnavailable || rowBusy !== undefined}
                        onClick={() => setPendingDelete(row)}
                      >
                        {t('boards.delete')}
                      </Button>
                    </div>
                    {reason === null ? null : (
                      <p
                        id={rowReasonId}
                        className="text-xs text-slate-700"
                        data-testid="scan-reason"
                      >
                        {reason}
                      </p>
                    )}
                    {rowError[row.id] ? (
                      <ErrorNotice
                        error={rowError[row.id]}
                        overrideMessage={t('boards.actionFailed', { boardKey: row.board_key })}
                      />
                    ) : null}
                  </div>
                );
              },
            },
          ]}
        />
      )}

      <AddBoardForm disabled={discoveryUnavailable} onAdded={onChanged} />

      <Dialog
        open={pendingDelete !== null}
        title={t('boards.deleteTitle')}
        onClose={() => setPendingDelete(null)}
        footer={
          <>
            <Button onClick={() => setPendingDelete(null)}>{t('action.cancel')}</Button>
            <Button
              variant="danger"
              busy={pendingDelete !== null && busy[pendingDelete.id] === 'delete'}
              busyLabel={t('boards.deleting')}
              onClick={() => void confirmDelete()}
            >
              {t('boards.deleteConfirm')}
            </Button>
          </>
        }
      >
        {pendingDelete === null ? null : (
          <p data-testid="delete-body">
            {t('boards.deleteBody', {
              connector: t(CONNECTOR_LABEL[pendingDelete.connector]),
              boardKey: pendingDelete.board_key,
            })}
          </p>
        )}
      </Dialog>
    </section>
  );
}

interface AddBoardFormProps {
  readonly disabled: boolean;
  readonly onAdded: () => void;
}

function AddBoardForm({ disabled, onAdded }: AddBoardFormProps) {
  const api = useApi();
  const { t } = useTranslation();
  const [connector, setConnector] = useState<BoardConnector>('greenhouse');
  const [boardKey, setBoardKey] = useState('');
  const [leverEu, setLeverEu] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [added, setAdded] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = boardKey.trim();
    if (trimmed === '') {
      setKeyError(t('addBoard.boardKeyRequired'));
      return;
    }
    if (!BOARD_KEY_PATTERN.test(trimmed)) {
      setKeyError(t('addBoard.boardKeyPattern'));
      return;
    }
    setKeyError(null);
    const body: CreateSourceRequest = {
      connector,
      board_key: trimmed,
      ...(connector === 'lever' && leverEu ? { base_url: LEVER_EU_BASE_URL } : {}),
    };
    setSubmitting(true);
    setSubmitError(null);
    setAdded(null);
    try {
      const created = await api.createSource({ body });
      setAdded(created.board_key);
      setBoardKey('');
      setLeverEu(false);
      onAdded();
    } catch (caught) {
      // The typed key stays: the notice says so.
      setSubmitError(caught);
    } finally {
      setSubmitting(false);
    }
  };

  const serverFields = submitError === null ? {} : describeFailure(submitError).fields;

  return (
    <form
      className="flex flex-col gap-3 rounded border border-slate-200 bg-slate-50 p-3"
      onSubmit={(event) => void onSubmit(event)}
      aria-labelledby="add-board-title"
    >
      <h3 id="add-board-title" className="text-sm font-semibold text-slate-900">
        {t('addBoard.title')}
      </h3>
      {disabled ? (
        <Callout tone="warning" live={false}>
          <p>{t('discover.controlUnavailable')}</p>
        </Callout>
      ) : null}
      <Select
        label={t('addBoard.connector')}
        value={connector}
        disabled={disabled}
        options={BOARD_CONNECTOR_IDS.map((id) => ({ value: id, label: t(CONNECTOR_LABEL[id]) }))}
        onChange={(event) => {
          setConnector(event.currentTarget.value as BoardConnector);
          setLeverEu(false);
        }}
      />
      <TextField
        label={t('addBoard.boardKey')}
        description={connector === 'lever' ? t('addBoard.leverHelp') : t('addBoard.greenhouseHelp')}
        value={boardKey}
        required
        disabled={disabled}
        error={keyError ?? fieldError(serverFields, 'board_key')}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => setBoardKey(event.currentTarget.value)}
      />
      {connector === 'lever' ? (
        <Checkbox
          label={t('addBoard.leverEu')}
          description={t('addBoard.leverEuDescription', { url: LEVER_EU_BASE_URL })}
          checked={leverEu}
          disabled={disabled}
          error={fieldError(serverFields, 'base_url')}
          onChange={(event) => setLeverEu(event.currentTarget.checked)}
        />
      ) : null}
      {submitError === null ? null : <ErrorNotice error={submitError} />}
      {added === null ? null : (
        <Callout tone="success" live>
          <p>{t('addBoard.added', { boardKey: added })}</p>
        </Callout>
      )}
      <div>
        <Button
          type="submit"
          variant="primary"
          disabled={disabled}
          busy={submitting}
          busyLabel={t('addBoard.submitting')}
        >
          {t('addBoard.submit')}
        </Button>
      </div>
    </form>
  );
}
