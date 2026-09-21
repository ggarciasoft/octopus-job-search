import type { JobStatus, ScanStatus, SourceHealthState } from '@job-getter/contracts';
import { Badge, StatusBadge } from '@job-getter/ui';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import {
  JOB_STATUS_DESCRIPTION,
  JOB_STATUS_LABEL,
  JOB_STATUS_TONE,
  SCAN_STATUS_DESCRIPTION,
  SCAN_STATUS_LABEL,
  SCAN_STATUS_TONE,
  SOURCE_HEALTH_DESCRIPTION,
  SOURCE_HEALTH_LABEL,
  SOURCE_HEALTH_TONE,
} from '../discovery/labels';
import { useTranslation } from '../i18n/I18nProvider';

/** Source health as the API reports it; the tone never upgrades an unknown. */
export function SourceHealthBadge({ state }: { readonly state: SourceHealthState }) {
  const { t } = useTranslation();
  return (
    <Badge tone={SOURCE_HEALTH_TONE[state]} title={t(SOURCE_HEALTH_DESCRIPTION[state])}>
      <span data-testid="source-health" data-state={state}>
        {t(SOURCE_HEALTH_LABEL[state])}
      </span>
    </Badge>
  );
}

export function ScanStatusBadge({ status }: { readonly status: ScanStatus }) {
  const { t } = useTranslation();
  return (
    <Badge tone={SCAN_STATUS_TONE[status]} title={t(SCAN_STATUS_DESCRIPTION[status])}>
      <span data-testid="scan-status" data-status={status}>
        {t(SCAN_STATUS_LABEL[status])}
      </span>
    </Badge>
  );
}

export function JobStatusBadge({ status }: { readonly status: JobStatus }) {
  const { t } = useTranslation();
  return (
    <Badge tone={JOB_STATUS_TONE[status]} title={t(JOB_STATUS_DESCRIPTION[status])}>
      <span data-testid="job-status" data-status={status}>
        {t(JOB_STATUS_LABEL[status])}
      </span>
    </Badge>
  );
}

/**
 * The match column before M3. `match` is null for every job, and a null match
 * is the shared "Not checked" status from 08_UX_AND_CUSTOMIZATION.md — never a
 * score, never zero, never a dash that could read as "no match" (invariant 3).
 */
export function MatchNotChecked() {
  const { t } = useTranslation();
  return (
    <span data-testid="match-cell" data-match="not_checked">
      <StatusBadge
        status="not_checked"
        label={t('status.not_checked.label')}
        description={t('jobs.matchNotCheckedDescription')}
      />
    </span>
  );
}

export interface ExternalLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'rel'> {
  readonly href: string;
  readonly children: ReactNode;
}

/**
 * A link to a job page or board: always a new tab with `noopener noreferrer`,
 * so the destination gets neither a window handle nor this app's URL.
 */
export function ExternalLink({ href, children, className, ...rest }: ExternalLinkProps) {
  const { t } = useTranslation();
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={
        className ??
        'break-all text-sky-800 underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600'
      }
      {...rest}
    >
      {children}
      <span className="sr-only"> {t('jobDetail.opensInNewTab')}</span>
    </a>
  );
}
