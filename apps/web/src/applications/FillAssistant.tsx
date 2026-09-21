import type { ApplicationView, DeviceView } from '@job-getter/contracts';
import { Badge, Button, Callout, Select } from '@job-getter/ui';
import { Link } from 'react-router-dom';
import { useTranslation } from '../i18n/I18nProvider';
import { DEVICE_STATUS_LABEL, DEVICE_STATUS_TONE, UNRESOLVED_REASON_LABEL } from './labels';

/**
 * Fill assistant (08_UX_AND_CUSTOMIZATION.md): connected device, filled and
 * missing fields, pause and manual steps, final-submit reminder.
 *
 * The final-submit reminder is not a courtesy. The runner stops with the form
 * filled and waiting, and if this screen did not say so plainly a user could
 * reasonably believe the application had been sent. It is shown in every state
 * where a browser has touched the form, not only on success.
 *
 * When there is no paired runner this panel says what to install and does not
 * render a fill button. A button that 422s is worse than no button.
 */

export interface FillAssistantProps {
  readonly application: ApplicationView;
  readonly devices: readonly DeviceView[];
  readonly selectedDeviceId: string;
  readonly onSelectDevice: (id: string) => void;
  readonly onFill: () => void;
  readonly filling: boolean;
}

export function FillAssistant({
  application,
  devices,
  selectedDeviceId,
  onSelectDevice,
  onFill,
  filling,
}: FillAssistantProps) {
  const { t } = useTranslation();
  const runners = devices.filter(
    (device) => device.kind === 'local_runner' && device.status === 'paired',
  );
  const packet = application.current_packet;
  const canFill =
    application.status === 'approved' &&
    packet !== null &&
    packet.staleness.length === 0 &&
    packet.unresolved_question_keys.length === 0 &&
    runners.length > 0;

  return (
    <section className="flex flex-col gap-3" data-testid="fill-assistant">
      <h2 className="text-lg font-semibold">{t('fill.heading')}</h2>

      {runners.length === 0 ? (
        <Callout tone="info" title={t('fill.noRunnerTitle')}>
          <p data-testid="fill-no-runner">{t('fill.noRunnerBody')}</p>
          <p className="mt-2">
            <Link className="underline" to="/settings/devices">
              {t('fill.pairLink')}
            </Link>
          </p>
        </Callout>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <Select
            label={t('fill.device')}
            value={selectedDeviceId}
            options={runners.map((device) => ({
              value: device.id,
              label: `${device.label} (${device.device_public_id ?? '—'})`,
            }))}
            onChange={(event) => onSelectDevice(event.currentTarget.value)}
          />
          <Button type="button" onClick={onFill} disabled={!canFill || filling}>
            {filling ? t('fill.starting') : t('fill.start')}
          </Button>
          {runners.map((device) => (
            <Badge key={device.id} tone={DEVICE_STATUS_TONE[device.status]}>
              {t(DEVICE_STATUS_LABEL[device.status])}
            </Badge>
          ))}
        </div>
      )}

      {application.status === 'filling' ? (
        <Callout tone="info" title={t('fill.inProgressTitle')}>
          <p data-testid="fill-in-progress">{t('fill.inProgressBody')}</p>
        </Callout>
      ) : null}

      {application.status === 'awaiting_user_submit' ? (
        // The whole product stops here, deliberately and permanently.
        <Callout tone="warning" title={t('fill.awaitingSubmitTitle')}>
          <p data-testid="fill-awaiting-submit">{t('fill.awaitingSubmitBody')}</p>
        </Callout>
      ) : null}

      {application.status === 'needs_input' && packet !== null ? (
        <Callout tone="warning" title={t('fill.pausedTitle')}>
          <p data-testid="fill-paused">{t('fill.pausedBody')}</p>
          <ul className="mt-2 list-disc pl-5">
            {packet.unresolved_question_keys.map((key) => (
              <li key={key} data-testid="fill-unresolved" data-question={key}>
                {packet.answers.find((answer) => answer.question_key === key)?.label ?? key}
              </li>
            ))}
          </ul>
        </Callout>
      ) : null}

      <p className="text-xs text-slate-600" data-testid="fill-never-submits">
        {t('fill.neverSubmits')}
      </p>

      {/* Kept visible rather than only shown on the unsupported path: the
          reasons a field can go unfilled are the same reasons a user has to
          check the form themselves before pressing submit. */}
      <details className="text-xs text-slate-600">
        <summary className="cursor-pointer">{t('fill.reasonsSummary')}</summary>
        <ul className="mt-1 list-disc pl-5">
          {(Object.keys(UNRESOLVED_REASON_LABEL) as (keyof typeof UNRESOLVED_REASON_LABEL)[]).map(
            (reason) => (
              <li key={reason}>{t(UNRESOLVED_REASON_LABEL[reason])}</li>
            ),
          )}
        </ul>
      </details>
    </section>
  );
}
