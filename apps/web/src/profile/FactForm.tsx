import {
  ALL_EMPLOYMENT_TYPES,
  LanguageValue as LanguageSchema,
  SkillValue as SkillSchema,
  type AuthorizationValue,
  type CertificationValue,
  type ContactValue,
  type EducationValue,
  type ExperienceBullet,
  type ExperienceValue,
  type LanguageValue,
  type ProjectValue,
  type SkillValue,
  type SummaryValue,
  type TriState,
} from '@job-getter/contracts';
import { Button, Checkbox, RadioGroup, Select, TextArea, TextField } from '@job-getter/ui';
import { useId, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { describeFailure } from '../api/errors';
import { fieldError, stripFieldPrefix } from '../api/fieldErrors';
import { ErrorNotice } from '../components/ErrorNotice';
import { StringListField } from '../components/StringListField';
import { useTranslation } from '../i18n/I18nProvider';
import {
  literalOptions,
  textOrNull,
  validateFactDraft,
  type FactDraft,
  type FieldErrors,
} from './factValues';

type ErrorFor = (name: string) => string | null;

export interface FactFormProps {
  readonly initial: FactDraft;
  /**
   * `profile` edits a stored fact and offers the confirmation checkbox;
   * `review` edits a proposed value during import review, where confirmation
   * is the separate, explicit accept step.
   */
  readonly mode: 'profile' | 'review';
  readonly initialConfirmed?: boolean;
  readonly submitLabel: string;
  readonly busy?: boolean;
  readonly busyLabel?: string;
  /** The failure of the last submit, if any. The typed values are kept. */
  readonly error?: unknown;
  readonly onSubmit: (draft: FactDraft, confirmed: boolean) => void;
  readonly onCancel: () => void;
  /** Extra controls next to the actions, e.g. "reload" after a 409. */
  readonly extraActions?: ReactNode;
}

/** Where the API puts a fact's field errors, relative to the request body. */
const FACT_FIELD_PREFIX = /^(changes|accepted_fields)\.\d+\.(value|edited_value)\.?/;

/**
 * One typed form per fact kind.
 *
 * Client-side checks mirror the API's (`validateFactDraft`); the server's
 * own field errors are shown against the same controls when it disagrees.
 * A failed submit never clears the form (08_UX_AND_CUSTOMIZATION.md).
 */
export function FactForm({
  initial,
  mode,
  initialConfirmed,
  submitLabel,
  busy = false,
  busyLabel,
  error,
  onSubmit,
  onCancel,
  extraActions,
}: FactFormProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<FactDraft>(initial);
  const [confirmed, setConfirmed] = useState<boolean>(initialConfirmed ?? true);
  const [localErrors, setLocalErrors] = useState<FieldErrors>({});

  const serverFields = useMemo(
    () =>
      error === undefined || error === null
        ? {}
        : stripFieldPrefix(describeFailure(error).fields, FACT_FIELD_PREFIX),
    [error],
  );

  const errorFor: ErrorFor = (name) => {
    const local = localErrors[name];
    if (local !== undefined) return t(local);
    return fieldError(serverFields, name);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const errors = validateFactDraft(draft);
    setLocalErrors(errors);
    if (Object.keys(errors).length > 0) return;
    onSubmit(draft, confirmed);
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
      {error === undefined || error === null ? null : <ErrorNotice error={error} />}

      <KindFields draft={draft} onChange={setDraft} errorFor={errorFor} />

      {mode === 'profile' ? (
        <Checkbox
          label={t('factForm.confirmedLabel')}
          description={t('factForm.confirmedDescription')}
          checked={confirmed}
          onChange={(event) => setConfirmed(event.currentTarget.checked)}
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" busy={busy} busyLabel={busyLabel}>
          {submitLabel}
        </Button>
        <Button onClick={onCancel}>{t('action.cancel')}</Button>
        {extraActions}
      </div>
    </form>
  );
}

function KindFields({
  draft,
  onChange,
  errorFor,
}: {
  readonly draft: FactDraft;
  readonly onChange: (next: FactDraft) => void;
  readonly errorFor: ErrorFor;
}) {
  switch (draft.kind) {
    case 'contact':
      return (
        <ContactFields
          value={draft.value}
          onChange={(value) => onChange({ kind: 'contact', value })}
          errorFor={errorFor}
        />
      );
    case 'summary':
      return (
        <SummaryFields
          value={draft.value}
          onChange={(value) => onChange({ kind: 'summary', value })}
          errorFor={errorFor}
        />
      );
    case 'experience':
      return (
        <ExperienceFields
          value={draft.value}
          onChange={(value) => onChange({ kind: 'experience', value })}
          errorFor={errorFor}
        />
      );
    case 'education':
      return (
        <EducationFields
          value={draft.value}
          onChange={(value) => onChange({ kind: 'education', value })}
          errorFor={errorFor}
        />
      );
    case 'skill':
      return (
        <SkillFields
          value={draft.value}
          onChange={(value) => onChange({ kind: 'skill', value })}
          errorFor={errorFor}
        />
      );
    case 'language':
      return (
        <LanguageFields
          value={draft.value}
          onChange={(value) => onChange({ kind: 'language', value })}
          errorFor={errorFor}
        />
      );
    case 'authorization':
      return (
        <AuthorizationFields
          value={draft.value}
          onChange={(value) => onChange({ kind: 'authorization', value })}
          errorFor={errorFor}
        />
      );
    case 'project':
      return (
        <ProjectFields
          value={draft.value}
          onChange={(value) => onChange({ kind: 'project', value })}
          errorFor={errorFor}
        />
      );
    case 'certification':
      return (
        <CertificationFields
          value={draft.value}
          onChange={(value) => onChange({ kind: 'certification', value })}
          errorFor={errorFor}
        />
      );
  }
}

interface FieldsProps<Value> {
  readonly value: Value;
  readonly onChange: (next: Value) => void;
  readonly errorFor: ErrorFor;
}

/** `YYYY-MM` as free text: `type="month"` is not supported by every browser. */
function MonthField({
  label,
  value,
  onChange,
  error,
  required,
  description,
}: {
  readonly label: string;
  readonly value: string | null;
  readonly onChange: (next: string | null) => void;
  readonly error: string | null;
  readonly required?: boolean;
  readonly description?: string;
}) {
  const { t } = useTranslation();
  return (
    <TextField
      label={label}
      description={description ?? t('factForm.monthDescription')}
      placeholder="YYYY-MM"
      inputMode="numeric"
      maxLength={7}
      required={required}
      value={value ?? ''}
      error={error}
      onChange={(event) =>
        onChange(required ? event.currentTarget.value : textOrNull(event.currentTarget.value))
      }
    />
  );
}

function ContactFields({ value, onChange, errorFor }: FieldsProps<ContactValue>) {
  const { t } = useTranslation();
  const patch = (partial: Partial<ContactValue>) => onChange({ ...value, ...partial });
  const links = value.links ?? [];
  const setLinks = (next: ContactValue['links']) => patch({ links: next });

  return (
    <>
      <TextField
        label={t('factField.full_name')}
        required
        value={value.full_name}
        error={errorFor('full_name')}
        onChange={(event) => patch({ full_name: event.currentTarget.value })}
      />
      <TextField
        label={t('factField.email')}
        type="email"
        required
        value={value.email}
        error={errorFor('email')}
        onChange={(event) => patch({ email: event.currentTarget.value })}
      />
      <TextField
        label={t('factField.phone')}
        value={value.phone ?? ''}
        error={errorFor('phone')}
        onChange={(event) => patch({ phone: textOrNull(event.currentTarget.value) })}
      />
      <TextField
        label={t('factField.city')}
        value={value.city ?? ''}
        error={errorFor('city')}
        onChange={(event) => patch({ city: textOrNull(event.currentTarget.value) })}
      />
      <TextField
        label={t('factField.country')}
        value={value.country ?? ''}
        error={errorFor('country')}
        onChange={(event) => patch({ country: textOrNull(event.currentTarget.value) })}
      />
      <fieldset className="flex flex-col gap-3 rounded border border-slate-200 p-3">
        <legend className="px-1 text-sm font-medium text-slate-800">{t('factField.links')}</legend>
        {links.map((link, index) => (
          <div key={index} className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <TextField
              label={t('factForm.linkLabel', { n: index + 1 })}
              value={link.label}
              error={errorFor(`links.${index}.label`)}
              onChange={(event) =>
                setLinks(
                  links.map((l, i) =>
                    i === index ? { ...l, label: event.currentTarget.value } : l,
                  ),
                )
              }
            />
            <TextField
              label={t('factForm.linkUrl', { n: index + 1 })}
              type="url"
              value={link.url}
              error={errorFor(`links.${index}.url`)}
              onChange={(event) =>
                setLinks(
                  links.map((l, i) => (i === index ? { ...l, url: event.currentTarget.value } : l)),
                )
              }
            />
            <Button size="sm" onClick={() => setLinks(links.filter((_, i) => i !== index))}>
              {t('factForm.removeLink', { n: index + 1 })}
            </Button>
          </div>
        ))}
        <div>
          <Button size="sm" onClick={() => setLinks([...links, { label: '', url: '' }])}>
            {t('factForm.addLink')}
          </Button>
        </div>
      </fieldset>
    </>
  );
}

function SummaryFields({ value, onChange, errorFor }: FieldsProps<SummaryValue>) {
  const { t } = useTranslation();
  return (
    <TextArea
      label={t('factField.text')}
      description={t('factForm.summaryDescription')}
      required
      rows={6}
      maxLength={2000}
      value={value.text}
      error={errorFor('text')}
      onChange={(event) => onChange({ text: event.currentTarget.value })}
    />
  );
}

function BulletListField({
  bullets,
  onChange,
  errorFor,
}: {
  readonly bullets: readonly ExperienceBullet[];
  readonly onChange: (next: ExperienceBullet[]) => void;
  readonly errorFor: ErrorFor;
}) {
  const { t } = useTranslation();
  const update = (index: number, partial: Partial<ExperienceBullet>) =>
    onChange(bullets.map((bullet, i) => (i === index ? { ...bullet, ...partial } : bullet)));

  return (
    <fieldset className="flex flex-col gap-3 rounded border border-slate-200 p-3">
      <legend className="px-1 text-sm font-medium text-slate-800">{t('factField.bullets')}</legend>
      <p className="text-sm text-slate-600">{t('factForm.bulletsDescription')}</p>
      {bullets.map((bullet, index) => (
        <div key={index} className="flex flex-col gap-2 rounded bg-slate-50 p-2">
          <TextArea
            label={t('factForm.bulletText', { n: index + 1 })}
            rows={2}
            maxLength={600}
            required
            value={bullet.text}
            error={errorFor(`bullets.${index}.text`)}
            onChange={(event) => update(index, { text: event.currentTarget.value })}
          />
          <TextField
            label={t('factForm.bulletEvidence', { n: index + 1 })}
            description={t('factForm.bulletEvidenceDescription')}
            maxLength={300}
            value={bullet.evidence_reference}
            error={errorFor(`bullets.${index}.evidence_reference`)}
            onChange={(event) => update(index, { evidence_reference: event.currentTarget.value })}
          />
          <div>
            <Button size="sm" onClick={() => onChange(bullets.filter((_, i) => i !== index))}>
              {t('factForm.removeBullet', { n: index + 1 })}
            </Button>
          </div>
        </div>
      ))}
      <div>
        <Button
          size="sm"
          onClick={() => onChange([...bullets, { text: '', evidence_reference: '' }])}
        >
          {t('factForm.addBullet')}
        </Button>
      </div>
    </fieldset>
  );
}

function ExperienceFields({ value, onChange, errorFor }: FieldsProps<ExperienceValue>) {
  const { t } = useTranslation();
  const patch = (partial: Partial<ExperienceValue>) => onChange({ ...value, ...partial });

  return (
    <>
      <TextField
        label={t('factField.employer')}
        required
        value={value.employer}
        error={errorFor('employer')}
        onChange={(event) => patch({ employer: event.currentTarget.value })}
      />
      <TextField
        label={t('factField.title')}
        required
        value={value.title}
        error={errorFor('title')}
        onChange={(event) => patch({ title: event.currentTarget.value })}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <MonthField
          label={t('factField.start_month')}
          required
          value={value.start_month}
          error={errorFor('start_month')}
          onChange={(next) => patch({ start_month: next ?? '' })}
        />
        <MonthField
          label={t('factField.end_month')}
          description={t('factForm.endMonthDescription')}
          value={value.end_month}
          error={errorFor('end_month')}
          onChange={(next) => patch({ end_month: next })}
        />
      </div>
      <Checkbox
        label={t('factField.current')}
        description={t('factForm.currentDescription')}
        checked={value.current}
        onChange={(event) => patch({ current: event.currentTarget.checked })}
      />
      <Select
        label={t('factField.employment_type')}
        value={value.employment_type}
        error={errorFor('employment_type')}
        options={ALL_EMPLOYMENT_TYPES.map((type) => ({
          value: type,
          label: t(`employmentType.${type}`),
        }))}
        onChange={(event) =>
          patch({
            employment_type: event.currentTarget.value as ExperienceValue['employment_type'],
          })
        }
      />
      <TextField
        label={t('factField.location')}
        value={value.location ?? ''}
        error={errorFor('location')}
        onChange={(event) => patch({ location: textOrNull(event.currentTarget.value) })}
      />
      <BulletListField
        bullets={value.bullets}
        onChange={(bullets) => patch({ bullets })}
        errorFor={errorFor}
      />
      <StringListField
        label={t('factField.skills')}
        description={t('factForm.listDescription')}
        value={value.skills}
        error={errorFor('skills')}
        onChange={(skills) => patch({ skills })}
      />
    </>
  );
}

function EducationFields({ value, onChange, errorFor }: FieldsProps<EducationValue>) {
  const { t } = useTranslation();
  const patch = (partial: Partial<EducationValue>) => onChange({ ...value, ...partial });
  return (
    <>
      <TextField
        label={t('factField.institution')}
        required
        value={value.institution}
        error={errorFor('institution')}
        onChange={(event) => patch({ institution: event.currentTarget.value })}
      />
      <TextField
        label={t('factField.degree')}
        value={value.degree ?? ''}
        error={errorFor('degree')}
        onChange={(event) => patch({ degree: textOrNull(event.currentTarget.value) })}
      />
      <TextField
        label={t('factField.subject')}
        value={value.subject ?? ''}
        error={errorFor('subject')}
        onChange={(event) => patch({ subject: textOrNull(event.currentTarget.value) })}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <MonthField
          label={t('factField.start_month')}
          value={value.start_month}
          error={errorFor('start_month')}
          onChange={(next) => patch({ start_month: next })}
        />
        <MonthField
          label={t('factField.end_month')}
          description={t('factForm.endMonthDescription')}
          value={value.end_month}
          error={errorFor('end_month')}
          onChange={(next) => patch({ end_month: next })}
        />
      </div>
      <Checkbox
        label={t('factField.currentStudies')}
        checked={value.current}
        onChange={(event) => patch({ current: event.currentTarget.checked })}
      />
    </>
  );
}

const PROFICIENCY_LEVELS = literalOptions<NonNullable<SkillValue['user_declared_proficiency']>>(
  SkillSchema.properties.user_declared_proficiency,
);

function SkillFields({ value, onChange, errorFor }: FieldsProps<SkillValue>) {
  const { t } = useTranslation();
  const patch = (partial: Partial<SkillValue>) => onChange({ ...value, ...partial });
  return (
    <>
      <TextField
        label={t('factField.canonical_name')}
        required
        value={value.canonical_name}
        error={errorFor('canonical_name')}
        onChange={(event) => patch({ canonical_name: event.currentTarget.value })}
      />
      <StringListField
        label={t('factField.aliases')}
        description={t('factForm.listDescription')}
        value={value.aliases}
        error={errorFor('aliases')}
        onChange={(aliases) => patch({ aliases })}
      />
      <Select
        label={t('factField.user_declared_proficiency')}
        description={t('factForm.proficiencyDescription')}
        value={value.user_declared_proficiency ?? ''}
        error={errorFor('user_declared_proficiency')}
        options={[
          { value: '', label: t('proficiency.notDeclared') },
          ...PROFICIENCY_LEVELS.map((level) => ({
            value: level,
            label: t(`proficiency.${level}`),
          })),
        ]}
        onChange={(event) => {
          const next = event.currentTarget.value;
          patch({
            user_declared_proficiency:
              next === '' ? null : (next as NonNullable<SkillValue['user_declared_proficiency']>),
          });
        }}
      />
      <TextField
        label={t('factField.years')}
        type="number"
        min={0}
        max={70}
        step={0.5}
        value={value.years ?? ''}
        error={errorFor('years')}
        onChange={(event) => {
          const text = event.currentTarget.value;
          patch({ years: text === '' ? null : Number(text) });
        }}
      />
    </>
  );
}

const LANGUAGE_LEVELS = literalOptions<LanguageValue['declared_level']>(
  LanguageSchema.properties.declared_level,
);

function LanguageFields({ value, onChange, errorFor }: FieldsProps<LanguageValue>) {
  const { t } = useTranslation();
  const patch = (partial: Partial<LanguageValue>) => onChange({ ...value, ...partial });
  return (
    <>
      <TextField
        label={t('factField.code')}
        description={t('factForm.languageCodeDescription')}
        required
        placeholder="en"
        maxLength={5}
        value={value.code}
        error={errorFor('code')}
        onChange={(event) => patch({ code: event.currentTarget.value })}
      />
      <Select
        label={t('factField.declared_level')}
        value={value.declared_level}
        error={errorFor('declared_level')}
        options={LANGUAGE_LEVELS.map((level) => ({
          value: level,
          label: t(`languageLevel.${level}`),
        }))}
        onChange={(event) =>
          patch({ declared_level: event.currentTarget.value as LanguageValue['declared_level'] })
        }
      />
    </>
  );
}

/**
 * Yes / no / unknown, with "unknown" a real, selectable, labelled option.
 * Nothing here ever defaults to yes (01_PRODUCT_REQUIREMENTS.md).
 */
function TriStateField({
  legend,
  description,
  name,
  value,
  onChange,
  error,
}: {
  readonly legend: string;
  readonly description?: string;
  readonly name: string;
  readonly value: TriState;
  readonly onChange: (next: TriState) => void;
  readonly error: string | null;
}) {
  const { t } = useTranslation();
  return (
    <RadioGroup<TriState>
      legend={legend}
      description={description}
      name={name}
      value={value}
      error={error}
      options={[
        { value: 'yes', label: t('triState.yes') },
        { value: 'no', label: t('triState.no') },
        {
          value: 'unknown',
          label: t('triState.unknown'),
          description: t('triState.unknownDescription'),
        },
      ]}
      onValueChange={onChange}
    />
  );
}

function AuthorizationFields({ value, onChange, errorFor }: FieldsProps<AuthorizationValue>) {
  const { t } = useTranslation();
  const groupId = useId();
  const patch = (partial: Partial<AuthorizationValue>) => onChange({ ...value, ...partial });
  return (
    <>
      <TextField
        label={t('factField.country')}
        description={t('factForm.countryCodeDescription')}
        required
        placeholder="US"
        maxLength={2}
        value={value.country}
        error={errorFor('country')}
        onChange={(event) => patch({ country: event.currentTarget.value.toUpperCase() })}
      />
      <TriStateField
        legend={t('factField.authorized')}
        description={t('factForm.authorizedDescription')}
        name={`${groupId}-authorized`}
        value={value.authorized}
        error={errorFor('authorized')}
        onChange={(authorized) => patch({ authorized })}
      />
      <TriStateField
        legend={t('factField.sponsorship_required')}
        description={t('factForm.sponsorshipDescription')}
        name={`${groupId}-sponsorship`}
        value={value.sponsorship_required}
        error={errorFor('sponsorship_required')}
        onChange={(sponsorship_required) => patch({ sponsorship_required })}
      />
      <TextField
        label={t('factField.note')}
        maxLength={300}
        value={value.note ?? ''}
        error={errorFor('note')}
        onChange={(event) => patch({ note: textOrNull(event.currentTarget.value) })}
      />
    </>
  );
}

function ProjectFields({ value, onChange, errorFor }: FieldsProps<ProjectValue>) {
  const { t } = useTranslation();
  const patch = (partial: Partial<ProjectValue>) => onChange({ ...value, ...partial });
  return (
    <>
      <TextField
        label={t('factField.name')}
        required
        value={value.name}
        error={errorFor('name')}
        onChange={(event) => patch({ name: event.currentTarget.value })}
      />
      <TextField
        label={t('factField.role')}
        value={value.role ?? ''}
        error={errorFor('role')}
        onChange={(event) => patch({ role: textOrNull(event.currentTarget.value) })}
      />
      <TextField
        label={t('factField.url')}
        type="url"
        value={value.url ?? ''}
        error={errorFor('url')}
        onChange={(event) => patch({ url: textOrNull(event.currentTarget.value) })}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <MonthField
          label={t('factField.start_month')}
          value={value.start_month}
          error={errorFor('start_month')}
          onChange={(next) => patch({ start_month: next })}
        />
        <MonthField
          label={t('factField.end_month')}
          value={value.end_month}
          error={errorFor('end_month')}
          onChange={(next) => patch({ end_month: next })}
        />
      </div>
      <BulletListField
        bullets={value.bullets}
        onChange={(bullets) => patch({ bullets })}
        errorFor={errorFor}
      />
      <StringListField
        label={t('factField.skills')}
        description={t('factForm.listDescription')}
        value={value.skills}
        error={errorFor('skills')}
        onChange={(skills) => patch({ skills })}
      />
    </>
  );
}

function CertificationFields({ value, onChange, errorFor }: FieldsProps<CertificationValue>) {
  const { t } = useTranslation();
  const patch = (partial: Partial<CertificationValue>) => onChange({ ...value, ...partial });
  return (
    <>
      <TextField
        label={t('factField.name')}
        required
        value={value.name}
        error={errorFor('name')}
        onChange={(event) => patch({ name: event.currentTarget.value })}
      />
      <TextField
        label={t('factField.issuer')}
        value={value.issuer ?? ''}
        error={errorFor('issuer')}
        onChange={(event) => patch({ issuer: textOrNull(event.currentTarget.value) })}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <MonthField
          label={t('factField.issued_month')}
          value={value.issued_month}
          error={errorFor('issued_month')}
          onChange={(next) => patch({ issued_month: next })}
        />
        <MonthField
          label={t('factField.expires_month')}
          value={value.expires_month}
          error={errorFor('expires_month')}
          onChange={(next) => patch({ expires_month: next })}
        />
      </div>
      <TextField
        label={t('factField.credential_id')}
        value={value.credential_id ?? ''}
        error={errorFor('credential_id')}
        onChange={(event) => patch({ credential_id: textOrNull(event.currentTarget.value) })}
      />
    </>
  );
}
