import type { FactKind, Profile, ProfileFact, ProfilePatchRequest } from '@job-getter/contracts';
import { Badge, Button, Callout, Dialog, Spinner } from '@job-getter/ui';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../api/ApiProvider';
import { describeFailure } from '../api/errors';
import { ErrorNotice } from '../components/ErrorNotice';
import { FactStateBadge } from '../components/FactStateBadge';
import { useTranslation } from '../i18n/I18nProvider';
import { formatDateTime } from '../i18n/format';
import { FactForm } from '../profile/FactForm';
import { FactSummary } from '../profile/FactSummary';
import {
  FACT_SECTION_ORDER,
  asFactDraft,
  emptyFactValue,
  type FactDraft,
} from '../profile/factValues';
import { useProfileQuery, useSetProfile } from '../profile/useProfile';

const LINK_CLASS =
  'text-sm font-medium text-sky-800 underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600';

/** Which form is open: a stored fact, a new fact of a kind, or the contact block. */
type Editing =
  | { readonly target: 'fact'; readonly kind: FactKind; readonly factId: string | null }
  | { readonly target: 'contact' };

type PatchBody = Omit<ProfilePatchRequest, 'expected_revision'>;

/**
 * The profile screen: contact first, then every fact kind in its own group.
 *
 * Every write is a `PATCH /profile` against the revision this screen last
 * read. A `409 STALE_REVISION` is shown as exactly that, with a reload action
 * that refreshes the profile while the open form keeps what was typed — the
 * user reapplies, nothing is silently merged (03_DATA_MODEL.md, AT20).
 */
