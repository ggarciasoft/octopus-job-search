/**
 * i18n entry point.
 *
 * THE BOUNDARY, stated once more because it is easy to erode:
 *
 *   `t()` is for UI chrome — labels, help text, errors, and the language a
 *   newly generated document is written in.
 *
 *   It is NOT for user-owned content. Profile facts, imported job text, answer
 *   bank entries, worker output and anything the user typed are rendered
 *   verbatim in whatever language they were written. Machine-translating them
 *   would change stored facts, which 08_UX_AND_CUSTOMIZATION.md forbids, and
 *   switching language never modifies materials already submitted.
 */
export { I18nProvider, useTranslation } from './I18nProvider';
export type { I18nContextValue } from './I18nProvider';
export { SUPPORTED_LOCALES, isLocale, translate } from './messages';
export type { MessageKey, MessageParams } from './messages';
export { elapsedSeconds, formatCurrency, formatDateTime, formatNumber } from './format';
export { en } from './en';
export { es } from './es';
