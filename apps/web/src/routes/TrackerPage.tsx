import {
  isOutcomeAllowedFrom,
  type ApplicationOutcome,
  type ApplicationView,
  type EvidenceType,
} from '@job-getter/contracts';
import {
  Badge,
  Button,
  Callout,
  EmptyState,
  Select,
  Spinner,
  TextArea,
  TextField,
} from '@job-getter/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../api/ApiProvider';
import { ErrorNotice } from '../components/ErrorNotice';
import { useTranslation } from '../i18n/I18nProvider';
import { formatDateTime } from '../i18n/format';
import {
  APPLICATION_STATUS_LABEL,
  APPLICATION_STATUS_TONE,
  EVIDENCE_TYPE_LABEL,
  submittedLabel,
} from '../applications/labels';

/**
 * Tracker (M4, PR10): where every application stands, what it is based on, and
 * what the user says happened.
 *
 * The distinction this screen exists to preserve is the one
 * 08_UX_AND_CUSTOMIZATION.md spells out: "Submitted—verified" and
 * "Submitted—reported by you" are different sentences. A submission the runner
 * watched land and one the user told us about look identical in a database row
 * and are not the same claim, so the badge says which.
 *
 * Recording an outcome asks how you know. There is no control here that
 * records a submission without evidence, and `adapter_observed` is not offered
 * at all: only a paired runner ever sees a confirmation page, and a dropdown
 * that let a person claim otherwise would be a dropdown for manufacturing
 * verification.
 */

/**
 * What the user can report. Each row offers only the ones legal from its
 * current status - a draft offers "submitted" (you applied on your own) and
 * "cancelled", nothing else - and the server checks again.
 */
const OUTCOMES: readonly ApplicationOutcome[] = [
  // Ordered by what usually happens next, because the first one legal from a
  // row's status is what its form starts on: a submitted row should start on
  // "interview", not on "I cannot tell whether it went through".
  'submitted',
  'interview',
  'rejected',
  'offer',
  'withdrawn',
  'outcome_unknown',
  'not_submitted',
  'cancelled',
];

/**
 * "It was never submitted" answers an uncertain submission and nothing else.
 * The machine also lets other pre-submission states return to `preparing`,
 * but offering that sentence on a packet nobody tried to send would be asking
 * the wrong question.
 */
function offers(application: ApplicationView, outcome: ApplicationOutcome): boolean {
  if (outcome === 'not_submitted' && application.status !== 'outcome_unknown') return false;
  return isOutcomeAllowedFrom(application.status, outcome);
}

const OUTCOME_LABEL: Record<ApplicationOutcome, string> = {
  submitted: 'outcome.submitted',
  not_submitted: 'outcome.notSubmitted',
  outcome_unknown: 'outcome.unknown',
  interview: 'outcome.interview',
  rejected: 'outcome.rejected',
  offer: 'outcome.offer',
  withdrawn: 'outcome.withdrawn',
  cancelled: 'outcome.cancelled',
};

function StatusBadge({ application }: { readonly application: ApplicationView }) {
  const { t } = useTranslation();
  if (application.status === 'submitted') {
    const evidence = application.submission_evidence?.evidence_type ?? null;
    return (
      <Badge tone={evidence === 'adapter_observed' ? 'success' : 'info'}>
        {t(submittedLabel(evidence))}
      </Badge>
    );
  }
  return (
    <Badge tone={APPLICATION_STATUS_TONE[application.status]}>
      {t(APPLICATION_STATUS_LABEL[application.status])}
    </Badge>
  );
}

