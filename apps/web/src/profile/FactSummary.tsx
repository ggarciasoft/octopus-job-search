import type { ExperienceBullet, TriState } from '@job-getter/contracts';
import { Badge } from '@job-getter/ui';
import type { ReactNode } from 'react';
import { useTranslation } from '../i18n/I18nProvider';
import type { MessageKey } from '../i18n/messages';
import type { FactDraft } from './factValues';

/**
 * Read-only rendering of one fact value, typed by `kind`.
 *
 * Everything the user or a document supplied — names, employers, bullet
 * text, notes — is printed verbatim. Only field labels and the labels of
 * closed contract enums (employment type, declared level, tri-states) go
 * through the catalogue, because those are UI vocabulary for a code, not a
 * translation of the user's words (08_UX_AND_CUSTOMIZATION.md).
 */
export function FactSummary({ draft }: { readonly draft: FactDraft }) {
  const { t } = useTranslation();

  switch (draft.kind) {
    case 'contact': {
      const value = draft.value;
      return (
        <Rows>
          <Row term={t('factField.full_name')}>{value.full_name}</Row>
          <Row term={t('factField.email')}>{value.email}</Row>
          <Row term={t('factField.phone')}>{value.phone ?? notStated(t)}</Row>
          <Row term={t('factField.city')}>{value.city ?? notStated(t)}</Row>
          <Row term={t('factField.country')}>{value.country ?? notStated(t)}</Row>
          {value.links && value.links.length > 0 ? (
            <Row term={t('factField.links')}>
              <ul className="list-disc pl-5">
                {value.links.map((link, index) => (
                  <li key={index}>
                    {link.label}: <span className="break-all font-mono text-xs">{link.url}</span>
                  </li>
                ))}
              </ul>
            </Row>
          ) : null}
        </Rows>
      );
    }
    case 'summary':
      return <p className="whitespace-pre-wrap text-sm text-slate-900">{draft.value.text}</p>;
    case 'experience': {
      const value = draft.value;
      return (
        <Rows>
          <Row term={t('factField.title')}>{value.title}</Row>
          <Row term={t('factField.employer')}>{value.employer}</Row>
          <Row term={t('factField.period')}>
            {value.start_month} –{' '}
            {value.current ? t('factField.currentLabel') : (value.end_month ?? notStated(t))}
          </Row>
          <Row term={t('factField.employment_type')}>
            {t(`employmentType.${value.employment_type}`)}
          </Row>
          <Row term={t('factField.location')}>{value.location ?? notStated(t)}</Row>
          <BulletsRow bullets={value.bullets} />
          <ListRow term={t('factField.skills')} items={value.skills} />
        </Rows>
      );
    }
    case 'education': {
      const value = draft.value;
      return (
        <Rows>
          <Row term={t('factField.institution')}>{value.institution}</Row>
          <Row term={t('factField.degree')}>{value.degree ?? notStated(t)}</Row>
          <Row term={t('factField.subject')}>{value.subject ?? notStated(t)}</Row>
          <Row term={t('factField.period')}>
            {value.start_month ?? notStated(t)} –{' '}
            {value.current ? t('factField.currentLabel') : (value.end_month ?? notStated(t))}
          </Row>
        </Rows>
      );
    }
    case 'skill': {
      const value = draft.value;
      return (
        <Rows>
          <Row term={t('factField.canonical_name')}>{value.canonical_name}</Row>
          <ListRow term={t('factField.aliases')} items={value.aliases} />
          <Row term={t('factField.user_declared_proficiency')}>
            {value.user_declared_proficiency === null ? (
              <Badge tone="unknown">{t('proficiency.notDeclared')}</Badge>
            ) : (
              t(`proficiency.${value.user_declared_proficiency}`)
            )}
          </Row>
          <Row term={t('factField.years')}>
            {value.years === null ? notStated(t) : String(value.years)}
          </Row>
        </Rows>
      );
    }
    case 'language': {
      const value = draft.value;
      return (
        <Rows>
          <Row term={t('factField.code')}>
            <span className="font-mono">{value.code}</span>
          </Row>
          <Row term={t('factField.declared_level')}>
            {t(`languageLevel.${value.declared_level}`)}
          </Row>
        </Rows>
      );
    }
    case 'authorization': {
      const value = draft.value;
      return (
        <Rows>
          <Row term={t('factField.country')}>
            <span className="font-mono">{value.country}</span>
          </Row>
          <Row term={t('factField.authorized')}>
            <TriStateBadge value={value.authorized} />
          </Row>
          <Row term={t('factField.sponsorship_required')}>
            <TriStateBadge value={value.sponsorship_required} />
          </Row>
          <Row term={t('factField.note')}>{value.note ?? notStated(t)}</Row>
        </Rows>
      );
    }
    case 'project': {
      const value = draft.value;
      return (
        <Rows>
          <Row term={t('factField.name')}>{value.name}</Row>
          <Row term={t('factField.role')}>{value.role ?? notStated(t)}</Row>
          <Row term={t('factField.url')}>
            {value.url === null ? (
              notStated(t)
            ) : (
              <span className="break-all font-mono text-xs">{value.url}</span>
            )}
          </Row>
          <Row term={t('factField.period')}>
            {value.start_month ?? notStated(t)} – {value.end_month ?? notStated(t)}
          </Row>
          <BulletsRow bullets={value.bullets} />
          <ListRow term={t('factField.skills')} items={value.skills} />
        </Rows>
      );
    }
    case 'certification': {
      const value = draft.value;
      return (
        <Rows>
          <Row term={t('factField.name')}>{value.name}</Row>
          <Row term={t('factField.issuer')}>{value.issuer ?? notStated(t)}</Row>
          <Row term={t('factField.issued_month')}>{value.issued_month ?? notStated(t)}</Row>
          <Row term={t('factField.expires_month')}>{value.expires_month ?? notStated(t)}</Row>
          <Row term={t('factField.credential_id')}>{value.credential_id ?? notStated(t)}</Row>
        </Rows>
      );
    }
  }
}

