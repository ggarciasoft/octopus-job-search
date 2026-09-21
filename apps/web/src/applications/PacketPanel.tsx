import type { ApplicationPacketView, PacketAnswer } from '@job-getter/contracts';
import { Badge, Callout } from '@job-getter/ui';
import { useTranslation } from '../i18n/I18nProvider';
import { formatDateTime } from '../i18n/format';
import { PROVENANCE_LABEL, STALENESS_LABEL } from './labels';

/**
 * The packet as the user reviews it: where it goes, which CV, which answers,
 * and what is still missing.
 *
 * 08_UX_AND_CUSTOMIZATION.md, "Application review": destination, CV, answers,
 * unresolved required questions, approval action. The destination is shown as
 * the whole URL rather than a friendly name, because the whole point of
 * approving is knowing exactly where this is going.
 */

function AnswerRow({ answer }: { readonly answer: PacketAnswer }) {
  const { t } = useTranslation();
  const missing = answer.answer === null;

  return (
    <li
      className="flex flex-col gap-1 border-b border-slate-200 py-2 last:border-b-0"
      data-testid="packet-answer"
      data-question={answer.question_key}
      data-missing={missing}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">{answer.label ?? answer.question_key}</span>
        <span className="flex gap-1">
          {answer.required ? <Badge tone="neutral">{t('packet.required')}</Badge> : null}
          {answer.sensitivity === 'never_reuse' ? (
            <Badge tone="attention">{t('packet.neverReuse')}</Badge>
          ) : null}
          <Badge tone="info">{t(PROVENANCE_LABEL[answer.provenance])}</Badge>
        </span>
      </div>
      {missing ? (
        <span className="text-sm text-amber-800" data-testid="answer-missing">
          {t('packet.answerMissing')}
        </span>
      ) : (
        <span className="text-sm text-slate-800" data-testid="answer-value">
          {Array.isArray(answer.answer) ? answer.answer.join(', ') : String(answer.answer)}
        </span>
      )}
    </li>
  );
}

export interface PacketPanelProps {
  readonly packet: ApplicationPacketView;
}

export function PacketPanel({ packet }: PacketPanelProps) {
  const { t, locale } = useTranslation();
  const unresolved = packet.unresolved_question_keys;

  return (
    <section className="flex flex-col gap-4" data-testid="packet-panel">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{t('packet.heading')}</h2>
        <p className="text-sm text-slate-700">
          {t('packet.revision', { revision: String(packet.revision) })}
        </p>
      </div>

      <div className="flex flex-col gap-1 rounded border border-slate-200 bg-slate-50 p-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          {t('packet.destination')}
        </span>
        {/* Shown in full. A shortened URL is a different promise. */}
        <span className="break-all text-sm" data-testid="packet-destination">
          {packet.destination.url}
        </span>
        {packet.destination.connector === null ? null : (
          <span className="text-xs text-slate-600" data-testid="packet-connector">
            {t('packet.connector', {
              connector: packet.destination.connector,
              version: packet.destination.connector_version ?? '—',
            })}
          </span>
        )}
      </div>

      {packet.staleness.length === 0 ? null : (
        <Callout tone="warning" title={t('packet.staleTitle')}>
          <ul className="list-disc pl-5" data-testid="packet-staleness">
            {packet.staleness.map((reason) => (
              <li key={reason} data-reason={reason}>
                {t(STALENESS_LABEL[reason])}
              </li>
            ))}
          </ul>
        </Callout>
      )}

      {unresolved.length === 0 ? null : (
        <Callout tone="warning" title={t('packet.unresolvedTitle')}>
          <p data-testid="packet-unresolved">
            {t('packet.unresolvedBody', { count: String(unresolved.length) })}
          </p>
        </Callout>
      )}

      <div className="flex flex-col gap-1">
        <h3 className="font-semibold">{t('packet.answersHeading')}</h3>
        {packet.answers.length === 0 ? (
          <p className="text-sm text-slate-700" data-testid="packet-no-answers">
            {t('packet.noAnswers')}
          </p>
        ) : (
          <ul className="flex flex-col">
            {packet.answers.map((answer) => (
              <AnswerRow key={answer.question_key} answer={answer} />
            ))}
          </ul>
        )}
      </div>

      <dl className="grid grid-cols-1 gap-2 text-xs text-slate-600 sm:grid-cols-2">
        <div>
          <dt className="font-semibold">{t('packet.contentHash')}</dt>
          {/* The hash the approval binds. Shown so "approve" is not a leap of
              faith about what the server thinks it is approving. */}
          <dd className="break-all font-mono" data-testid="packet-hash">
            {packet.content_hash}
          </dd>
        </div>
        <div>
          <dt className="font-semibold">{t('packet.approval')}</dt>
          <dd data-testid="packet-approval">
            {packet.approved_at === null
              ? t('packet.notApproved')
              : t('packet.approvedUntil', {
                  expires: formatDateTime(locale, packet.expires_at) ?? '',
                })}
          </dd>
        </div>
      </dl>
    </section>
  );
}
