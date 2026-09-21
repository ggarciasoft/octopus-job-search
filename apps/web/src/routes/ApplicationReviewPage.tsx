import type { ApplicationView, PacketAnswer, ResumeView } from '@job-getter/contracts';
import { Badge, Button, Callout, Select, Spinner } from '@job-getter/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApi } from '../api/ApiProvider';
import { IdempotentIntent } from '../api/idempotency';
import { ErrorNotice } from '../components/ErrorNotice';
import { useTranslation } from '../i18n/I18nProvider';
import { AnswerEditor, toDraft, type DraftAnswer } from '../applications/AnswerEditor';
import { EventTimeline } from '../applications/EventTimeline';
import { FillAssistant } from '../applications/FillAssistant';
import { PacketPanel } from '../applications/PacketPanel';
import {
  APPLICATION_STATUS_DESCRIPTION,
  APPLICATION_STATUS_LABEL,
  APPLICATION_STATUS_TONE,
} from '../applications/labels';

/**
 * Application review (M4, PR08/PR09).
 *
 * The screen where a person decides to send something to an employer, so the
 * rules are about what it refuses to make easy:
 *
 *  * **Approving is its own act.** Saving a packet and approving one are two
 *    buttons, and the approval quotes the content hash the screen displayed.
 *    If the packet moved underneath, the server refuses and the user reads the
 *    new one.
 *  * **Staleness is shown, not smoothed over.** A withdrawn approval says which
 *    of the profile, job, CV, destination or form changed.
 *  * **Nothing here submits.** The furthest this screen can take an application
 *    is a filled form waiting for the person, and the fill panel says so in
 *    every state.
 */
export function ApplicationReviewPage() {
  const api = useApi();
  const { t } = useTranslation();
  const { id = '' } = useParams<{ id: string }>();

  const [resumeId, setResumeId] = useState('');
  const [drafts, setDrafts] = useState<readonly DraftAnswer[]>([]);
  const [loadedPacketId, setLoadedPacketId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [filling, setFilling] = useState(false);
  const [deviceId, setDeviceId] = useState('');
  const [actionError, setActionError] = useState<unknown>(null);
  const packetIntent = useRef(new IdempotentIntent());
  const fillIntent = useRef(new IdempotentIntent());

  const applicationQuery = useQuery({
    queryKey: ['application', id],
    queryFn: ({ signal }) => api.getApplication({ params: { id }, signal }),
    enabled: id !== '',
  });
  const application: ApplicationView | undefined = applicationQuery.data;

  const eventsQuery = useQuery({
    queryKey: ['application-events', id],
    queryFn: ({ signal }) => api.listApplicationEvents({ params: { id }, signal }),
    enabled: id !== '',
  });

  const bankQuery = useQuery({
    queryKey: ['answer-bank'],
    queryFn: ({ signal }) => api.listAnswerBank({ query: { limit: 100 }, signal }),
  });

  const devicesQuery = useQuery({
    queryKey: ['devices'],
    queryFn: ({ signal }) => api.listDevices({ signal }),
  });

  // Load the current packet's answers into the editor once per packet. A
  // dependency on the packet *id* rather than on the object means the user's
  // in-progress edits survive a refetch that changed nothing.
  const packetId = application?.current_packet?.id ?? null;
  useEffect(() => {
    if (packetId === loadedPacketId) return;
    setLoadedPacketId(packetId);
    setDrafts((application?.current_packet?.answers ?? []).map(toDraft));
    if (application?.current_packet !== null && application?.current_packet !== undefined) {
      setResumeId(application.current_packet.resume_id);
    }
  }, [packetId, loadedPacketId, application]);

  const devices = devicesQuery.data?.items ?? [];
  useEffect(() => {
    const runner = devices.find(
      (device) => device.kind === 'local_runner' && device.status === 'paired',
    );
    if (deviceId === '' && runner !== undefined) setDeviceId(runner.id);
  }, [devices, deviceId]);

  const refresh = async () => {
    await Promise.all([applicationQuery.refetch(), eventsQuery.refetch()]);
  };

  const savePacket = async () => {
    if (application === undefined) return;
    setSaving(true);
    setActionError(null);
    try {
      // "Remember this answer" is a separate, explicit act, and it happens
      // before the packet so the entry exists to be cited.
      for (const draft of drafts) {
        if (!draft.remember || draft.answer === null) continue;
        await api.putAnswerBankEntry({
          body: {
            question_key: draft.question_key,
            label: draft.label,
            answer: draft.answer,
            sensitivity: draft.sensitivity,
            confirmed: true,
          },
        });
      }

      const answers: PacketAnswer[] = drafts.map(({ remember: _remember, ...answer }) => answer);
      const body = {
        expected_revision: application.revision,
        resume_id: resumeId,
        answers,
      };
      await api.createApplicationPacket({
        params: { id: application.id },
        body,
        idempotencyKey: packetIntent.current.keyFor(body),
      });
      packetIntent.current.complete();
      await refresh();
      await bankQuery.refetch();
    } catch (caught) {
      setActionError(caught);
    } finally {
      setSaving(false);
    }
  };

  const approve = async () => {
    if (application?.current_packet == null) return;
    setApproving(true);
    setActionError(null);
    try {
      await api.approveApplication({
        params: { id: application.id },
        body: {
          expected_revision: application.revision,
          packet_id: application.current_packet.id,
          // The hash this screen displayed. If the packet moved, the server
          // refuses rather than approving whatever it holds now.
          content_hash: application.current_packet.content_hash,
        },
      });
      await refresh();
    } catch (caught) {
      setActionError(caught);
    } finally {
      setApproving(false);
    }
  };

  const startFill = async () => {
    if (application?.current_packet == null || deviceId === '') return;
    setFilling(true);
    setActionError(null);
    try {
      const body = {
        expected_revision: application.revision,
        packet_id: application.current_packet.id,
        device_id: deviceId,
      };
      await api.fillApplication({
        params: { id: application.id },
        body,
        idempotencyKey: fillIntent.current.keyFor(body),
      });
      fillIntent.current.complete();
      await refresh();
    } catch (caught) {
      setActionError(caught);
    } finally {
      setFilling(false);
    }
  };

  if (applicationQuery.isPending) return <Spinner label={t('common.loading')} />;
  if (application === undefined) {
    return <ErrorNotice error={applicationQuery.error} />;
  }

  const packet = application.current_packet;
  const canApprove =
    application.status === 'ready_for_review' &&
    packet !== null &&
    packet.staleness.length === 0 &&
    packet.unresolved_question_keys.length === 0;

  return (
    <div className="flex flex-col gap-6" data-testid="application-review">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">
          {application.title} — {application.company}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={APPLICATION_STATUS_TONE[application.status]}>
            {t(APPLICATION_STATUS_LABEL[application.status])}
          </Badge>
          <span className="text-sm text-slate-700" data-testid="status-description">
            {t(APPLICATION_STATUS_DESCRIPTION[application.status])}
          </span>
        </div>
        <Link className="text-sm underline" to={`/jobs/${application.job_id}`}>
          {t('review.viewJob')}
        </Link>
      </header>

      {application.possible_duplicate_application_ids.length === 0 ? null : (
        <Callout tone="warning" title={t('review.duplicateTitle')}>
          <p data-testid="duplicate-warning">
            {t('review.duplicateBody', {
              count: String(application.possible_duplicate_application_ids.length),
            })}
          </p>
          <ul className="mt-2 list-disc pl-5">
            {application.possible_duplicate_application_ids.map((other) => (
              <li key={other}>
                <Link className="underline" to={`/applications/${other}`}>
                  {other}
                </Link>
              </li>
            ))}
          </ul>
        </Callout>
      )}

      {actionError === null ? null : <ErrorNotice error={actionError} />}

      {packet === null ? (
        <Callout tone="info" title={t('review.noPacketTitle')}>
          <p data-testid="no-packet">{t('review.noPacketBody')}</p>
        </Callout>
      ) : (
        <PacketPanel packet={packet} />
      )}

      <section className="flex flex-col gap-4 rounded border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold">{t('review.buildHeading')}</h2>
        <p className="text-sm text-slate-700">{t('review.buildIntro')}</p>

        <ResumeChooser jobId={application.job_id} value={resumeId} onChange={setResumeId} />

        <AnswerEditor
          answers={drafts}
          bank={bankQuery.data?.items ?? []}
          disabled={saving}
          onChange={setDrafts}
        />

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            onClick={() => void savePacket()}
            disabled={saving || resumeId === ''}
          >
            {saving ? t('review.saving') : t('review.savePacket')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void approve()}
            disabled={!canApprove || approving}
          >
            {approving ? t('review.approving') : t('review.approve')}
          </Button>
        </div>
        <p className="text-xs text-slate-600" data-testid="approve-notice">
          {t('review.approveNotice')}
        </p>
      </section>

      <FillAssistant
        application={application}
        devices={devices}
        selectedDeviceId={deviceId}
        onSelectDevice={setDeviceId}
        onFill={() => void startFill()}
        filling={filling}
      />

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t('review.historyHeading')}</h2>
        <EventTimeline events={eventsQuery.data?.items ?? []} />
      </section>
    </div>
  );
}