/**
 * A yes / no / unknown answer. "Unknown" gets the dashed `unknown` tone and
 * its own label, so it can never be mistaken for either real answer.
 */
export function TriStateBadge({ value }: { readonly value: TriState }) {
  const { t } = useTranslation();
  const tone = value === 'yes' ? 'success' : value === 'no' ? 'danger' : 'unknown';
  return (
    <Badge tone={tone}>
      <span data-testid="tri-state" data-value={value}>
        {t(`triState.${value}`)}
      </span>
    </Badge>
  );
}

function notStated(t: (key: MessageKey) => string): ReactNode {
  return <span className="text-slate-500">{t('factField.notStated')}</span>;
}

function Rows({ children }: { readonly children: ReactNode }) {
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[10rem_1fr]">
      {children}
    </dl>
  );
}

function Row({ term, children }: { readonly term: string; readonly children: ReactNode }) {
  return (
    <>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-600 sm:pt-0.5">
        {term}
      </dt>
      <dd className="whitespace-pre-wrap break-words text-slate-900">{children}</dd>
    </>
  );
}

function ListRow({ term, items }: { readonly term: string; readonly items: readonly string[] }) {
  const { t } = useTranslation();
  return (
    <Row term={term}>
      {items.length === 0 ? (
        notStated(t)
      ) : (
        <ul className="flex flex-wrap gap-1">
          {items.map((item, index) => (
            <li key={`${item}-${index}`}>
              <Badge tone="neutral">{item}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Row>
  );
}

function BulletsRow({ bullets }: { readonly bullets: readonly ExperienceBullet[] }) {
  const { t } = useTranslation();
  if (bullets.length === 0) return null;
  return (
    <Row term={t('factField.bullets')}>
      <ul className="list-disc pl-5">
        {bullets.map((bullet, index) => (
          <li key={index}>
            {bullet.text}
            {bullet.evidence_reference !== '' ? (
              <span className="ml-1 text-xs text-slate-600">
                ({t('factField.evidence_reference')}: {bullet.evidence_reference})
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </Row>
  );
}
