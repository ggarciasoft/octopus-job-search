import type { Locale } from '@job-getter/contracts';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { en } from './en';
import { es } from './es';
import { isLocale, translate, type MessageKey, type MessageParams } from './messages';

/**
 * THE TRANSLATION BOUNDARY.
 *
 * `t()` translates UI chrome: labels, explanations, error copy, and — from M3 —
 * the language a *newly generated* document is written in. It is never applied
 * to stored user facts, imported job text, answers or worker output. Those are
 * rendered verbatim wherever they appear (see `DiagnosticsPage`, which prints
 * the echoed message exactly as the worker returned it).
 *
 * 08_UX_AND_CUSTOMIZATION.md: "English/Spanish locale switching affects UI and
 * new documents; do not silently translate stored facts." Changing language
 * also does not modify materials already submitted.
 */
const CATALOGUES: Record<Locale, Readonly<Record<MessageKey, string>>> = { en, es };

const STORAGE_KEY = 'job-getter.locale';

export interface I18nContextValue {
  readonly locale: Locale;
  readonly t: (key: MessageKey, params?: MessageParams) => string;
  readonly setLocale: (locale: Locale) => void;
  /**
   * Applies the locale the API reports for the workspace, but only when the
   * user has not chosen one in this browser — an explicit choice always wins.
   */
  readonly adoptWorkspaceLocale: (locale: Locale) => void;
  /** True when the current locale came from a choice stored in this browser. */
  readonly localeIsUserChosen: boolean;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function readStoredLocale(): Locale | null {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    return isLocale(stored) ? stored : null;
  } catch {
    // Storage can be unavailable (private mode, disabled cookies). Not fatal.
    return null;
  }
}

function detectLocale(): Locale {
  const stored = readStoredLocale();
  if (stored) return stored;
  const navigatorLanguage = globalThis.navigator?.language ?? '';
  return navigatorLanguage.toLowerCase().startsWith('es') ? 'es' : 'en';
}

export interface I18nProviderProps {
  readonly children: ReactNode;
  /** Test seam; production resolves the locale from storage and the browser. */
  readonly initialLocale?: Locale;
}

export function I18nProvider({ children, initialLocale }: I18nProviderProps) {
  const [locale, setLocaleState] = useState<Locale>(() => initialLocale ?? detectLocale());
  const [localeIsUserChosen, setLocaleIsUserChosen] = useState<boolean>(
    () => readStoredLocale() !== null,
  );

  useEffect(() => {
    // The document language must match what is rendered, for screen readers,
    // hyphenation and browser translation prompts.
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    setLocaleIsUserChosen(true);
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, next);
    } catch {
      // A non-persisted choice is still better than ignoring the click.
    }
  }, []);

  const adoptWorkspaceLocale = useCallback(
    (next: Locale) => {
      if (localeIsUserChosen) return;
      setLocaleState(next);
    },
    [localeIsUserChosen],
  );

  const value = useMemo<I18nContextValue>(() => {
    const catalogue = CATALOGUES[locale];
    return {
      locale,
      t: (key, params) => translate(catalogue, key, params),
      setLocale,
      adoptWorkspaceLocale,
      localeIsUserChosen,
    };
  }, [locale, setLocale, adoptWorkspaceLocale, localeIsUserChosen]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useTranslation(): I18nContextValue {
  const value = useContext(I18nContext);
  if (!value) {
    throw new Error('useTranslation must be used inside <I18nProvider>.');
  }
  return value;
}
