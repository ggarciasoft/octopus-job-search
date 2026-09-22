import type { DeviceKind, DeviceView } from '@job-getter/contracts';
import { Badge, Button, Callout, EmptyState, RadioGroup, TextField } from '@job-getter/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useApi } from '../../api/ApiProvider';
import { ErrorNotice } from '../../components/ErrorNotice';
import { useTranslation } from '../../i18n/I18nProvider';
import { formatDateTime } from '../../i18n/format';
import { DEVICE_STATUS_LABEL, DEVICE_STATUS_TONE } from '../../applications/labels';

/**
 * Settings → Devices (M4).
 *
 * Pairing a device is the act of handing a process outside this browser the
 * ability to act on the workspace, so the screen is built to make that visible
 * rather than quick:
 *
 *  * **The code is shown once and never again.** The server keeps a digest, so
 *    there is nothing to show a second time and the panel says so instead of
 *    offering a "show code" control that could not work.
 *  * **Revoking is immediate and irreversible.** The row stays, marked revoked,
 *    because a device that was once trusted is part of the history.
 *  * **The token is never displayed here at all.** It is transmitted once, to
 *    the runner or the extension, in exchange for the code.
 *
 * The kind is chosen here rather than guessed later because the API holds the
 * two to different routes: only an `extension` may open a fill session, and
 * only a `local_runner` is given work through the task queue.
 */
export function DevicesPage() {
  const api = useApi();
  const { t, locale } = useTranslation();
  const [kind, setKind] = useState<DeviceKind>('extension');
  const [label, setLabel] = useState('');
  const [origins, setOrigins] = useState('');
  const [code, setCode] = useState<{ value: string; kind: DeviceKind } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const devicesQuery = useQuery({
    queryKey: ['devices'],
    queryFn: ({ signal }) => api.listDevices({ signal }),
  });

  const pair = async () => {
    setBusy(true);
    setError(null);
    try {
      const parsed = origins
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value !== '');
      const response = await api.createDevicePairing({
        body: {
          device_kind: kind,
          label: label.trim(),
          ...(parsed.length === 0 ? {} : { allowed_origins: parsed }),
        },
      });
      setCode({ value: response.pairing_code, kind });
      setLabel('');
      setOrigins('');
      await devicesQuery.refetch();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (device: DeviceView) => {
    setBusy(true);
    setError(null);
    try {
      await api.revokeDevice({ params: { id: device.id } });
      await devicesQuery.refetch();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  const devices = devicesQuery.data?.items ?? [];

  return (
    <div className="flex flex-col gap-6" data-testid="devices-page">
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t('devices.title')}</h2>
        <p className="max-w-3xl text-sm text-slate-700">{t('devices.intro')}</p>
      </section>

      <section className="flex flex-col gap-3 rounded border border-slate-200 bg-white p-4">
        <h3 className="font-semibold">{t('devices.pairHeading')}</h3>
        <RadioGroup<DeviceKind>
          legend={t('devices.kind')}
          name="device-kind"
          value={kind}
          onValueChange={setKind}
          options={[
            {
              value: 'extension',
              label: t('devices.kind.extension'),
              description: t('devices.kind.extensionDescription'),
            },
            {
              value: 'local_runner',
              label: t('devices.kind.localRunner'),
              description: t('devices.kind.localRunnerDescription'),
            },
          ]}
        />
        <TextField
          label={t('devices.label')}
          description={t('devices.labelDescription')}
          value={label}
          onChange={(event) => setLabel(event.currentTarget.value)}
        />
        <TextField
          label={t('devices.origins')}
          description={t('devices.originsDescription')}
          value={origins}
          onChange={(event) => setOrigins(event.currentTarget.value)}
        />
        <div>
          <Button type="button" onClick={() => void pair()} disabled={busy || label.trim() === ''}>
            {busy ? t('devices.pairing') : t('devices.pair')}
          </Button>
        </div>

        {code === null ? null : (
          <Callout tone="warning" title={t('devices.codeTitle')}>
            <p>{t('devices.codeBody')}</p>
            <p className="mt-2 break-all font-mono text-lg" data-testid="pairing-code">
              {code.value}
            </p>
            <p className="mt-2 text-sm" data-testid="pairing-instructions">
              {code.kind === 'extension'
                ? // The extension talks to the same origin this page came
                  // from; nginx proxies `/api` behind it.
                  t('devices.codeExtension', { address: window.location.origin })
                : t('devices.codeCommand')}
            </p>
          </Callout>
        )}
      </section>

      {error === null ? null : <ErrorNotice error={error} />}
      {devicesQuery.isError ? <ErrorNotice error={devicesQuery.error} /> : null}

      <section className="flex flex-col gap-2">
        <h3 className="font-semibold">{t('devices.listHeading')}</h3>
        {devices.length === 0 ? (
          <EmptyState title={t('devices.emptyTitle')} body={t('devices.emptyBody')} />
        ) : (
          <ul className="flex flex-col gap-2">
            {devices.map((device) => (
              <li
                key={device.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded border border-slate-200 bg-white p-3"
                data-testid="device-row"
                data-status={device.status}
              >
                <div className="flex flex-col">
                  <span className="font-medium">{device.label}</span>
                  <span className="text-xs text-slate-600">
                    {device.device_public_id ?? t('devices.notYetPaired')}
                  </span>
                  {device.allowed_origins.length === 0 ? null : (
                    <span className="text-xs text-slate-600" data-testid="device-origins">
                      {device.allowed_origins.join(', ')}
                    </span>
                  )}
                  {device.expires_at === null ? null : (
                    <span className="text-xs text-slate-600">
                      {t('devices.expires', {
                        when: formatDateTime(locale, device.expires_at) ?? '',
                      })}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={DEVICE_STATUS_TONE[device.status]}>
                    {t(DEVICE_STATUS_LABEL[device.status])}
                  </Badge>
                  {device.status === 'revoked' ? null : (
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      onClick={() => void revoke(device)}
                      disabled={busy}
                    >
                      {t('devices.revoke')}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
