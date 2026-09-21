import type { MessageKey } from './i18n/messages';

/**
 * The navigation model, and the single source of truth for which screens exist
 * for real. `available: false` items still have a route — but that route is an
 * honest explanation of what is missing, never a form or a list of invented
 * rows (invariant 10). Flip a flag here when its milestone actually lands.
 */
export interface NavItem {
  readonly path: string;
  readonly labelKey: MessageKey;
  readonly available: boolean;
  /** Milestone from 12_IMPLEMENTATION_PLAN.md that delivers the screen. */
  readonly milestone?: string;
  /** One-paragraph description of what the screen will contain. */
  readonly missingKey?: MessageKey;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { path: '/', labelKey: 'nav.dashboard', available: true },
  { path: '/diagnostics', labelKey: 'nav.diagnostics', available: true },
  { path: '/tasks', labelKey: 'nav.tasks', available: true },
  // M1: manual editing, import review and confirmed-versus-draft facts.
  { path: '/profile', labelKey: 'nav.profile', available: true },
  // M2: the board registry, scans, manual import, the jobs list and detail.
  { path: '/discover', labelKey: 'nav.discover', available: true },
  { path: '/jobs', labelKey: 'nav.jobs', available: true },
  // M3: tailored generation and original-file mode.
  { path: '/cv-studio', labelKey: 'nav.cvStudio', available: true },
  // M4: application packets, content-bound approval, the paired runner and the
  // tracker. Filling stops before submit, permanently.
  { path: '/applications', labelKey: 'nav.applications', available: true },
  { path: '/tracker', labelKey: 'nav.tracker', available: true },
  // M1 delivers preferences and the provider, M4 adds devices; the settings
  // layout lists what the later milestones still owe (schedules, export and
  // deletion).
  { path: '/settings', labelKey: 'nav.settings', available: true },
];

export interface PlaceholderScreen {
  readonly path: string;
  readonly labelKey: MessageKey;
  readonly milestone: string;
  readonly missingKey: MessageKey;
}

/** Narrowed view of the unavailable entries, for route registration. */
export const PLACEHOLDER_SCREENS: readonly PlaceholderScreen[] = NAV_ITEMS.filter(
  (item): item is NavItem & { milestone: string; missingKey: MessageKey } =>
    !item.available && item.milestone !== undefined && item.missingKey !== undefined,
).map((item) => ({
  path: item.path,
  labelKey: item.labelKey,
  milestone: item.milestone,
  missingKey: item.missingKey,
}));

/**
 * Where the implementation status record lives
 * (00_AI_IMPLEMENTATION_INSTRUCTIONS.md, "Definition of done per milestone").
 *
 * The file lives at the repository root. It is a repository document rather
 * than an app route, so the location is configurable: a hosted deployment can
 * point `VITE_IMPLEMENTATION_STATUS_URL` at its published copy. The path is
 * also printed as text in the link label, so it stays findable even where the
 * link itself 404s.
 */
export const IMPLEMENTATION_STATUS_PATH = 'IMPLEMENTATION_STATUS.md';

export function implementationStatusUrl(): string {
  const configured = import.meta.env?.VITE_IMPLEMENTATION_STATUS_URL;
  return typeof configured === 'string' && configured !== ''
    ? configured
    : `/${IMPLEMENTATION_STATUS_PATH}`;
}
