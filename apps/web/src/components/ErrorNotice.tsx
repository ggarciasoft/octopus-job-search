import { Callout } from '@job-getter/ui';
import { describeFailure, serverMessage } from '../api/errors';
import { useTranslation } from '../i18n/I18nProvider';

export interface ErrorNoticeProps {
  readonly error: unknown;
  /** Rendered instead of the mapped message when the screen knows better. */
  readonly overrideMessage?: string;
  /**
   * Suppresses the server's own message. Used on sign-in, where echoing the
   * server text risks leaking whether an account exists.
   */
  readonly showServerMessage?: boolean;
  readonly className?: string;
}

/**
 * Renders a real failure: the human explanation, the machine code, the server's
 * own message and the `request_id` that identifies the request in the logs
 * (04_API_CONTRACTS.md). Nothing here is a placeholder, and no failure is ever
 * shown as a success.
 */
export function ErrorNotice({
  error,
  overrideMessage,
  showServerMessage = true,
  className,
}: ErrorNoticeProps) {
  const { t } = useTranslation();
  const failure = describeFailure(error);
  const fromServer = showServerMessage ? serverMessage(error) : null;
  const fieldEntries = Object.entries(failure.fields);

  return (
    <Callout tone="error" title={t('error.title')} className={className}>
      <p>{overrideMessage ?? t(failure.messageKey)}</p>
      {fromServer && fromServer !== t(failure.messageKey) ? (
        <p className="text-slate-800">{fromServer}</p>
      ) : null}
      {fieldEntries.length > 0 ? (
        <div>
          <p className="font-medium">{t('error.fieldsTitle')}</p>
          <ul className="list-disc pl-5">
            {fieldEntries.map(([field, message]) => (
              <li key={field}>
                <code className="font-mono text-xs">{field}</code>: {message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {failure.workPreserved ? <p>{t('error.workPreserved')}</p> : null}
      <p className="text-xs text-slate-700">
        {failure.code ? <code className="font-mono">{failure.code}</code> : null}
        {failure.code && failure.requestId ? ' · ' : null}
        {failure.requestId ? t('common.requestId', { requestId: failure.requestId }) : null}
      </p>
    </Callout>
  );
}