/**
 * Which CV to send.
 *
 * Only finished CVs are listed, and only ones this job can use: a CV tailored
 * for another posting is refused by the server, so offering it here would be
 * offering a choice that cannot be made. Each option says which kind it is,
 * because "my own file, unchanged" and "generated for this job" are the two
 * genuinely different things a person might mean by "my CV".
 */
function ResumeChooser({
  jobId,
  value,
  onChange,
}: {
  readonly jobId: string;
  readonly value: string;
  readonly onChange: (id: string) => void;
}) {
  const api = useApi();
  const { t } = useTranslation();

  const query = useQuery({
    queryKey: ['resumes', jobId],
    queryFn: ({ signal }) =>
      api.listResumes({ query: { job_id: jobId, status: 'ready', limit: 100 }, signal }),
  });
  const resumes: readonly ResumeView[] = query.data?.items ?? [];

  if (resumes.length === 0) {
    return (
      <Callout tone="info" title={t('review.noResumeTitle')}>
        <p data-testid="no-resume">{t('review.noResumeBody')}</p>
        <p className="mt-2">
          <Link className="underline" to="/cv-studio">
            {t('review.cvStudioLink')}
          </Link>
        </p>
      </Callout>
    );
  }

  return (
    <Select
      label={t('review.resume')}
      description={t('review.resumeDescription')}
      value={value}
      placeholder={t('review.resumeChoose')}
      options={resumes.map((resume) => ({
        value: resume.id,
        label:
          resume.mode === 'original'
            ? t('review.resumeOriginal', { created: resume.created_at.slice(0, 10) })
            : t('review.resumeTailored', { created: resume.created_at.slice(0, 10) }),
      }))}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  );
}