export function ProfilePage() {
  const api = useApi();
  const { t, locale } = useTranslation();
  const profileQuery = useProfileQuery();
  const setProfile = useSetProfile();

  const [editing, setEditing] = useState<Editing | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [pendingDelete, setPendingDelete] = useState<ProfileFact | null>(null);
  const [savedRevision, setSavedRevision] = useState<number | null>(null);

  const profile = profileQuery.data;

  const patch = async (body: PatchBody): Promise<Profile | null> => {
    if (!profile) return null;
    const updated = await api.patchProfile({
      body: { expected_revision: profile.revision, ...body },
    });
    setProfile(updated);
    setSavedRevision(updated.revision);
    return updated;
  };

  const submitForm = async (body: PatchBody) => {
    setSaving(true);
    setSaveError(null);
    try {
      await patch(body);
      setEditing(null);
    } catch (caught) {
      // The form stays mounted with its values; only the notice changes.
      setSaveError(caught);
    } finally {
      setSaving(false);
    }
  };

  const runAction = async (body: PatchBody) => {
    setActionError(null);
    try {
      await patch(body);
    } catch (caught) {
      setActionError(caught);
    }
  };

  const openEditor = (next: Editing) => {
    setSaveError(null);
    setEditing(next);
  };

  const closeEditor = () => {
    setSaveError(null);
    setEditing(null);
  };

  const reloadAction = (error: unknown): ReactNode =>
    describeFailure(error).isStale ? (
      <Button onClick={() => void profileQuery.refetch()}>{t('profile.reload')}</Button>
    ) : null;

  if (profileQuery.isPending) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-700">
        <Spinner label={t('profile.loading')} />
        <span>{t('profile.loading')}</span>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex max-w-2xl flex-col gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">{t('profile.title')}</h1>
        <ErrorNotice error={profileQuery.error} overrideMessage={t('profile.loadFailed')} />
        <div>
          <Button variant="primary" onClick={() => void profileQuery.refetch()}>
            {t('action.retry')}
          </Button>
        </div>
      </div>
    );
  }

  const factsByKind = new Map<FactKind, ProfileFact[]>();
  for (const fact of profile.facts) {
    const list = factsByKind.get(fact.kind) ?? [];
    list.push(fact);
    factsByKind.set(fact.kind, list);
  }

  const renderFactForm = (kind: FactKind, fact: ProfileFact | null) => {
    const initial: FactDraft | null =
      fact === null
        ? ({ kind, value: emptyFactValue(kind) } as FactDraft)
        : asFactDraft(fact.kind, fact.value);
    if (initial === null) {
      return <Callout tone="error">{t('profile.valueUnreadable')}</Callout>;
    }
    return (
      <FactForm
        key={fact?.id ?? `new-${kind}`}
        initial={initial}
        mode="profile"
        // A stored draft stays a draft unless the user ticks the box; a fact
        // typed here is the user's own statement and defaults to confirmed.
        initialConfirmed={fact === null ? true : fact.confirmed}
        submitLabel={t('profile.saveFact')}
        busy={saving}
        busyLabel={t('profile.saving')}
        error={saveError}
        onCancel={closeEditor}
        extraActions={reloadAction(saveError)}
        onSubmit={(draft, confirmed) =>
          void submitForm({
            changes: [
              fact === null
                ? { op: 'upsert', kind: draft.kind, value: draft.value, confirmed }
                : { op: 'upsert', id: fact.id, kind: draft.kind, value: draft.value, confirmed },
            ],
          })
        }
      />
    );
  };

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-slate-900">{t('profile.title')}</h1>
        <p className="max-w-3xl text-sm text-slate-700">{t('profile.intro')}</p>
        <p className="text-sm">
          <Link to="/profile/import" className={LINK_CLASS}>
            {t('profile.importLink')}
          </Link>
        </p>
      </header>

      <Callout tone="info" live={false} title={t('profile.stateTitle')}>
        <p>
          <strong>{t('fact.confirmed')}</strong> — {t('fact.confirmedDescription')}
        </p>
        <p>
          <strong>{t('fact.draft')}</strong> — {t('fact.draftDescription')}
        </p>
        <p className="text-xs">
          {t('profile.revisionInfo', {
            revision: profile.revision,
            confirmed:
              profile.confirmed_revision === null
                ? t('profile.noConfirmedRevision')
                : String(profile.confirmed_revision),
          })}
        </p>
        <p className="text-xs">{t('locale.factsNote')}</p>
      </Callout>

      {savedRevision === null ? null : (
        <Callout tone="success">
          <p>{t('profile.saved', { revision: savedRevision })}</p>
        </Callout>
      )}

      {actionError === null ? null : (
        <div className="flex flex-col gap-2">
          <ErrorNotice error={actionError} />
          <div>{reloadAction(actionError)}</div>
        </div>
      )}

      <section className="flex flex-col gap-3" aria-labelledby="profile-contact">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="profile-contact" className="text-lg font-semibold text-slate-900">
            {t('profile.contactTitle')}
          </h2>
          {editing?.target === 'contact' ? null : (
            <Button onClick={() => openEditor({ target: 'contact' })}>
              {profile.contact === null ? t('profile.addContact') : t('profile.editContact')}
            </Button>
          )}
        </div>
        <p className="text-sm text-slate-600">{t('profile.contactDescription')}</p>

        {editing?.target === 'contact' ? (
          <div className="rounded border border-sky-300 bg-white p-4">
            <FactForm
              initial={{ kind: 'contact', value: profile.contact ?? emptyFactValue('contact') }}
              mode="review"
              submitLabel={t('profile.saveContact')}
              busy={saving}
              busyLabel={t('profile.saving')}
              error={saveError}
              onCancel={closeEditor}
              extraActions={reloadAction(saveError)}
              onSubmit={(draft) => {
                if (draft.kind === 'contact') {
                  void submitForm({ contact: draft.value, changes: [] });
                }
              }}
            />
          </div>
        ) : profile.contact === null ? (
          <p className="text-sm text-slate-700">{t('profile.contactEmpty')}</p>
        ) : (
          <div className="rounded border border-slate-200 bg-white p-4">
            <FactSummary draft={{ kind: 'contact', value: profile.contact }} />
          </div>
        )}

        {(factsByKind.get('contact') ?? []).map((fact) => (
          <FactCard
            key={fact.id}
            fact={fact}
            locale={locale}
            editing={editing?.target === 'fact' && editing.factId === fact.id}
            renderForm={() => renderFactForm('contact', fact)}
            onEdit={() => openEditor({ target: 'fact', kind: 'contact', factId: fact.id })}
            onConfirm={() =>
              void runAction({
                changes: [
                  {
                    op: 'upsert',
                    id: fact.id,
                    kind: fact.kind,
                    value: fact.value,
                    confirmed: true,
                  },
                ],
              })
            }
            onDelete={() => setPendingDelete(fact)}
          />
        ))}
      </section>

      {FACT_SECTION_ORDER.map((kind) => {
        const facts = factsByKind.get(kind) ?? [];
        const adding =
          editing?.target === 'fact' && editing.kind === kind && editing.factId === null;
        return (
          <section key={kind} className="flex flex-col gap-3" aria-labelledby={`profile-${kind}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id={`profile-${kind}`} className="text-lg font-semibold text-slate-900">
                {t(`factKind.${kind}.plural`)}
              </h2>
              {adding ? null : (
                <Button onClick={() => openEditor({ target: 'fact', kind, factId: null })}>
                  {t('profile.addFact', { kind: t(`factKind.${kind}`) })}
                </Button>
              )}
            </div>

            {facts.length === 0 && !adding ? (
              <p className="text-sm text-slate-700">
                {t('profile.sectionEmpty', { kind: t(`factKind.${kind}.plural`) })}
              </p>
            ) : null}

            {facts.map((fact) => (
              <FactCard
                key={fact.id}
                fact={fact}
                locale={locale}
                editing={editing?.target === 'fact' && editing.factId === fact.id}
                renderForm={() => renderFactForm(kind, fact)}
                onEdit={() => openEditor({ target: 'fact', kind, factId: fact.id })}
                onConfirm={() =>
                  void runAction({
                    changes: [
                      {
                        op: 'upsert',
                        id: fact.id,
                        kind: fact.kind,
                        value: fact.value,
                        confirmed: true,
                      },
                    ],
                  })
                }
                onDelete={() => setPendingDelete(fact)}
              />
            ))}

            {adding ? (
              <div className="rounded border border-sky-300 bg-white p-4">
                <h3 className="mb-3 text-base font-semibold text-slate-900">
                  {t('profile.addFact', { kind: t(`factKind.${kind}`) })}
                </h3>
                {renderFactForm(kind, null)}
              </div>
            ) : null}
          </section>
        );
      })}

      <Dialog
        open={pendingDelete !== null}
        title={t('profile.deleteTitle')}
        onClose={() => setPendingDelete(null)}
        footer={
          <>
            <Button onClick={() => setPendingDelete(null)}>{t('action.cancel')}</Button>
            <Button
              variant="danger"
              onClick={() => {
                const fact = pendingDelete;
                setPendingDelete(null);
                if (fact) void runAction({ changes: [{ op: 'delete', id: fact.id }] });
              }}
            >
              {t('profile.deleteConfirm')}
            </Button>
          </>
        }
      >
        <p>{t('profile.deleteBody')}</p>
      </Dialog>
    </div>
  );
}

function FactCard({
  fact,
  locale,
  editing,
  renderForm,
  onEdit,
  onConfirm,
  onDelete,
}: {
  readonly fact: ProfileFact;
  readonly locale: 'en' | 'es';
  readonly editing: boolean;
  readonly renderForm: () => ReactNode;
  readonly onEdit: () => void;
  readonly onConfirm: () => void;
  readonly onDelete: () => void;
}) {
  const { t } = useTranslation();
  const draft = asFactDraft(fact.kind, fact.value);

  return (
    <article
      data-testid="fact"
      data-kind={fact.kind}
      data-confirmed={String(fact.confirmed)}
      className={`flex flex-col gap-3 rounded border bg-white p-4 ${
        fact.confirmed ? 'border-slate-200' : 'border-dashed border-sky-400'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <FactStateBadge confirmed={fact.confirmed} />
          <Badge tone="neutral">{t(`factKind.${fact.kind}`)}</Badge>
        </div>
        {editing ? null : (
          <div className="flex flex-wrap gap-2">
            {fact.confirmed ? null : (
              <Button size="sm" variant="primary" onClick={onConfirm}>
                {t('profile.confirmFact')}
              </Button>
            )}
            <Button size="sm" onClick={onEdit}>
              {t('profile.editFact')}
            </Button>
            <Button size="sm" variant="danger" onClick={onDelete}>
              {t('profile.deleteFact')}
            </Button>
          </div>
        )}
      </div>

      {editing ? (
        renderForm()
      ) : draft === null ? (
        <p className="text-sm text-rose-800">{t('profile.valueUnreadable')}</p>
      ) : (
        <FactSummary draft={draft} />
      )}

      <footer className="flex flex-col gap-1 text-xs text-slate-600">
        {fact.source_excerpt === null ? null : (
          <div>
            <span className="font-medium">{t('profile.sourceExcerpt')}: </span>
            {/* The excerpt is document text: shown exactly as extracted. */}
            <blockquote className="mt-1 whitespace-pre-wrap border-l-2 border-slate-300 pl-2 text-slate-700">
              {fact.source_excerpt}
            </blockquote>
          </div>
        )}
        {fact.source_file_id === null ? null : (
          <span>
            {t('profile.sourceFile')}: <code className="font-mono">{fact.source_file_id}</code>
          </span>
        )}
        {fact.supersedes_id === null ? null : (
          <span>
            {t('profile.supersedes')}: <code className="font-mono">{fact.supersedes_id}</code>
          </span>
        )}
        <span>
          {t('profile.factRevision', {
            revision: fact.revision,
            updated: formatDateTime(locale, fact.updated_at) ?? t('common.notReported'),
          })}
        </span>
      </footer>
    </article>
  );
}
