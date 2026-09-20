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
  {
    path: '/profile',
    labelKey: 'nav.profile',
    available: false,
    milestone: 'M1',
    missingKey: 'notImplemented.profile.missing',
  },
  {
    path: '/discover',
    labelKey: 'nav.discover',
    available: false,
    milestone: 'M2',
    missingKey: 'notImplemented.discover.missing',
  },
  {
    path: '/jobs',
    labelKey: 'nav.jobs',
    available: false,
    milestone: 'M2',
    missingKey: 'notImplemented.jobs.missing',
  },
  {
    path: '/cv-studio',
    labelKey: 'nav.cvStudio',
    available: false,
    milestone: 'M3',
    missingKey: 'notImplemented.cvStudio.missing',
  },
  {
    path: '/applications',
    labelKey: 'nav.applications',
    available: false,
    milestone: 'M4',
    missingKey: 'notImplemented.applications.missing',
  },
  {
    path: '/tracker',
    labelKey: 'nav.tracker',
    available: false,
    milestone: 'M4',
    missingKey: 'notImplemented.tracker.missing',
  },
  {
    path: '/settings',
    labelKey: 'nav.settings',
    available: false,
    milestone: 'M3–M5',
    missingKey: 'notImplemented.settings.missing',
  },
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
