import type { PreferencesView, SettingsFile, SettingsImportResult } from '@job-getter/contracts';
import { Button, Callout, FormField, INPUT_CLASS } from '@job-getter/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useApi } from '../../api/ApiProvider';
import { ErrorNotice } from '../../components/ErrorNotice';
import { useTranslation } from '../../i18n/I18nProvider';
import { formatNumber } from '../../i18n/format';
import { SOURCES_QUERY_KEY } from '../DiscoverPage';

/** Far above any real settings file, and below the API's request body limit. */
const MAX_FILE_BYTES = 512 * 1024;

interface Chosen {
  readonly name: string;
  readonly settings: unknown;
  /** How many boards the file lists, when it lists them in a readable way. */
  readonly boards: number | null;
}

/**
 * Export and import of the settings file (08_UX_AND_CUSTOMIZATION.md,
 * customization level 2).
 *
 * The file is read here only to find out whether it is JSON and to count the
 * boards for the confirmation. Whether it is a *valid* settings file is the
 * API's decision, made against the same contract, and its refusal is shown
 * field by field. Nothing is applied until the person confirms, because an
 * import replaces every preference at once.
 */
export function SettingsFilePanel({
  view,
  onImported,
}: {
  readonly view: PreferencesView;
  readonly onImported: (result: SettingsImportResult) => void;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const { t, locale } = useTranslation();
  const input = useRef<HTMLInputElement>(null);

  const [exporting, setExporting] = useState(false);
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<SettingsImportResult | null>(null);

  const onExport = async () => {
    setExporting(true);
    setError(null);
    try {
      const file = await api.exportSettings();
      saveJson(`job-getter-settings-${localDate(new Date(file.exported_at))}.json`, file);
    } catch (caught) {
      setError(caught);
    } finally {
      setExporting(false);
    }
  };

  const onChoose = async (files: FileList | null) => {
    setChosen(null);
    setFileError(null);
    setError(null);
    setResult(null);
    const file = files?.[0];
    if (file === undefined) return;
    if (file.size > MAX_FILE_BYTES) {
      setFileError(t('settingsFile.tooLarge'));
      return;
    }
    let settings: unknown;
    try {
      settings = JSON.parse(await file.text());
    } catch {
      setFileError(t('settingsFile.notJson'));
      return;
    }
    const sources = (settings as { sources?: unknown } | null)?.sources;
    setChosen({
      name: file.name,
      settings,
      boards: Array.isArray(sources) ? sources.length : null,
    });
  };

  const clearChoice = () => {
    setChosen(null);
    if (input.current) input.current.value = '';
  };

  const onImport = async () => {
    if (chosen === null) return;
    setImporting(true);
    setError(null);
    try {
      const imported = await api.importSettings({
        body: {
          expected_revision: view.revision,
          // Checked by the API against the contract; see the component comment.
          settings: chosen.settings as SettingsFile,
        },
      });
      setResult(imported);
      clearChoice();
      void queryClient.invalidateQueries({ queryKey: SOURCES_QUERY_KEY });
      onImported(imported);
    } catch (caught) {
      setError(caught);
    } finally {
      setImporting(false);
    }
  };

  return (
    <section className="flex flex-col gap-4 rounded border border-slate-200 bg-white p-4">
      <h2 className="text-base font-semibold text-slate-900">{t('settingsFile.title')}</h2>
      <p className="text-sm text-slate-700">{t('settingsFile.intro')}</p>

      <div>
        <Button
          busy={exporting}
          busyLabel={t('settingsFile.exporting')}
          onClick={() => void onExport()}
        >
          {t('settingsFile.export')}
        </Button>
      </div>

      <FormField
        label={t('settingsFile.importLabel')}
        description={t('settingsFile.importDescription')}
        error={fileError}
      >
        {(field) => (
          <input
            {...field}
            ref={input}
            type="file"
            accept="application/json,.json"
            className={INPUT_CLASS}
            onChange={(event) => void onChoose(event.currentTarget.files)}
          />
        )}
      </FormField>

      {chosen === null ? null : (
        <Callout tone="warning" title={t('settingsFile.confirmTitle', { name: chosen.name })}>
          <p>{t('settingsFile.confirmPreferences')}</p>
          <p>
            {chosen.boards === null
              ? t('settingsFile.confirmBoardsUnknown')
              : t('settingsFile.confirmBoards', { count: formatNumber(locale, chosen.boards) })}
          </p>
          <div className="mt-2 flex flex-wrap gap-3">
            <Button
              variant="primary"
              busy={importing}
              busyLabel={t('settingsFile.importing')}
              onClick={() => void onImport()}
            >
              {t('settingsFile.confirm')}
            </Button>
            <Button variant="ghost" disabled={importing} onClick={clearChoice}>
              {t('action.cancel')}
            </Button>
          </div>
        </Callout>
      )}

      {error === null ? null : <ErrorNotice error={error} />}

      {result === null ? null : (
        <Callout tone="success">
          <p>
            {t('settingsFile.imported', {
              revision: formatNumber(locale, result.preferences.revision),
              created: formatNumber(locale, result.sources_created),
              present: formatNumber(locale, result.sources_already_present),
            })}
          </p>
        </Callout>
      )}
    </section>
  );
}

/** The person's own calendar date: an evening export west of UTC is not named after tomorrow. */
function localDate(when: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
}

function saveJson(name: string, value: unknown): void {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  // After the click has been dispatched, not during it.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
