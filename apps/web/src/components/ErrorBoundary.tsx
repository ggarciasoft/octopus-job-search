import { Button, Callout } from '@job-getter/ui';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { describeFailure } from '../api/errors';
import { useTranslation } from '../i18n/I18nProvider';

interface ErrorBoundaryProps {
  readonly renderFallback: (error: Error, reset: () => void) => ReactNode;
  readonly children: ReactNode;
}

interface ErrorBoundaryState {
  readonly error: Error | null;
}

class ErrorBoundaryInner extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // The console is the only sink available in the browser; there is no
    // hidden telemetry in this product (00_AI_IMPLEMENTATION_INSTRUCTIONS.md).
    console.error('Unhandled error in the web app', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (error) {
      return this.props.renderFallback(error, () => this.setState({ error: null }));
    }
    return this.props.children;
  }
}

/**
 * Top-level boundary. A crash shows the real error message and, when the crash
 * came from an API call, the `request_id` — never a blank screen and never a
 * cheerful "something went wrong, try again" with nothing behind it.
 */
export function AppErrorBoundary({ children }: { readonly children: ReactNode }) {
  const { t } = useTranslation();

  return (
    <ErrorBoundaryInner
      renderFallback={(error, reset) => {
        const failure = describeFailure(error);
        return (
          <div className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
            <Callout tone="error" title={t('error.boundaryTitle')}>
              <p>{t('error.boundaryBody')}</p>
              <p className="font-mono text-xs break-words">{error.message}</p>
              {failure.code ? (
                <p className="font-mono text-xs">{failure.code}</p>
              ) : null}
              {failure.requestId ? (
                <p className="text-xs">
                  {t('common.requestId', { requestId: failure.requestId })}
                </p>
              ) : null}
            </Callout>
            <div className="flex gap-2">
              <Button variant="primary" onClick={reset}>
                {t('action.retry')}
              </Button>
              <Button onClick={() => globalThis.location.reload()}>{t('action.reload')}</Button>
            </div>
          </div>
        );
      }}
    >
      {children}
    </ErrorBoundaryInner>
  );
}
