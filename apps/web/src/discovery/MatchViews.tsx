import type {
  EligibilityCheck,
  MatchComponent,
  MatchEvidence,
  MatchExplanation,
  MatchSummary,
  MatchedRequirement,
} from '@job-getter/contracts';
import { Badge, Disclosure, StatusBadge } from '@job-getter/ui';
import { useTranslation } from '../i18n/I18nProvider';
import { formatNumber } from '../i18n/format';
import {
  ELIGIBILITY_CODE_LABEL,
  ELIGIBILITY_FILTER_LABEL,
  ELIGIBILITY_VERDICT_LABEL,
  ELIGIBILITY_VERDICT_TONE,
  MATCH_COMPONENT_LABEL,
  MATCH_UNKNOWN_LABEL,
  REQUIREMENT_OUTCOME_LABEL,
  REQUIREMENT_OUTCOME_ORDER,
  REQUIREMENT_OUTCOME_TONE,
} from './labels';

/**
 * Rendering a fit score honestly.
 *
 * The rules this file exists to keep are all about what a number is allowed to
 * imply. A score is a heuristic ranking, never a probability of being hired
 * (invariant 3), so it never appears as a bare percentage and never without
 * its coverage. A job nobody has scored says "Not checked" rather than showing
 * a zero. A score whose inputs have changed says so instead of being quietly
 * redrawn. And a component nothing could be read for is reported as unknown,
 * not as a mark against the person.
 */

