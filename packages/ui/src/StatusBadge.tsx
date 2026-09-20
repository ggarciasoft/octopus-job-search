import { Badge } from './Badge';
import { describeStatus, type StatusKey } from './status';

/** Text glyphs; a design system may swap these without touching the vocabulary. */
const ICON_GLYPHS = {
  dash: '–',
  question: '?',
  inbox: '!',
  eye: '👁',
  clock: '⏳',
  'check-verified': '✓✓',
  'check-reported': '✓',
} as const;

export interface StatusBadgeProps {
  readonly status: StatusKey;
  /**
   * Localised label. When omitted the English default from the vocabulary is
   * used, so the badge is never blank — but application screens are expected to
   * pass a translated string from their message catalogue.
   */
  readonly label?: string;
  /** Localised description, shown as a tooltip and to assistive technology. */
  readonly description?: string;
  readonly className?: string;
}

export function StatusBadge({ status, label, description, className }: StatusBadgeProps) {
  const descriptor = describeStatus(status);
  const text = label ?? descriptor.defaultLabel;
  const explanation = description ?? descriptor.defaultDescription;

  return (
    <Badge tone={descriptor.tone} className={className} title={explanation}>
      <span aria-hidden="true">{ICON_GLYPHS[descriptor.icon]}</span>
      <span data-status={descriptor.key} data-evidence={descriptor.evidence}>
        {text}
      </span>
    </Badge>
  );
}