function OutcomeForm({
  application,
  onRecorded,
}: {
  readonly application: ApplicationView;
  readonly onRecorded: () => Promise<void>;
}) {
  const api = useApi();
  const { t } = useTranslation();
  const allowed = OUTCOMES.filter((value) => offers(application, value));
  const [outcome, setOutcome] = useState<ApplicationOutcome>(allowed[0] ?? 'submitted');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // Always `user_report`, and the panel says so. Only a paired runner ever
  // loads an employer's confirmation page, so a person filling this in is
  // reporting, never verifying; the server refuses `adapter_observed` from a
  // browser session anyway, and offering it here would be offering a lie.
  const evidenceType: EvidenceType = 'user_report';

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.recordApplicationOutcome({
        params: { id: application.id },
        body: {
          expected_revision: application.revision,
          outcome,
          evidence_type: evidenceType,
          evidence: {
            reference: reference === '' ? null : reference,
            note: note === '' ? null : note,
          },
        },
      });
      setReference('');
      setNote('');
      await onRecorded();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2" data-testid="outcome-form">
      <div className="flex flex-wrap items-end gap-2">
        <Select
          label={t('tracker.outcomeLabel')}
          value={outcome}
          options={allowed.map((value) => ({
            value,
            label: t(OUTCOME_LABEL[value] as never),
          }))}
          onChange={(event) => setOutcome(event.currentTarget.value as ApplicationOutcome)}
        />
        <TextField
          label={t('tracker.reference')}
          description={t('tracker.referenceDescription')}
          value={reference}
          onChange={(event) => setReference(event.currentTarget.value)}
        />
      </div>
      <TextArea
        label={t('tracker.note')}
        rows={2}
        value={note}
        onChange={(event) => setNote(event.currentTarget.value)}
      />
      <p className="text-xs text-slate-600" data-testid="evidence-notice">
        {t('tracker.evidenceNotice', { evidence: t(EVIDENCE_TYPE_LABEL[evidenceType]) })}
      </p>
      {error === null ? null : <ErrorNotice error={error} />}
      <div>
        <Button type="button" onClick={() => void submit()} disabled={busy}>
          {busy ? t('tracker.recording') : t('tracker.record')}
        </Button>
      </div>
    </div>
  );
}

export function TrackerPage() {
  const api = useApi();
  const { t, locale } = useTranslation();

  const query = useQuery({
    queryKey: ['applications', 'tracker'],
    queryFn: ({ signal }) => api.listApplications({ query: { limit: 100 }, signal }),
  });

  const applications = query.data?.items ?? [];

  return (
    <div className="flex flex-col gap-6" data-testid="tracker-page">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{t('tracker.title')}</h1>
        <p className="max-w-3xl text-sm text-slate-700">{t('tracker.intro')}</p>
      </header>

      <Callout tone="info" live={false} title={t('tracker.evidenceTitle')}>
        <p>{t('tracker.evidenceBody')}</p>
      </Callout>

      {query.isError ? <ErrorNotice error={query.error} /> : null}

      {query.isPending ? (
        <Spinner label={t('common.loading')} />
      ) : applications.length === 0 ? (
        <EmptyState
          title={t('tracker.emptyTitle')}
          body={t('tracker.emptyBody')}
          suggestions={[
            <Link key="applications" className="underline" to="/applications">
              {t('tracker.emptySuggestion')}
            </Link>,
          ]}
        />
      ) : (
        <ul className="flex flex-col gap-4">
          {applications.map((application) => (
            <li
              key={application.id}
              className="flex flex-col gap-3 rounded border border-slate-200 bg-white p-4"
              data-testid="tracker-row"
              data-status={application.status}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link className="font-medium underline" to={`/applications/${application.id}`}>
                  {application.title} — {application.company}
                </Link>
                <StatusBadge application={application} />
              </div>

              {application.submitted_at === null ? null : (
                <p className="text-sm text-slate-700" data-testid="tracker-submitted-at">
                  {t('tracker.submittedAt', {
                    when: formatDateTime(locale, application.submitted_at) ?? '',
                  })}
                </p>
              )}

              {application.submission_evidence === null ? null : (
                <dl
                  className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2"
                  data-testid="tracker-evidence"
                >
                  <div>
                    <dt className="text-xs font-semibold uppercase text-slate-600">
                      {t('tracker.evidenceKind')}
                    </dt>
                    <dd>{t(EVIDENCE_TYPE_LABEL[application.submission_evidence.evidence_type])}</dd>
                  </div>
                  {application.submission_evidence.reference === null ? null : (
                    <div>
                      <dt className="text-xs font-semibold uppercase text-slate-600">
                        {t('tracker.reference')}
                      </dt>
                      <dd>{application.submission_evidence.reference}</dd>
                    </div>
                  )}
                  {application.submission_evidence.note === null ? null : (
                    <div className="sm:col-span-2">
                      <dt className="text-xs font-semibold uppercase text-slate-600">
                        {t('tracker.note')}
                      </dt>
                      <dd>{application.submission_evidence.note}</dd>
                    </div>
                  )}
                </dl>
              )}

              {OUTCOMES.some((value) => offers(application, value)) ? (
                <OutcomeForm
                  // Keyed on status so the selection resets to a legal
                  // outcome once the row moves on.
                  key={application.status}
                  application={application}
                  onRecorded={async () => {
                    await query.refetch();
                  }}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