/** The jobs-list cell: a score is never shown without its coverage. */
export function MatchCell({ match }: { readonly match: MatchSummary | null }) {
  const { t, locale } = useTranslation();

  if (match === null) {
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

  return (
    <span className="flex flex-col gap-1" data-testid="match-cell" data-match="scored">
      {match.score === null ? (
        <span data-testid="match-score-unknown" className="text-sm text-slate-700">
          {t('match.scoreUnknown')}
        </span>
      ) : (
        <span className="flex items-baseline gap-1">
          <span className="text-base font-semibold" data-testid="match-score">
            {formatNumber(locale, match.score)}
          </span>
          {/* Not a percent sign: this is a ranking out of 100, not a chance. */}
          <span className="text-xs text-slate-600">{t('match.scoreOutOf')}</span>
        </span>
      )}
      <span className="text-xs text-slate-600" data-testid="match-coverage">
        {t('match.coverage', { percent: formatNumber(locale, match.coverage_percent) })}
      </span>
      <Badge tone={ELIGIBILITY_VERDICT_TONE[match.eligible]}>
        <span data-testid="match-eligible">{t(ELIGIBILITY_VERDICT_LABEL[match.eligible])}</span>
      </Badge>
      {match.stale ? (
        <Badge tone="warning" title={t('match.staleDescription')}>
          <span data-testid="match-stale">{t('match.stale')}</span>
        </Badge>
      ) : null}
    </span>
  );
}

function EvidenceList({ evidence }: { readonly evidence: readonly MatchEvidence[] }) {
  const { t } = useTranslation();
  if (evidence.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1">
      {evidence.map((item, index) => (
        <li key={`${item.source}-${index}`} className="text-sm">
          <span className="text-xs uppercase tracking-wide text-slate-600">
            {item.source === 'job' ? t('match.evidenceFromJob') : t('match.evidenceFromProfile')}
          </span>{' '}
          {/* The excerpt is the posting's or the CV's own words: verbatim. */}
          <q className="text-slate-800">{item.excerpt}</q>
        </li>
      ))}
    </ul>
  );
}

function ComponentRow({ component }: { readonly component: MatchComponent }) {
  const { t, locale } = useTranslation();
  const label = t(MATCH_COMPONENT_LABEL[component.key]);

  return (
    <li
      className="flex flex-col gap-1 border-b border-slate-200 py-2 last:border-b-0"
      data-testid="match-component"
      data-component={component.key}
      data-evaluable={component.evaluable ? 'true' : 'false'}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">{label}</span>
        {component.evaluable && component.value !== null ? (
          <span data-testid="component-value">
            {t('match.componentValue', {
              value: formatNumber(locale, Math.round(component.value * 100)),
              weight: formatNumber(locale, component.weight),
            })}
          </span>
        ) : (
          /* Not "0": a component nothing could be read for is not a bad score. */
          <Badge tone="unknown">
            <span data-testid="component-unknown">{t('match.componentNotEvaluated')}</span>
          </Badge>
        )}
      </div>
      {component.unknown_code === null ? null : (
        <p className="text-sm text-slate-700" data-testid="component-unknown-reason">
          {t(MATCH_UNKNOWN_LABEL[component.unknown_code])}
        </p>
      )}
      <EvidenceList evidence={component.evidence} />
    </li>
  );
}

function EligibilityRow({ check }: { readonly check: EligibilityCheck }) {
  const { t } = useTranslation();
  return (
    <li
      className="flex flex-col gap-1 border-b border-slate-200 py-2 last:border-b-0"
      data-testid="eligibility-check"
      data-filter={check.filter}
      data-verdict={check.verdict}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">{t(ELIGIBILITY_FILTER_LABEL[check.filter])}</span>
        <Badge tone={ELIGIBILITY_VERDICT_TONE[check.verdict]}>
          {t(ELIGIBILITY_VERDICT_LABEL[check.verdict])}
        </Badge>
      </div>
      <p className="text-sm text-slate-700" data-testid="eligibility-reason">
        {t(ELIGIBILITY_CODE_LABEL[check.code])}
      </p>
      {check.verdict === 'unknown' && check.blocking ? (
        <p className="text-sm font-medium text-slate-800" data-testid="eligibility-blocking">
          {t('eligibility.blocksApplication')}
        </p>
      ) : null}
      <EvidenceList evidence={check.evidence} />
    </li>
  );
}

function RequirementRow({ entry }: { readonly entry: MatchedRequirement }) {
  const { t } = useTranslation();
  return (
    <li
      className="flex flex-col gap-1 border-b border-slate-200 py-2 last:border-b-0"
      data-testid="match-requirement"
      data-outcome={entry.outcome}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span>{entry.requirement.text}</span>
        <Badge tone={REQUIREMENT_OUTCOME_TONE[entry.outcome]}>
          {t(REQUIREMENT_OUTCOME_LABEL[entry.outcome])}
        </Badge>
      </div>
      {entry.outcome === 'uncertain' && entry.matched_skill !== null ? (
        <p className="text-sm text-slate-700" data-testid="requirement-uncertain">
          {t('match.uncertainExplanation', { skill: entry.matched_skill })}
        </p>
      ) : null}
      {entry.outcome === 'matched' && entry.matched_skill !== null ? (
        <p className="text-sm text-slate-700" data-testid="requirement-matched-skill">
          {t('match.matchedVia', { skill: entry.matched_skill })}
        </p>
      ) : null}
      <Disclosure summary={t('match.showRequirementEvidence')}>
        <q className="text-sm text-slate-800">{entry.requirement.evidence_excerpt}</q>
      </Disclosure>
    </li>
  );
}

export interface FitPanelProps {
  readonly match: MatchSummary;
  readonly explanation: MatchExplanation;
}

export function FitPanel({ match, explanation }: FitPanelProps) {
  const { t, locale } = useTranslation();

  // Gaps first. A list that opens with what matched flatters; a list that
  // opens with what is missing is the one worth reading before applying.
  const requirements = [...explanation.requirements].sort(
    (left, right) =>
      REQUIREMENT_OUTCOME_ORDER.indexOf(left.outcome) -
      REQUIREMENT_OUTCOME_ORDER.indexOf(right.outcome),
  );

  return (
    <section className="flex flex-col gap-4" aria-labelledby="fit-heading" data-testid="fit-panel">
      <header className="flex flex-col gap-2">
        <h2 id="fit-heading" className="text-lg font-semibold">
          {t('match.heading')}
        </h2>
        {/* Invariant 3, stated where the number is, not in a footnote. */}
        <p className="text-sm text-slate-700" data-testid="fit-disclaimer">
          {t('match.heuristicNotice')}
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        {match.score === null ? (
          <p data-testid="fit-score-unknown">{t('match.scoreUnknownExplanation')}</p>
        ) : (
          <p data-testid="fit-score">
            {t('match.scoreWithCoverage', {
              score: formatNumber(locale, match.score),
              percent: formatNumber(locale, match.coverage_percent),
            })}
          </p>
        )}
        <Badge tone={ELIGIBILITY_VERDICT_TONE[match.eligible]}>
          {t(ELIGIBILITY_VERDICT_LABEL[match.eligible])}
        </Badge>
      </div>

      {match.stale ? (
        <p className="text-sm text-slate-800" data-testid="fit-stale-notice">
          {t('match.staleNotice')}
        </p>
      ) : null}

      {explanation.unknown_components.length > 0 ? (
        <p className="text-sm text-slate-700" data-testid="fit-coverage-note">
          {t('match.coverageNote', {
            components: explanation.unknown_components
              .map((key) => t(MATCH_COMPONENT_LABEL[key]))
              .join(', '),
          })}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <h3 className="font-semibold">{t('eligibility.heading')}</h3>
        <ul className="flex flex-col">
          {explanation.eligibility.map((check) => (
            <EligibilityRow key={check.filter} check={check} />
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="font-semibold">{t('match.componentsHeading')}</h3>
        <ul className="flex flex-col">
          {explanation.components.map((component) => (
            <ComponentRow key={component.key} component={component} />
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="font-semibold">{t('match.requirementsHeading')}</h3>
        {requirements.length === 0 ? (
          /* The same honesty as the job detail's own requirement list: an
             empty list means nothing was extracted, not that nothing is asked. */
          <p className="text-sm text-slate-700" data-testid="fit-no-requirements">
            {t('match.noRequirements')}
          </p>
        ) : (
          <ul className="flex flex-col">
            {requirements.map((entry, index) => (
              <RequirementRow key={`${entry.requirement.text}-${index}`} entry={entry} />
            ))}
          </ul>
        )}
      </div>

      <p className="text-xs text-slate-600" data-testid="fit-versions">
        {t('match.versions', {
          algorithm: explanation.algorithm_version,
          aliases: explanation.alias_map_version,
        })}
      </p>
    </section>
  );
}
