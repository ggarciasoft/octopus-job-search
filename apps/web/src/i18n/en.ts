/**
 * English message catalogue.
 *
 * This is the authoritative key set: `MessageKey` is derived from it and `es.ts`
 * is typed as `Record<MessageKey, string>`, so a missing or extra Spanish key is
 * a compile error, not a runtime surprise.
 *
 * Placeholders use `{name}` and are substituted by `translate()`.
 *
 * SCOPE OF TRANSLATION — this boundary is a product rule, not a preference.
 * 08_UX_AND_CUSTOMIZATION.md: "English/Spanish locale switching affects UI and
 * new documents; do not silently translate stored facts." Everything in this
 * file is UI chrome. User-owned content (profile facts, job descriptions,
 * answers, and in M0 the echoed diagnostic message) is rendered verbatim and is
 * never routed through a translator — see `src/i18n/index.ts`.
 */
export const en = {
  'app.name': 'Job Getter',
  'app.tagline': 'Truthful, user-controlled job application help.',

  'nav.skipToContent': 'Skip to main content',
  'nav.primary': 'Primary',
  'nav.dashboard': 'Dashboard',
  'nav.diagnostics': 'Diagnostics',
  'nav.tasks': 'Tasks',
  'nav.profile': 'Profile',
  'nav.discover': 'Discover',
  'nav.jobs': 'Jobs',
  'nav.cvStudio': 'CV studio',
  'nav.applications': 'Applications',
  'nav.tracker': 'Tracker',
  'nav.settings': 'Settings',
  'nav.unavailable': 'Not available yet',
  'nav.unavailableHint': 'Opens an explanation of what is missing. It is not a working screen.',

  'action.signOut': 'Sign out',
  'action.signIn': 'Sign in',
  'action.retry': 'Try again',
  'action.reload': 'Reload the page',
  'action.cancel': 'Cancel',
  'action.close': 'Close',
  'action.loadMore': 'Load more',
  'action.refresh': 'Refresh',

  'common.loading': 'Loading…',
  'common.unknown': 'Unknown',
  'common.notReported': 'Not reported',
  'common.requestId': 'Request ID: {requestId}',
  'common.implementationStatus': 'Implementation status (IMPLEMENTATION_STATUS.md)',
  'common.yes': 'Yes',
  'common.no': 'No',

  'locale.label': 'Language',
  'locale.en': 'English',
  'locale.es': 'Español',
  'locale.storedLocally':
    'The language choice is stored in this browser. The API has no route for changing the workspace language yet, so it is not saved to your account.',
  'locale.factsNote':
    'Language affects labels and documents generated from now on. Facts you saved are never machine-translated.',

  'auth.checking': 'Checking your session…',
  'auth.signedInAs': 'Signed in as {email}',
  'auth.signOutFailed': 'Sign out failed. You may still have an active session.',
  'auth.sessionEnded': 'Your session ended. Sign in again to continue.',

  'login.title': 'Sign in',
  'login.intro': 'Sign in with the owner account created during setup.',
  'login.email': 'Email',
  'login.password': 'Password',
  'login.submit': 'Sign in',
  'login.busy': 'Signing in',
  'login.emailRequired': 'Enter the email address you signed up with.',
  'login.passwordRequired': 'Enter your password.',
  'login.invalidCredentials':
    'That email and password combination was not accepted. For your protection the server does not say which part was wrong, or whether an account exists.',
  'login.rateLimited':
    'Too many sign-in attempts. The server is rate-limiting this address; wait about a minute before trying again. Further attempts may extend the wait.',
  'login.setupLink': 'First run on this machine? Complete one-time setup.',

  'setup.title': 'One-time setup',
  'setup.checking': 'Checking whether this installation still needs setup…',
  'setup.closedTitle': 'Setup is already closed',
  'setup.closedBody':
    'An owner account already exists for this installation. The setup route closes permanently after the first owner is created and cannot be reopened from the web app.',
  'setup.closedLogin': 'Go to sign in',
  'setup.requiredTitle': 'Create the owner account',
  'setup.requiredIntro':
    'This installation has no owner yet. Creating one closes this route permanently.',
  'setup.tokenLabel': 'Setup token',
  'setup.tokenDescription':
    'Printed once to the terminal or container log that started the API. It is not stored anywhere you can read it again — if you lost it, restart the API with a new SETUP_TOKEN.',
  'setup.emailLabel': 'Email',
  'setup.emailDescription': 'Used to sign in. It is stored in your own database.',
  'setup.passwordLabel': 'Password',
  'setup.passwordDescription':
    'At least 12 characters. Hashed with Argon2id; never stored as text.',
  'setup.localeLabel': 'Interface language',
  'setup.submit': 'Create owner account',
  'setup.busy': 'Creating account',
  'setup.tokenRequired': 'Paste the setup token from the terminal.',
  'setup.emailRequired': 'Enter an email address.',
  'setup.passwordTooShort': 'Use at least 12 characters.',
  'setup.modeTitle': 'Local and hosted installations differ',
  'setup.modeLocal':
    'Local: everything runs on this machine. Your CVs, provider keys and browser sessions stay here. Browser form filling runs in your own desktop browser, and the final submit is always performed by you.',
  'setup.modeHosted':
    'Hosted: the API, worker, database and files run on a server. Job-site credentials and cookies never leave your browser, so filling happens through the extension. Hosted operator limits can be stricter than your own settings, never looser.',
  'setup.modeDetected': 'This API reports that it is running in {mode} mode.',
  'setup.registrationClosed':
    'Self-service registration is closed on this installation; the owner account is created here.',
  'setup.nextTitle': 'What is not on this screen yet',
  'setup.nextBody':
    'The specification also puts AI provider configuration, a connection test and optional profile import on this screen. They live under Settings and Profile once you are signed in, rather than being duplicated here.',

  'dashboard.title': 'Dashboard',
  'dashboard.intro':
    'What this installation can actually do right now, read from the capability flags the API reports. Anything marked unavailable is not implemented — it is not a configuration you are missing.',
  'dashboard.workerTitle': 'Background worker',
  'dashboard.workerOnline': 'The worker is online and claiming tasks.',
  'dashboard.workerOffline': 'No worker has claimed a task recently.',
  'dashboard.workerOfflineDetail':
    'Queued tasks stay queued until a worker comes back. Nothing you start will finish while this says offline. Start the worker container, or run the worker service locally.',
  'dashboard.capabilitiesTitle': 'Capabilities',
  'dashboard.capabilityAvailable': 'Available',
  'dashboard.capabilityUnavailable': 'Unavailable',
  'dashboard.taskTypesTitle': 'Task types with a real handler',
  'dashboard.taskTypesIntro':
    'Every other task type in the contract returns an error rather than pretending to run.',
  'dashboard.taskTypesNone': 'The API reports no implemented task types.',
  'dashboard.usageTitle': 'Usage today',
  'dashboard.workspaceTitle': 'Workspace',
  'dashboard.statusIntro':
    'Milestones M2 to M7 are not built yet. The implementation status document is the single record of what is done.',
  'dashboard.statusVocabularyTitle': 'What the status words mean',
  'dashboard.statusVocabularyIntro':
    'These seven states are used across the product and mean different things. They are listed here as a reference; none of them describes anything you have right now.',

  'capability.ai_provider_configured': 'AI provider configured',
  'capability.ai_provider_configured.description':
    'A local or cloud model provider is configured and reachable. Without one, manual profile editing, job import and tracking still work.',
  'capability.profile_import': 'Profile import',
  'capability.profile_import.description':
    'Extracting a profile from a PDF, DOCX or pasted text, with a review step before anything is confirmed.',
  'capability.job_discovery': 'Job discovery',
  'capability.job_discovery.description':
    'Fetching listings from configured company boards and importing single job URLs.',
  'capability.cv_generation': 'CV generation',
  'capability.cv_generation.description':
    'Producing a tailored PDF or DOCX from confirmed facts, or preserving your original file byte for byte.',
  'capability.applications': 'Applications',
  'capability.applications.description':
    'Application packets, the answer bank, approval snapshots and outcome tracking.',
  'capability.browser_filling': 'Browser filling',
  'capability.browser_filling.description':
    'Filling a supported form in your own browser. The final submit is always performed by you.',
  'capability.extension': 'Browser extension',
  'capability.extension.description':
    'The Chrome extension that fills forms inside your existing browser session.',

  'usage.aiRequests': 'AI requests',
  'usage.aiRequestsValue': '{used} of {limit}',
  'usage.inputTokens': 'Input tokens',
  'usage.outputTokens': 'Output tokens',
  'usage.cost': 'Measured cost',
  'usage.costUnknown': 'Not measured — no rate card is configured, which is not the same as zero.',
  'usage.budget': 'Daily budget',
  'usage.budgetNone': 'No budget set',

  'workspace.mode': 'Mode',
  'workspace.locale': 'Workspace language',
  'workspace.role': 'Role',
  'workspace.id': 'Workspace ID',
  'workspace.email': 'Account',
  'mode.local': 'Local',
  'mode.hosted': 'Hosted',
  'role.owner': 'Owner',

  'diagnostics.title': 'Diagnostics',
  'diagnostics.intro':
    'The end-to-end probe for milestone M0. It queues a real task, a real worker claims it, and the result comes back through the real API. Nothing here is simulated in the browser.',
  'diagnostics.formTitle': 'Run a probe',
  'diagnostics.messageLabel': 'Message to echo',
  'diagnostics.messageDescription':
    'Sent to the worker and returned unchanged. This is your own text: it is shown back to you exactly as the worker returned it and is never translated.',
  'diagnostics.messageRequired': 'Enter a message to send.',
  'diagnostics.delayLabel': 'Simulated work',
  'diagnostics.delayDescription':
    'Optional artificial delay so progress, heartbeat and cancellation are observable.',
  'diagnostics.delayNone': 'None',
  'diagnostics.delayShort': '2 seconds',
  'diagnostics.delayMedium': '10 seconds',
  'diagnostics.delayLong': '30 seconds',
  'diagnostics.submit': 'Queue probe task',
  'diagnostics.busy': 'Queueing',
  'diagnostics.idempotencyNote':
    'Retrying after a failure reuses the same Idempotency-Key, so a request that reached the server is never queued twice.',
  'diagnostics.workerOfflineWarning':
    'The API reports no worker online. A probe queued now will stay queued until a worker starts.',
  'diagnostics.taskTitle': 'Task {taskId}',
  'diagnostics.lifecycle': 'Lifecycle',
  'diagnostics.lifecycleCurrent': 'Current state: {state}',
  'diagnostics.attempt': 'Attempt {attempt} of {max}',
  'diagnostics.elapsed': 'Elapsed',
  'diagnostics.elapsedValue': '{seconds} s',
  'diagnostics.createdAt': 'Queued at',
  'diagnostics.updatedAt': 'Last update',
  'diagnostics.queuedNoWorkerTitle': 'Nothing is processing this task',
  'diagnostics.queuedNoWorker':
    'The task is queued and the API reports no worker online, so no process will pick it up. It is not running slowly — it is not running at all. It stays in the queue and starts as soon as a worker connects; you do not need to queue it again.',
  'diagnostics.progressLabel': 'Task progress',
  'diagnostics.progressNone': 'The worker has not reported progress yet.',
  'diagnostics.workerId': 'Worker',
  'diagnostics.workerRuntime': 'Worker runtime',
  'diagnostics.processedAt': 'Processed at',
  'diagnostics.echoed': 'Echoed message',
  'diagnostics.succeededTitle': 'Task succeeded',
  'diagnostics.succeededBody':
    'The full path worked: web → API → queue → worker → stored result → this screen.',
  'diagnostics.failedTitle': 'Task failed',
  'diagnostics.failureCode': 'Error code',
  'diagnostics.failureMessage': 'Reported message',
  'diagnostics.failureRetryable': 'The server considers this failure retryable.',
  'diagnostics.failureNotRetryable': 'The server considers this failure final.',
  'diagnostics.cancelledTitle': 'Task cancelled',
  'diagnostics.cancelledBody': 'The task stopped before producing a result.',
  'diagnostics.cancel': 'Cancel task',
  'diagnostics.cancelBusy': 'Requesting cancellation',
  'diagnostics.cancelRequested':
    'Cancellation requested. Running work stops at its next safe checkpoint, so the state may not change immediately.',
  'diagnostics.rawResult': 'Raw result JSON',
  'diagnostics.rawResultNone': 'The task has not returned a result.',
  'diagnostics.resultUnrecognised':
    'The result did not match the expected noop_echo shape. It is shown raw below rather than guessed at.',
  'diagnostics.pollingPaused': 'Polling is paused while this tab is hidden.',
  'diagnostics.startAnother': 'Start another run',
  'diagnostics.loadFailed': 'The task could not be read.',

  'taskState.queued': 'Queued',
  'taskState.leased': 'Leased',
  'taskState.succeeded': 'Succeeded',
  'taskState.failed': 'Failed',
  'taskState.cancelled': 'Cancelled',
  'taskState.queued.description': 'Waiting for a worker to claim it.',
  'taskState.leased.description': 'A worker holds the lease and is running it.',
  'taskState.succeeded.description': 'The worker returned a validated result.',
  'taskState.failed.description': 'The worker reported a failure, or attempts ran out.',
  'taskState.cancelled.description': 'Stopped before completion at your request.',

  'tasks.title': 'Tasks',
  'tasks.intro': 'Background work for this workspace, newest first.',
  'tasks.caption': 'Recent tasks',
  'tasks.columnType': 'Type',
  'tasks.columnState': 'State',
  'tasks.columnProgress': 'Progress',
  'tasks.columnAttempt': 'Attempt',
  'tasks.columnCreated': 'Queued at',
  'tasks.columnUpdated': 'Last update',
  'tasks.loading': 'Loading tasks',
  'tasks.emptyTitle': 'No tasks have run yet',
  'tasks.emptyBody':
    'This workspace has never queued a background task. This is an empty list, not a failed query.',
  'tasks.emptySuggestionDiagnostics': 'Run the M0 diagnostics probe to queue a real task.',
  'tasks.emptySuggestionWorker':
    'Check that the worker is online on the dashboard — without one, tasks queue but never run.',
  'tasks.endOfList': 'That is every task the API returned.',
  'tasks.cancelRequestedShort': 'Cancellation requested',
  'tasks.loadFailed': 'The task list could not be loaded.',

  'notImplemented.badge': 'Not implemented',
  'notImplemented.title': '{screen} is not available yet',
  'notImplemented.milestone': 'Delivered in milestone {milestone}.',
  'notImplemented.intro':
    'This screen has no working controls. Rather than show a form that would appear to save something, it lists what is missing.',
  'notImplemented.missingTitle': 'What is missing',
  'notImplemented.noFakeData':
    'No example jobs, matches or applications are shown here. Fabricating them as live results is forbidden by the specification.',
  'notImplemented.profile.missing':
    'Manual profile editing, CV upload, PDF and DOCX extraction, the import review with field-level diffs, and confirmed-versus-draft fact revisions.',
  'notImplemented.discover.missing':
    'Search preferences, the source registry, the Greenhouse and Lever connectors, scan scheduling and scan coverage reporting.',
  'notImplemented.jobs.missing':
    'Normalized job records, filters, match scores with coverage, eligibility and freshness badges, and the saved and excluded views.',
  'notImplemented.cvStudio.missing':
    'Original-versus-tailored CV modes, templates, language selection, the fact and change review, and PDF and DOCX downloads.',
  'notImplemented.applications.missing':
    'Application packets, the answer bank, unresolved required questions and the approval snapshot with its content hash.',
  'notImplemented.tracker.missing':
    'The status list, outcome evidence, the event timeline and duplicate-application prevention.',
  'notImplemented.settings.missing':
    'Provider and model configuration, budgets, prompt and template choices, scan schedules, paired devices, and data export and deletion.',

  'status.not_checked.label': 'Not checked',
  'status.not_checked.description': 'Nothing has looked at this yet. It is not a negative result.',
  'status.unknown.label': 'Unknown',
  'status.unknown.description':
    'This was checked and the answer could not be determined. Unknown never counts as a yes.',
  'status.needs_your_answer.label': 'Needs your answer',
  'status.needs_your_answer.description':
    'Something cannot continue until you supply or confirm a fact. Nothing is guessed on your behalf.',
  'status.ready_for_review.label': 'Ready for review',
  'status.ready_for_review.description':
    'A draft is prepared and waiting for you to read it. Nothing has been sent.',
  'status.waiting_for_submission.label': 'Waiting for submission',
  'status.waiting_for_submission.description':
    'You approved this, and the final submit still has to be performed by you in your browser.',
  'status.submitted_verified.label': 'Submitted — verified',
  'status.submitted_verified.description':
    'Evidence of the submission was captured, such as a confirmation page or an acknowledgement email.',
  'status.submitted_reported_by_you.label': 'Submitted — reported by you',
  'status.submitted_reported_by_you.description':
    'You told us you submitted this. No evidence was captured, so it is recorded as your report, not as a verified fact.',

  'notFound.title': 'That page does not exist',
  'notFound.body':
    'No screen is registered at this address. It may belong to a milestone that has not been built yet.',
  'notFound.home': 'Go to the dashboard',

  'error.title': 'That did not work',
  'error.workPreserved': 'Nothing you typed was cleared — correct it and try again.',
  'error.fieldsTitle': 'Fields the server rejected',
  'error.boundaryTitle': 'This screen stopped working',
  'error.boundaryBody':
    'An unexpected error reached the top of the application. The details below are the real error, not a placeholder.',
  'error.network':
    'The API could not be reached. Check that it is running and that your connection is up.',
  'error.unexpected': 'An unexpected error occurred.',
  'error.VALIDATION_ERROR': 'The server rejected part of this form. Review the highlighted fields.',
  'error.MALFORMED_REQUEST': 'The request was malformed and the server refused it.',
  'error.UNAUTHENTICATED': 'You are not signed in, or your session expired.',
  'error.FORBIDDEN': 'This account is not allowed to do that.',
  'error.NOT_FOUND': 'That item does not exist, or it is not visible to this workspace.',
  'error.CONFLICT':
    'Someone or something else changed this while you were working. Reload and reapply your change.',
  'error.STALE_REVISION':
    'Someone or something else changed this while you were working. Reload to get the current version, then reapply your change — your edit was not saved.',
  'error.IDEMPOTENCY_MISMATCH':
    'That idempotency key was already used with a different request body. Start a new run rather than retrying this one.',
  'error.PAYLOAD_TOO_LARGE': 'The upload is larger than this installation accepts.',
  'error.UNPROCESSABLE': 'The server understood the request but the values are not usable.',
  'error.QUOTA_EXCEEDED': 'A limit was reached. Wait before retrying, or lower the request rate.',
  'error.SETUP_CLOSED':
    'Setup has already been completed on this installation and cannot be run again.',
  'error.BUDGET_EXHAUSTED':
    'The configured spending budget is exhausted. Review and export still work; new inference is blocked.',
  'error.PROVIDER_UNAVAILABLE':
    'The model provider did not respond. No other provider was substituted, and your work was kept.',
  'error.INTERNAL_ERROR':
    'The server hit an internal error. The request ID below identifies it in the logs.',

  // --- M1: profile ---------------------------------------------------------
  'fact.confirmed': 'Confirmed',
  'fact.confirmedDescription':
    'You confirmed this fact. Only confirmed facts can be used in CVs and applications.',
  'fact.draft': 'Draft — ready for review',
  'fact.draftDescription':
    'Proposed by an import or saved without confirmation. It is not a fact until you confirm it, and nothing is generated from it.',

  'factKind.contact': 'Contact',
  'factKind.contact.plural': 'Contact facts',
  'factKind.summary': 'Summary',
  'factKind.summary.plural': 'Summary',
  'factKind.experience': 'Experience',
  'factKind.experience.plural': 'Experience',
  'factKind.education': 'Education',
  'factKind.education.plural': 'Education',
  'factKind.skill': 'Skill',
  'factKind.skill.plural': 'Skills',
  'factKind.language': 'Language',
  'factKind.language.plural': 'Languages',
  'factKind.authorization': 'Work authorization',
  'factKind.authorization.plural': 'Work authorization and eligibility',
  'factKind.project': 'Project',
  'factKind.project.plural': 'Projects',
  'factKind.certification': 'Certification',
  'factKind.certification.plural': 'Certifications',

  'factField.full_name': 'Full name',
  'factField.email': 'Email',
  'factField.phone': 'Phone',
  'factField.city': 'City',
  'factField.country': 'Country',
  'factField.links': 'Links',
  'factField.text': 'Summary text',
  'factField.employer': 'Employer',
  'factField.title': 'Job title',
  'factField.start_month': 'Start month',
  'factField.end_month': 'End month',
  'factField.period': 'Period',
  'factField.current': 'This is my current role',
  'factField.currentStudies': 'I am still studying here',
  'factField.currentLabel': 'present',
  'factField.employment_type': 'Employment type',
  'factField.location': 'Location',
  'factField.bullets': 'Bullets',
  'factField.evidence_reference': 'evidence',
  'factField.skills': 'Skills',
  'factField.institution': 'Institution',
  'factField.degree': 'Degree',
  'factField.subject': 'Subject',
  'factField.canonical_name': 'Skill name',
  'factField.aliases': 'Aliases',
  'factField.user_declared_proficiency': 'Proficiency (declared by you)',
  'factField.years': 'Years of experience',
  'factField.code': 'Language code',
  'factField.declared_level': 'Level (declared by you)',
  'factField.authorized': 'Authorized to work in this country',
  'factField.sponsorship_required': 'Sponsorship required',
  'factField.note': 'Note',
  'factField.name': 'Name',
  'factField.role': 'Role',
  'factField.url': 'URL',
  'factField.issuer': 'Issuer',
  'factField.issued_month': 'Issued',
  'factField.expires_month': 'Expires',
  'factField.credential_id': 'Credential ID',
  'factField.notStated': 'Not stated',

  'factForm.required': 'This field is required.',
  'factForm.monthFormat': 'Use the format YYYY-MM, for example 2023-09.',
  'factForm.monthDescription': 'Calendar month as YYYY-MM.',
  'factForm.endMonthDescription': 'Leave empty if this has not ended.',
  'factForm.endBeforeStart': 'The end month cannot be earlier than the start month.',
  'factForm.currentHasEnd':
    'A current role cannot also have an end month. Clear the end month or untick "current".',
  'factForm.currentDescription':
    'When ticked, the end month must be empty. The server rejects a current role with an end date.',
  'factForm.yearsRange': 'Years must be between 0 and 70.',
  'factForm.languageCode': 'Use a two-letter code such as en, or en-US.',
  'factForm.languageCodeDescription': 'ISO 639-1 code, optionally with a region: en, es, pt-BR.',
  'factForm.countryCode': 'Use a two-letter ISO country code such as US or ES.',
  'factForm.countryCodeDescription': 'ISO 3166-1 alpha-2 code, for example US, DE or MX.',
  'factForm.listDescription': 'One entry per line.',
  'factForm.summaryDescription':
    'Your own words. This is stored exactly as typed and is never rewritten without your review.',
  'factForm.proficiencyDescription':
    'Only you declare this. Nothing infers a level from a CV mention, so "Not declared" is a valid answer.',
  'factForm.authorizedDescription':
    'Whether you may legally work in this country today. "Unknown" is a real answer and is never treated as yes.',
  'factForm.sponsorshipDescription':
    'Whether an employer would need to sponsor you. Independent of the answer above; "Unknown" stays unknown.',
  'factForm.bulletsDescription':
    'Achievements or responsibilities. Each bullet carries a reference to where it comes from.',
  'factForm.bulletText': 'Bullet {n}',
  'factForm.bulletEvidence': 'Evidence reference for bullet {n}',
  'factForm.bulletEvidenceDescription':
    'Where this comes from: a page or paragraph of your document, or a note that you typed it yourself.',
  'factForm.addBullet': 'Add bullet',
  'factForm.removeBullet': 'Remove bullet {n}',
  'factForm.linkLabel': 'Link {n} label',
  'factForm.linkUrl': 'Link {n} URL',
  'factForm.addLink': 'Add link',
  'factForm.removeLink': 'Remove link {n}',
  'factForm.confirmedLabel': 'Mark this fact as confirmed',
  'factForm.confirmedDescription':
    'Tick only if this is accurate. Confirmed facts are the only ones a CV or an application may use. Leaving it unticked keeps it as a draft.',

  'employmentType.full_time': 'Full time',
  'employmentType.part_time': 'Part time',
  'employmentType.contract': 'Contract',
  'employmentType.internship': 'Internship',
  'employmentType.temporary': 'Temporary',
  'employmentType.freelance': 'Freelance',
  'employmentType.unknown': 'Unknown',

  'proficiency.notDeclared': 'Not declared',
  'proficiency.beginner': 'Beginner',
  'proficiency.intermediate': 'Intermediate',
  'proficiency.advanced': 'Advanced',
  'proficiency.expert': 'Expert',

  'languageLevel.basic': 'Basic',
  'languageLevel.conversational': 'Conversational',
  'languageLevel.professional': 'Professional',
  'languageLevel.native': 'Native',

  'triState.yes': 'Yes',
  'triState.no': 'No',
  'triState.unknown': 'Unknown',
  'triState.unknownDescription':
    'Not established. Unknown never counts as yes; it blocks application readiness until you resolve it.',

  'profile.title': 'Profile',
  'profile.intro':
    'Your facts, grouped by kind. Every fact is either confirmed by you or a draft waiting for your review; the two are never mixed. Only confirmed facts can appear in a CV or an application.',
  'profile.importLink': 'Import from a PDF, DOCX or pasted text',
  'profile.stateTitle': 'Draft versus confirmed',
  'profile.revisionInfo': 'Profile revision {revision}. Last confirmed revision: {confirmed}.',
  'profile.noConfirmedRevision': 'none — no confirmed fact exists yet',
  'profile.loading': 'Loading your profile…',
  'profile.loadFailed': 'The profile could not be loaded.',
  'profile.saved': 'Saved. The profile is now at revision {revision}.',
  'profile.saving': 'Saving',
  'profile.reload': 'Reload the profile (your typed values stay)',
  'profile.contactTitle': 'Contact',
  'profile.contactDescription':
    'The contact block used on CVs and applications. Saving it here counts as your confirmation.',
  'profile.contactEmpty': 'No contact details are recorded yet.',
  'profile.addContact': 'Add contact details',
  'profile.editContact': 'Edit contact details',
  'profile.saveContact': 'Save contact details',
  'profile.addFact': 'Add {kind}',
  'profile.saveFact': 'Save fact',
  'profile.editFact': 'Edit',
  'profile.confirmFact': 'Confirm as accurate',
  'profile.deleteFact': 'Delete',
  'profile.deleteTitle': 'Delete this fact?',
  'profile.deleteBody':
    'The fact is removed from your profile. This cannot be undone from the app; nothing else is changed.',
  'profile.deleteConfirm': 'Delete fact',
  'profile.sectionEmpty': 'No {kind} recorded yet. This is an empty list, not a failed query.',
  'profile.sourceExcerpt': 'Source excerpt',
  'profile.sourceFile': 'Source document',
  'profile.supersedes': 'Replaces fact',
  'profile.factRevision': 'Revision {revision} · updated {updated}',
  'profile.valueUnreadable':
    'This value does not have the shape its kind requires and is shown as unreadable rather than guessed at.',

  // --- M1: import review ---------------------------------------------------
  'import.title': 'Import review',
  'import.intro':
    'Extract facts from a document or pasted text, then review each proposal. Nothing reaches your profile until you accept it explicitly; existing confirmed facts are never overwritten silently.',
  'import.backToProfile': 'Back to the profile',
  'import.unavailableTitle': 'Profile import is not available on this installation',
  'import.unavailableBody':
    'The API reports that profile import is not implemented here, so nothing can be queued from this screen.',
  'import.workerOfflineWarning':
    'The API reports no worker online. An import queued now will stay queued until a worker starts; it will not fail, and it will not run.',
  'import.step1Title': '1. Choose a source',
  'import.sourceLegend': 'Source',
  'import.sourceFile': 'Upload a document',
  'import.sourceFileDescription': 'PDF or DOCX, up to 10 MiB. Encrypted documents are rejected.',
  'import.sourceText': 'Paste text',
  'import.sourceTextDescription':
    'A LinkedIn export or any plain text you own. Nothing is scraped from LinkedIn; only text you paste is used.',
  'import.fileLabel': 'Document',
  'import.fileDescription': 'Checked in the browser before upload: type and size only.',
  'import.fileRequired': 'Choose a PDF or DOCX file first.',
  'import.fileTooLarge': 'That file is larger than 10 MiB and was not uploaded.',
  'import.fileWrongType': 'Only PDF and DOCX files are accepted. That file was not uploaded.',
  'import.uploadFirst': 'Upload the document before queueing extraction.',
  'import.selectedFile': 'Selected: {name} ({size} KiB)',
  'import.upload': 'Upload document',
  'import.uploading': 'Uploading',
  'import.formatHintLabel': 'Format hint',
  'import.formatHintDescription':
    'Tells the worker what to expect. "Detect" lets the worker decide from the content.',
  'import.validationTitle': 'What the server found in the upload',
  'import.validationFile': 'Stored file',
  'import.validationSignature': 'File signature recognised',
  'import.validationExtension': 'Extension matches signature',
  'import.validationEncrypted': 'Encrypted',
  'import.validationScan': 'Malware scan',
  'import.encryptedBlocked':
    'The server reports this document is encrypted, so text extraction cannot succeed. Choose an unencrypted copy.',
  'import.textLabel': 'Pasted text',
  'import.textDescription':
    'Sent to the worker as-is. Instructions hidden in the text are ignored and reported as a warning, not obeyed.',
  'import.textRequired': 'Paste some text first.',
  'import.step2Title': '2. Queue extraction',
  'import.step2Body':
    'The worker extracts the text and asks the configured model for draft facts. With no provider configured, the extraction still runs and returns what it can, with a warning.',
  'import.queue': 'Queue extraction',
  'import.queueing': 'Queueing',
  'import.taskTitle': 'Extraction task {taskId}',
  'import.failedTitle': 'Extraction failed',
  'import.startOver': 'Start another import',
  'import.loadingReview': 'Loading the drafts…',
  'import.reviewLoadFailed': 'The extraction result could not be loaded.',
  'import.alreadyConfirmedTitle': 'This import was already confirmed',
  'import.alreadyConfirmedBody':
    'Its accepted drafts are in the profile and the rest were discarded. It cannot be confirmed twice.',
  'import.notReady': 'This import is "{status}" and has nothing to review yet.',
  'import.reviewTitle': '3. Review each draft',
  'import.reviewIntro':
    'Every draft starts unaccepted. Compare the source excerpt with the proposed value, edit it if needed, and accept only what is true. Unaccepted drafts are discarded when you confirm.',
  'import.reviewCounts': '{drafts} drafts · {conflicts} conflicts · {warnings} warnings',
  'import.warningsTitle': 'Warnings from the extraction',
  'import.noDraftsTitle': 'No drafts were extracted',
  'import.noDraftsBody':
    'The worker returned no usable facts. Check the warnings above; confirming this import changes nothing.',
  'import.sourceTitle': 'Source',
  'import.noExcerpt': 'No excerpt was reported for this draft.',
  'import.locator': 'Location',
  'import.confidence': 'Parsing confidence {value}% — a parsing aid only, never a confirmation.',
  'import.proposedTitle': 'Proposed value',
  'import.editValue': 'Edit value',
  'import.applyEdit': 'Apply edit',
  'import.revertEdit': 'Revert to the extracted value',
  'import.editedBadge': 'Edited by you',
  'import.conflictBadge': 'Conflicts with a confirmed fact',
  'import.acceptedBadge': 'Will be added',
  'import.acceptLabel': 'Accept this draft into my profile',
  'import.acceptDescription':
    'Unticked by default. Accepting makes it a confirmed fact with this excerpt as its provenance.',
  'import.conflictTitle': 'An existing confirmed fact collides with this draft',
  'import.existingMissing': 'The existing fact is not in the current profile; reload the profile.',
  'import.conflictLegend': 'What should happen?',
  'import.conflictDescription':
    'Nothing merges automatically. Both values are shown above; choose explicitly.',
  'import.conflictKeep': 'Keep the existing fact and discard this draft',
  'import.conflictKeepDescription': 'The draft is not added and the existing fact is untouched.',
  'import.conflictReplace': 'Replace the existing fact with this draft',
  'import.conflictReplaceOne': 'Replace existing fact {id} with this draft',
  'import.conflictReplaceDescription':
    'The existing fact stops being confirmed and stays in the history; the draft becomes the confirmed fact and points back to it.',
  'import.conflictBoth': 'Keep both',
  'import.conflictBothDescription': 'The draft is added alongside the existing fact.',
  'import.acceptedCount': '{accepted} of {total} drafts will be added',
  'import.confirm': 'Confirm selection',
  'import.confirming': 'Confirming',
  'import.confirmNote':
    'Applied against profile revision {revision}. If the profile changed meanwhile, the server refuses and you can reload.',
  'import.confirmEmptyTitle': 'Confirm with nothing accepted?',
  'import.confirmEmptyBody':
    'No draft is accepted. Confirming closes this import and discards every draft; the profile does not change.',
  'import.confirmEmptyAction': 'Discard all drafts',

  'formatHint.auto': 'Detect from content',
  'formatHint.pdf': 'PDF',
  'formatHint.docx': 'DOCX',
  'formatHint.linkedin_export_text': 'LinkedIn export text',
  'formatHint.plain_text': 'Plain text',

  'malwareScan.clean': 'Scanned: clean',
  'malwareScan.skipped_not_configured':
    'Not scanned — no scanner is configured (this is not "clean")',
  'malwareScan.quarantined': 'Quarantined',
  'malwareScan.pending': 'Scan pending',

  'importWarning.EXTRACTION_SHORT':
    'Very little text was extracted. The document may be scanned, mostly images, or nearly empty; drafts may be incomplete.',
  'importWarning.PAGES_TRUNCATED':
    'The document exceeded the page limit; later pages were not read.',
  'importWarning.CHARS_TRUNCATED': 'The text exceeded the character limit; the end was not read.',
  'importWarning.TABLE_LAYOUT_UNCERTAIN':
    'A table layout could not be read reliably; check values that came from tables.',
  'importWarning.DATE_AMBIGUOUS': 'A date could not be read unambiguously; check the months.',
  'importWarning.FIELD_DROPPED_INVALID':
    'A draft was discarded because its value did not match its kind. It is not offered for acceptance.',
  'importWarning.MODEL_CORRECTED_ONCE':
    'The model output was invalid once and a single correction attempt was made.',
  'importWarning.NO_PROVIDER_CONFIGURED':
    'No AI provider is configured, so no draft facts were inferred from the text. Configure one under Settings › Provider, or add facts by hand.',
  'importWarning.PROMPT_INJECTION_TEXT_IGNORED':
    'The text contained instructions aimed at the model. They were removed and ignored; the document was treated as data only.',

  // --- M1: settings --------------------------------------------------------
  'settings.title': 'Settings',
  'settings.intro':
    'Search preferences and the model provider. Every change is saved against a revision; if something else changed first, the save is refused and you can reload.',
  'settings.tabsLabel': 'Settings sections',
  'settings.preferencesTab': 'Preferences',
  'settings.providerTab': 'AI provider',
  'settings.missingTitle': 'Not on this screen yet',
  'settings.missingBody':
    'Scan schedules, paired devices, prompt and template choices beyond the ones here, and data export and deletion arrive with later milestones. They are absent rather than shown as controls that do nothing.',

  'preferences.loading': 'Loading preferences…',
  'preferences.loadFailed': 'Preferences could not be loaded.',
  'preferences.revision': 'Revision {revision} · settings schema version {version}',
  'preferences.saved': 'Saved. Preferences are now at revision {revision}.',
  'preferences.saving': 'Saving',
  'preferences.save': 'Save preferences',
  'preferences.saveBlocked': 'Saving is blocked until the weights sum to exactly 100.',
  'preferences.reload': 'Reload preferences from the server (discards your edits)',
  'preferences.integerRequired': 'Enter a whole number.',
  'preferences.listHint': 'One entry per line.',
  'preferences.searchTitle': 'Search',
  'preferences.target_titles': 'Target job titles',
  'preferences.excluded_titles': 'Excluded job titles',
  'preferences.required_skills': 'Required skills',
  'preferences.requiredSkillsHint':
    'One per line. Weighted twice as much as preferred skills in the skills component.',
  'preferences.preferred_skills': 'Preferred skills',
  'preferences.excluded_companies': 'Excluded companies',
  'preferences.excludedCompaniesHint':
    'One per line. Jobs from these employers are hidden by default.',
  'preferences.countries': 'Countries',
  'preferences.countriesHint':
    'Two-letter ISO codes, one per line (US, ES, MX). Remote does not imply worldwide; eligibility is checked per country.',
  'preferences.countryCodesInvalid': 'Every entry must be a two-letter ISO country code.',
  'preferences.languages': 'Working languages',
  'preferences.languagesHint': 'Codes such as en, es or pt-BR, one per line.',
  'preferences.languageCodesInvalid': 'Every entry must be a language code such as en or pt-BR.',
  'preferences.remote_modes': 'Work arrangements',
  'preferences.remoteModesHint': 'Which arrangements you will consider.',
  'preferences.employment_types': 'Employment types',
  'preferences.salaryTitle': 'Salary',
  'preferences.salaryNoConversion':
    'No currency or period conversion happens. A job is compared only when it states the same currency and period; otherwise its salary stays unknown.',
  'preferences.salaryEnabled': 'Set a minimum salary',
  'preferences.salaryMinimum': 'Minimum',
  'preferences.salaryMinimumInvalid': 'Enter a number of zero or more.',
  'preferences.salaryCurrency': 'Currency',
  'preferences.salaryCurrencyHint': 'ISO 4217 code, for example USD or EUR.',
  'preferences.currencyInvalid': 'Use a three-letter ISO currency code.',
  'preferences.salaryPeriod': 'Period',
  'preferences.eligibilityTitle': 'Eligibility',
  'preferences.sponsorship_policy': 'Sponsorship policy',
  'preferences.sponsorshipHint':
    'How jobs that need visa sponsorship are treated. Unknown sponsorship never counts as a match.',
  'preferences.unknown_eligibility_policy': 'When eligibility is unknown',
  'preferences.eligibilityHint':
    'Unknown eligibility blocks application readiness either way; this only decides whether the job stays visible.',
  'preferences.weightsTitle': 'Match weights',
  'preferences.weightsIntro':
    'Nonnegative whole numbers that must sum to exactly 100. The score they produce is a heuristic ranking, not a probability of being hired.',
  'preferences.weightDefault': 'Default {value}.',
  'preferences.weightsSum': 'Current sum: {sum}.',
  'preferences.weightsNotNumeric': 'Every weight must be a whole number.',
  'preferences.weightsMustSum': 'The weights must sum to exactly 100.',
  'preferences.weightsStaleNote':
    'Changing weights makes any computed match stale; scores are recalculated on the next scan.',
  'preferences.cvTitle': 'CV',
  'preferences.cv_language': 'Language for new CVs',
  'preferences.cv_template': 'CV template',
  'preferences.resume_mode': 'CV mode',
  'preferences.limitsTitle': 'Operational limits',
  'preferences.limitsIntro':
    'Pilot defaults are shown under each field. A hosted operator may enforce stricter maxima; you can always choose stricter values.',
  'preferences.scan_interval_hours': 'Scan interval (hours)',
  'preferences.pilotDefault': 'Pilot default: {value}.',
  'preferences.promptTitle': 'Prompt style',
  'preferences.prompt_style_suffix': 'Style suffix (style only)',
  'preferences.promptStyleHint':
    'Optional. May change tone or emphasis of generated text. It cannot override factual constraints: no invented qualifications, employers, dates or numbers, whatever it says.',

  'remoteMode.remote': 'Remote',
  'remoteMode.hybrid': 'Hybrid',
  'remoteMode.onsite': 'On site',

  'salaryPeriod.year': 'per year',
  'salaryPeriod.month': 'per month',
  'salaryPeriod.week': 'per week',
  'salaryPeriod.day': 'per day',
  'salaryPeriod.hour': 'per hour',

  'sponsorshipPolicy.allow': 'Allow',
  'sponsorshipPolicy.allow.description': 'Jobs that require sponsorship remain eligible.',
  'sponsorshipPolicy.avoid': 'Avoid',
  'sponsorshipPolicy.avoid.description':
    'Jobs that state sponsorship is required are marked ineligible.',
  'sponsorshipPolicy.unknown': 'Unknown',
  'sponsorshipPolicy.unknown.description':
    'You have not decided. Sponsorship stays an unknown for every job until you do.',

  'eligibilityPolicy.review': 'Show for review',
  'eligibilityPolicy.review.description':
    'Jobs with unknown eligibility stay visible and are marked unknown.',
  'eligibilityPolicy.hide': 'Hide',
  'eligibilityPolicy.hide.description':
    'Jobs with unknown eligibility are hidden by default; you can still inspect them.',

  'matchWeight.skills': 'Skills',
  'matchWeight.role_title': 'Role / title',
  'matchWeight.seniority': 'Seniority',
  'matchWeight.work_arrangement': 'Arrangement / location',
  'matchWeight.industry': 'Industry',

  'cvTemplate.simple': 'Simple (single column)',

  'resumeMode.original': 'Original file',
  'resumeMode.original.description':
    'Your uploaded CV is used byte for byte; nothing is converted or tailored.',
  'resumeMode.tailored': 'Tailored',
  'resumeMode.tailored.description':
    'A CV generated from confirmed facts only, reviewed by you before use.',

  'limit.scan_max_jobs': 'Maximum jobs per scan',
  'limit.request_concurrency_per_host': 'Concurrent requests per host',
  'limit.ai_requests_per_day': 'AI requests per day',
  'limit.fill_attempts_per_day': 'Form-fill attempts per day',
  'limit.approval_ttl_hours': 'Approval validity (hours)',
  'limit.consented_evidence_capture': 'Capture submission evidence (screenshots) with my consent',
  'limit.raw_logs': 'Keep raw logs',

  'provider.loading': 'Loading provider settings…',
  'provider.loadFailed': 'Provider settings could not be loaded.',
  'provider.saved': 'Provider settings saved.',
  'provider.saving': 'Saving',
  'provider.save': 'Save provider settings',
  'provider.externalTitle': 'Task input leaves this machine',
  'provider.externalBody':
    'The saved provider sends the text of each task — profile text, job descriptions, prompts — to an external service. Nothing is sent until a task runs, and no other provider is substituted if it fails.',
  'provider.connectionTitle': 'Provider',
  'provider.provider': 'Provider',
  'provider.providerHint':
    'Explicit choice. There is no automatic fallback from a local provider to a cloud one.',
  'provider.model': 'Model',
  'provider.modelHint': 'The exact model identifier the provider expects.',
  'provider.modelRequired': 'Enter a model identifier.',
  'provider.baseUrl': 'Base URL',
  'provider.baseUrlHint':
    'Endpoint of the provider. Local endpoints must be on the operator allowlist; the server checks this when saving.',
  'provider.baseUrlRequired': 'Enter the endpoint URL for this provider.',
  'provider.noBaseUrl': 'This provider does not use an endpoint URL.',
  'provider.apiKeyStatus': 'Stored API key',
  'provider.apiKeySet': 'Set (ends in {masked})',
  'provider.apiKeyNotSet': 'Not set',
  'provider.apiKey': 'New API key',
  'provider.apiKeyHint':
    'Write-only. The stored key is never shown here and this field is never prefilled. Leave it empty to keep the stored key.',
  'provider.clearKey': 'Remove the stored API key',
  'provider.clearKeyHint': 'Saving with this ticked deletes the stored key.',
  'provider.limitsTitle': 'Limits',
  'provider.numberRequired': 'Enter a number.',
  'provider.optionalLimit': 'Optional. Empty means no cap.',
  'provider.costBudgetHint':
    'Optional. Only enforceable with a rate card; without one, cost is unknown and this cap does nothing.',
  'provider.costBudgetUnenforceable':
    'A daily cost budget is set but no rate card is configured. Cost cannot be measured, so this budget cannot be enforced; only the token and request caps apply.',
  'provider.rateCardTitle': 'Rate card',
  'provider.rateCardIntro':
    'Prices per million tokens, used to estimate and settle cost. Without a rate card cost is reported as unknown — not as zero — and a cost budget cannot be enforced.',
  'provider.rateCardEnabled': 'Provide a rate card',
  'provider.noRateCard':
    'No rate card: cost is unknown, not zero. Token and request caps still apply.',
  'provider.rateCurrency': 'Currency',
  'provider.rateInput': 'Input cost per million tokens',
  'provider.rateOutput': 'Output cost per million tokens',
  'provider.testTitle': 'Test connection',
  'provider.testIntro':
    'Probes the saved provider only; it is not a general URL fetcher. It reports what was observed and nothing more.',
  'provider.testUnsaved':
    'You have unsaved edits. The test uses the saved settings, not what is in the form.',
  'provider.test': 'Test connection',
  'provider.testing': 'Testing',
  'provider.reachable': 'Reachable',
  'provider.modelAvailable': 'Model available',
  'provider.structuredOutput': 'Structured output supported',
  'provider.notDetermined': 'Not determined',
  'provider.latency': 'Latency',
  'provider.latencyValue': '{ms} ms',
  'provider.detail': 'Detail',

  'providerId.none': 'None',
  'providerId.none.description':
    'No model. Manual profile editing, job import and tracking still work; extraction and generation report that no provider is configured.',
  'providerId.fake': 'Fake (deterministic, for testing)',
  'providerId.fake.description':
    'Returns fixture output. Useful to exercise the pipeline; never use its output as real facts.',
  'providerId.ollama': 'Ollama (local)',
  'providerId.ollama.description':
    'A model running on your machine or network. Task input stays local. Internet is still needed for live job search.',
  'providerId.openai_compatible': 'OpenAI-compatible endpoint (sends task input externally)',
  'providerId.openai_compatible.description':
    'A hosted API. Task input leaves this machine and goes to the endpoint you configure; its use may be billed by that provider.',

  'providerLimit.context_limit': 'Context limit (tokens)',
  'providerLimit.output_token_limit': 'Output token limit',
  'providerLimit.temperature': 'Temperature',
  'providerLimit.timeout_seconds': 'Timeout (seconds)',
  'providerLimit.daily_token_budget': 'Daily token budget',
  'providerLimit.daily_cost_budget': 'Daily cost budget',

  // --- M2: Discover -----------------------------------------------------------
  'discover.title': 'Discover',
  'discover.intro':
    'Register public job boards and scan them, or import a single posting from a public URL or pasted text.',
  'discover.coverageTitle': 'What discovery covers',
  'discover.coverageBody':
    'Scans read only the boards registered here and the URLs you import. Nothing searches the whole internet, and no board is read unless you add it. Public listings are not a complete directory of employers: a job that is not on a registered board will not appear.',
  'discover.unavailableTitle': 'Job discovery is not available on this server',
  'discover.unavailableBody':
    'The API reports job discovery as unavailable, so adding boards, scanning and importing are disabled here. No control below will queue work.',
  'discover.workerOfflineWarning':
    'The API reports no worker online. A scan or import queued now stays queued until a worker starts; it will not fail, and it will not run.',
  'discover.controlUnavailable': 'Disabled because the API reports job discovery as unavailable.',

  'boards.title': 'Boards',
  'boards.intro':
    'Only public boards work: a Greenhouse board token or a Lever site slug that anyone can open without signing in. Registering a board does not grant permission to crawl it; scans follow the documented limits and a board that refuses repeatedly is marked blocked and left alone.',
  'boards.loading': 'Loading boards…',
  'boards.loadFailed': 'The boards could not be loaded.',
  'boards.caption': 'Configured boards',
  'boards.columnBoard': 'Board',
  'boards.columnHealth': 'Health',
  'boards.columnLastSuccess': 'Last successful scan',
  'boards.columnNextScan': 'Next scheduled scan',
  'boards.columnJobs': 'Jobs',
  'boards.columnActions': 'Actions',
  'boards.emptyTitle': 'No boards are registered',
  'boards.emptyBody':
    'Nothing is scanned until a board is registered. No example boards are shown.',
  'boards.emptySuggestionAdd': 'Add a Greenhouse board token or a Lever site slug below.',
  'boards.emptySuggestionImport': 'Or import a single posting from a URL or pasted text.',
  'boards.endpoint': 'Endpoint: {url}',
  'boards.neverSucceeded': 'Never',
  'boards.nextScanDue': 'Due at the next scheduler pass',
  'boards.nextScanNotScheduled': 'Not scheduled while the board is disabled or blocked',
  'boards.lastError': 'Last error: {code}',
  'boards.consecutiveFailures': '{count} consecutive failures',
  'boards.scanNow': 'Scan now',
  'boards.scanning': 'Queueing scan…',
  'boards.scanBlockedReason':
    'Scanning is off: the board answered with repeated refusals. Re-enable it to try again.',
  'boards.scanDisabledReason': 'Scanning is off: the board is disabled. Enable it to scan.',
  'boards.enable': 'Enable',
  'boards.reenable': 'Re-enable',
  'boards.disable': 'Disable',
  'boards.updating': 'Updating…',
  'boards.delete': 'Delete',
  'boards.deleteTitle': 'Delete this board?',
  'boards.deleteBody':
    'The {connector} board "{boardKey}" will no longer be scanned. Jobs already found through it are kept, with their provenance; only the link to this board is removed.',
  'boards.deleteConfirm': 'Delete board, keep jobs',
  'boards.deleting': 'Deleting…',
  'boards.viewLastScan': 'View last scan',
  'boards.actionFailed': 'The action on "{boardKey}" did not complete.',
  'boards.jobCount': '{count} jobs',

  'addBoard.title': 'Add a board',
  'addBoard.connector': 'Connector',
  'addBoard.boardKey': 'Board key',
  'addBoard.boardKeyRequired': 'Enter the board key.',
  'addBoard.boardKeyPattern': 'Use only letters, digits, dots, hyphens and underscores.',
  'addBoard.greenhouseHelp':
    'The Greenhouse board token is the last part of a public board URL, such as https://boards.greenhouse.io/<token> or https://job-boards.greenhouse.io/<token>. Only public boards work; a board behind a sign-in cannot be read.',
  'addBoard.leverHelp':
    'The Lever site slug is the part after jobs.lever.co/ in a public postings URL, such as https://jobs.lever.co/<slug>. Only public postings pages work.',
  'addBoard.leverEu': 'This Lever board is hosted in the EU region',
  'addBoard.leverEuDescription':
    'Sends base_url {url}, the documented EU endpoint, instead of the default. Choose this only when the public URL is on jobs.eu.lever.co.',
  'addBoard.submit': 'Add board',
  'addBoard.submitting': 'Adding…',
  'addBoard.added':
    'Board "{boardKey}" added. Its first scan is queued at the next scheduler pass; use "Scan now" to start one immediately.',

  'scan.title': 'Scan status',
  'scan.intro': 'Follows a scan queued from this page, or the last scan of a board.',
  'scan.none': 'No scan is being followed. Use "Scan now" or "View last scan" on a board.',
  'scan.loading': 'Reading the scan…',
  'scan.loadFailed': 'The scan could not be read.',
  'scan.heading': 'Scan {id}',
  'scan.forBoard': 'Board: {board}',
  'scan.snapshotComplete':
    'Complete snapshot: every page was fetched, so a job missing from it counts towards closure.',
  'scan.snapshotPartialTitle': 'This scan was partial',
  'scan.snapshotPartialBody':
    'Not every page was fetched, so this is not a complete picture of the board. Nothing was closed because of this scan: a job missing from a partial snapshot is not treated as gone.',
  'scan.unchangedTitle': 'Unchanged since the last scan',
  'scan.unchangedBody':
    'The board reported no changes since the last successful scan, so nothing was re-fetched and no job was created, updated or closed. The board still lists {count} jobs here.',
  'scan.snapshotPending': 'Whether the snapshot is complete is known once the scan finishes.',
  'scan.warningsPending': 'Reading the fetch notes…',
  'scan.countsTitle': 'Counts',
  'scan.count.fetched': 'Fetched',
  'scan.count.created': 'New',
  'scan.count.updated': 'Updated',
  'scan.count.unchanged': 'Unchanged',
  'scan.count.closed': 'Closed',
  'scan.count.pages': 'Pages',
  'scan.errorTitle': 'The scan reported an error',
  'scan.startedAt': 'Started',
  'scan.completedAt': 'Completed',
  'scan.notYet': 'Not yet',
  'scan.viewJobs': 'View jobs',
  'scan.stopFollowing': 'Stop following',
  'scan.queuedNoWorker':
    'The scan is queued and the API reports no worker online, so no process will pick it up. It stays in the queue and starts as soon as a worker connects; you do not need to queue it again.',
  'scan.notesTitle': 'Notes from the fetch',

  'scanStatus.queued': 'Queued',
  'scanStatus.running': 'Running',
  'scanStatus.succeeded': 'Succeeded',
  'scanStatus.partial': 'Partial',
  'scanStatus.failed': 'Failed',
  'scanStatus.cancelled': 'Cancelled',
  'scanStatus.queued.description': 'Waiting for a worker to pick it up.',
  'scanStatus.running.description': 'A worker is fetching the board.',
  'scanStatus.succeeded.description': 'Every page was fetched within limits.',
  'scanStatus.partial.description':
    'Something was fetched but not a complete snapshot, or the board reported no changes. A partial scan closes nothing.',
  'scanStatus.failed.description': 'The fetch failed. No job was changed.',
  'scanStatus.cancelled.description': 'The scan was cancelled before it finished.',

  'sourceHealth.unknown': 'Not scanned yet',
  'sourceHealth.ok': 'Healthy',
  'sourceHealth.degraded': 'Degraded',
  'sourceHealth.blocked': 'Blocked',
  'sourceHealth.disabled': 'Disabled',
  'sourceHealth.unknown.description':
    'No scan has completed yet, so nothing is known about this board.',
  'sourceHealth.ok.description': 'The last scan succeeded.',
  'sourceHealth.degraded.description': 'Recent scans failed or were partial; scanning continues.',
  'sourceHealth.blocked.description':
    'The board refused repeatedly (403 or 429). Scanning stopped and stays stopped until you re-enable the board.',
  'sourceHealth.disabled.description': 'You disabled this board. It is not scanned.',

  'connector.greenhouse': 'Greenhouse',
  'connector.lever': 'Lever',
  'connector.manual': 'Pasted description',
  'connector.url': 'Imported URL',

  'jobImport.title': 'Import one posting',
  'jobImport.intro':
    'Paste the public URL of a job page, or paste the description text yourself. What you provide is stored as the source; nothing is added to it without an excerpt to show for it.',
  'jobImport.modeLegend': 'Source',
  'jobImport.modeUrl': 'Public URL',
  'jobImport.modeUrlDescription':
    'https only. The page is fetched without cookies or credentials, read as structured JobPosting data first and as text otherwise.',
  'jobImport.modeText': 'Pasted description',
  'jobImport.modeTextDescription':
    'Use this when a page cannot be fetched or refuses automated access. Give the company and title so the job is identifiable.',
  'jobImport.url': 'Job page URL',
  'jobImport.urlRequired': 'Enter the https URL of the job page.',
  'jobImport.text': 'Description text',
  'jobImport.textDescription': 'At least 20 characters. Stored exactly as pasted.',
  'jobImport.textRequired': 'Paste the description text (at least 20 characters).',
  'jobImport.hintsTitle': 'Optional details',
  'jobImport.company': 'Company',
  'jobImport.jobTitle': 'Title',
  'jobImport.applyUrl': 'Application URL',
  'jobImport.applyUrlDescription': 'Used only when the page itself states no application link.',
  'jobImport.submit': 'Import',
  'jobImport.submitting': 'Queueing import…',
  'jobImport.taskTitle': 'Import task {taskId}',
  'jobImport.queuedNoWorker':
    'The import is queued and the API reports no worker online, so no process will pick it up. It stays in the queue and starts as soon as a worker connects; you do not need to queue it again.',
  'jobImport.failedTitle': 'The import failed',
  'jobImport.createdTitle': 'Job imported',
  'jobImport.createdBody':
    'The posting was stored with its source. Review it before relying on any field.',
  'jobImport.openJob': 'Open the job',
  'jobImport.chooseTitle': 'Several postings were found on that page',
  'jobImport.chooseBody':
    'No job was created. Choose the posting you meant; it is imported from its own URL.',
  'jobImport.choose': 'Import this posting',
  'jobImport.refusedTitle': 'The page could not be fetched',
  'jobImport.refusedBody':
    'The fetch was refused or is not permitted, and this app does not work around a refusal. If you have the posting open in your browser, paste its text instead.',
  'jobImport.nothingTitle': 'No posting could be read from that page',
  'jobImport.nothingBody':
    'The page was fetched but no job posting was recognised in it. You can paste the description text instead.',
  'jobImport.switchToPaste': 'Paste the description instead',
  'jobImport.warningsTitle': 'Notes from the fetch',
  'jobImport.startOver': 'Start another import',
  'jobImport.resultUnreadable':
    'The task finished but its result did not have the expected shape. Nothing was assumed about it.',
  'jobImport.awaitingOutcome': 'The task finished; reading its outcome…',

  'fetchWarning.RATE_LIMITED': 'The site asked for fewer requests (rate limited).',
  'fetchWarning.ACCESS_DENIED': 'The site denied access.',
  'fetchWarning.NOT_MODIFIED': 'The board reported no changes since the last fetch.',
  'fetchWarning.PAGE_LIMIT_REACHED': 'The page limit for one scan was reached.',
  'fetchWarning.JOB_LIMIT_REACHED': 'The job limit for one scan was reached.',
  'fetchWarning.SCHEMA_DRIFT': 'The source data did not match the expected shape.',
  'fetchWarning.ROBOTS_DISALLOWED': 'The site’s robots directives disallow fetching this page.',
  'fetchWarning.BLOCKED_DESTINATION':
    'The destination is not a public address and was not contacted.',
  'fetchWarning.REDIRECT_LIMIT': 'Too many redirects.',
  'fetchWarning.CONTENT_TYPE_REJECTED': 'The response was not an HTML or JSON-LD page.',
  'fetchWarning.BODY_TRUNCATED': 'The page was larger than the limit and was cut off.',
  'fetchWarning.NO_STRUCTURED_DATA': 'No structured JobPosting data was found; the text was used.',
  'fetchWarning.MULTIPLE_POSTINGS': 'The page lists several postings.',
  'fetchWarning.FIELD_INFERRED':
    'A field was inferred from surrounding text rather than read directly.',
  'fetchWarning.FIELD_DROPPED_INVALID': 'A field was dropped because its value was invalid.',

  // --- M2: Jobs -----------------------------------------------------------------
  'jobs.title': 'Jobs',
  'jobs.intro':
    'Every job found through your boards and imports. Nothing has been matched against your profile yet — matching arrives in a later milestone — so every job reads "Not checked".',
  'jobs.filtersLegend': 'Filters',
  'jobs.query': 'Search title or company',
  'jobs.status': 'Status',
  'jobs.statusAny': 'Any status',
  'jobs.savedOnly': 'Saved only',
  'jobs.includeExcluded': 'Show excluded jobs',
  'jobs.includeExcludedDescription':
    'Jobs from companies on your excluded list are hidden by default. Showing them marks each with its reason.',
  'jobs.applyFilters': 'Apply filters',
  'jobs.clearFilters': 'Clear filters',
  'jobs.loading': 'Loading jobs…',
  'jobs.loadFailed': 'The jobs could not be loaded.',
  'jobs.caption': 'Jobs',
  'jobs.columnJob': 'Job',
  'jobs.columnWhere': 'Location',
  'jobs.columnType': 'Type',
  'jobs.columnSalary': 'Salary',
  'jobs.columnStatus': 'Status',
  'jobs.columnFreshness': 'Freshness',
  'jobs.columnMatch': 'Match',
  'jobs.columnSources': 'Sources',
  'jobs.columnActions': 'Actions',
  'jobs.emptyTitle': 'No jobs to show',
  'jobs.emptyBody': 'This list is empty. No example jobs are shown in its place.',
  'jobs.emptySuggestionBoards': 'Add a board on the Discover screen.',
  'jobs.emptySuggestionScan': 'Run a scan of a registered board, or import a single posting.',
  'jobs.emptySuggestionFilters':
    'Relax the filters: clear the search, allow any status, or show excluded jobs.',
  'jobs.endOfList': 'No more jobs.',
  'jobs.save': 'Save',
  'jobs.unsave': 'Unsave',
  'jobs.saving': 'Saving…',
  'jobs.savedBadge': 'Saved',
  'jobs.updateFailed': 'The change to "{title}" was not saved.',
  'jobs.reload': 'Reload the list',
  'jobs.sourceOne': '1 source',
  'jobs.sourceMany': '{count} sources',
  'jobs.duplicatesFlag': 'Possible duplicate',
  'jobs.duplicatesFlagDescription':
    'Similar to another job. Similar title and location alone is a warning, never an automatic merge.',
  'jobs.excluded': 'Excluded: {reason}',
  'jobs.locationNone': 'Location not stated',
  'jobs.salaryUnknown': 'Salary unknown',
  'jobs.salaryUnknownDescription':
    'The posting states no salary. Unknown is not zero and not a guess.',
  'jobs.salaryCurrencyUnknown': 'currency not stated',
  'jobs.salaryPeriodUnknown': 'period not stated',
  'jobs.lastSeen': 'Last seen {when}',
  'jobs.stale': 'May be stale — recheck before applying',
  'jobs.staleDescription':
    'The last successful fetch is more than {hours} hours old. The posting may have changed or closed.',
  'jobs.neverFetched': 'No successful fetch recorded — recheck before applying',
  'jobs.fresh': 'Fetched within the last {hours} hours',
  'jobs.matchNotCheckedDescription':
    'No match has been computed for this job yet. This is not a low score.',
  'jobs.employmentTypeNotStated': 'Employment type not stated',

  'jobStatus.active': 'Active',
  'jobStatus.closed': 'Closed',
  'jobStatus.unknown': 'Unknown',
  'jobStatus.active.description': 'Listed by its source at the last successful scan.',
  'jobStatus.closed.description':
    'Missing from two complete snapshots at least 24 hours apart, closed by the source, or marked closed by you.',
  'jobStatus.unknown.description':
    'Availability could not be determined. Unknown is not active and not closed.',

  'remoteType.remote': 'Remote',
  'remoteType.hybrid': 'Hybrid',
  'remoteType.onsite': 'On site',
  'remoteType.unknown': 'Work arrangement not stated',

  'jobDetail.back': 'Back to jobs',
  'jobDetail.loading': 'Loading job…',
  'jobDetail.loadFailed': 'The job could not be loaded.',
  'jobDetail.revision': 'Revision {revision}',
  'jobDetail.markClosed': 'Mark as closed',
  'jobDetail.markClosedTitle': 'Mark this job as closed?',
  'jobDetail.markClosedBody':
    'This records that you consider the posting closed. A board that still lists it will not reopen it.',
  'jobDetail.markClosedConfirm': 'Mark closed',
  'jobDetail.closing': 'Closing…',
  'jobDetail.prepareUnavailable':
    'Prepare application is not available yet: application packets arrive in milestone M4. No button is shown, so nothing can appear to prepare one.',
  'jobDetail.reload': 'Reload the job',
  'jobDetail.summaryTitle': 'Summary',
  'jobDetail.remoteType': 'Work arrangement',
  'jobDetail.employmentType': 'Employment type',
  'jobDetail.language': 'Posting language',
  'jobDetail.publishedAt': 'Published',
  'jobDetail.notStated': 'Not stated',
  'jobDetail.locationsTitle': 'Locations',
  'jobDetail.locationsNone': 'The posting states no location.',
  'jobDetail.readFrom': 'Read from: “{excerpt}”',
  'jobDetail.eligibilityTitle': 'Eligibility',
  'jobDetail.eligibilityNotStated':
    'Not stated — do not assume eligibility. A remote posting does not mean worldwide.',
  'jobDetail.eligibilityCountries': 'The posting names these countries: {countries}',
  'jobDetail.salaryTitle': 'Salary',
  'jobDetail.salaryAsStated': 'As stated: “{excerpt}”',
  'jobDetail.salaryNoConversion':
    'Shown in the currency and period the posting used; nothing is converted.',
  'jobDetail.requirementsTitle': 'Requirements',
  'jobDetail.requirementsNone':
    'No requirements were extracted — read the description. Extraction relies on explicit section headings, so an empty list means none were read, not that the job has none.',
  'jobDetail.evidenceExcerpt': 'Excerpt this was read from',
  'jobDetail.inferredTitle': 'Inferred fields',
  'jobDetail.inferredIntro':
    'These fields were not read from a structured value. Each was inferred from the excerpt shown; check the excerpt before relying on the field.',
  'jobDetail.inferredNone':
    'No field was inferred; every value above was read directly from the source.',
  'jobDetail.inferredFrom': 'This was inferred from:',
  'jobDetail.descriptionTitle': 'Description',
  'jobDetail.descriptionNote':
    'Shown as plain text exactly as stored. Instructions inside a job page are data, not commands.',
  'jobDetail.provenanceTitle': 'Where this job was seen',
  'jobDetail.provenanceExternalId': 'External id',
  'jobDetail.provenanceCanonical': 'Posting page',
  'jobDetail.provenanceApply': 'Application page',
  'jobDetail.provenanceApplyNone': 'No application link stated',
  'jobDetail.provenanceRetrieved': 'Retrieved {when}',
  'jobDetail.provenanceSourceRemoved':
    'The board this came from has since been removed; the job is kept.',
  'jobDetail.duplicatesTitle': 'Possible duplicates',
  'jobDetail.duplicatesIntro':
    'Not merged automatically. Check these before applying so the same application is not prepared twice.',
  'jobDetail.duplicatesNone': 'No possible duplicates were detected.',
  'jobDetail.freshnessTitle': 'Freshness',
  'jobDetail.firstSeen': 'First seen',
  'jobDetail.lastSeen': 'Last seen',
  'jobDetail.lastFetched': 'Last successful fetch',
  'jobDetail.contentHash': 'Content hash',
  'jobDetail.opensInNewTab': '(opens in a new tab)',

  'requirementKind.required': 'Required',
  'requirementKind.preferred': 'Preferred',
  'requirementKind.unknown': 'Requirement level not stated',

  'inferredField.remote_type': 'Work arrangement',
  'inferredField.locations': 'Locations',
  'inferredField.eligible_countries': 'Eligible countries',
  'inferredField.employment_type': 'Employment type',
  'inferredField.salary': 'Salary',
  'inferredField.language': 'Posting language',
  'inferredField.requirements': 'Requirements',

  'duplicateReason.same_apply_url': 'Same application URL',
  'duplicateReason.same_requisition': 'Same requisition',
  'duplicateReason.similar_title_and_location': 'Similar title and location',

  // --- Fit (M3) ------------------------------------------------------------
  // A score is a heuristic ranking, never a probability of being hired
  // (invariant 3). Nothing below may read as a chance, an ATS score, or a
  // verdict on a person.

  'match.heading': 'Fit',
  'match.heuristicNotice':
    'This is a heuristic ranking of how the posting lines up with your confirmed profile. It is not a probability of being hired and not an ATS score. Read the evidence before you rely on it.',
  'match.scoreOutOf': 'of 100',
  'match.coverage': '{percent}% of the weighting was judged',
  'match.scoreWithCoverage': 'Ranking {score} of 100, from {percent}% of the weighting.',
  'match.scoreUnknown': 'Not enough to judge',
  'match.scoreUnknownExplanation':
    'Nothing could be judged, so there is no ranking. That is not a low score: the posting and your profile did not overlap on anything this version knows how to compare.',
  'match.coverageNote':
    'These were left out because nothing could be read for them: {components}. The ranking was calculated from the rest.',
  'match.componentsHeading': 'What went into it',
  'match.componentValue': '{value} of 100, weighted {weight}',
  'match.componentNotEvaluated': 'Not judged',
  'match.requirementsHeading': 'Requirements',
  'match.noRequirements':
    'No requirements were extracted, so none could be checked. Extraction relies on explicit section headings; an empty list means none were read, not that the job has none.',
  'match.evidenceFromJob': 'From the posting',
  'match.evidenceFromProfile': 'From your profile',
  'match.matchedVia': 'Matched through your confirmed skill "{skill}".',
  'match.uncertainExplanation':
    'Your profile has "{skill}", which is related but not the same thing. It was not counted: claiming it would put experience on your CV that you did not enter.',
  'match.showRequirementEvidence': 'Show the line this came from',
  'match.stale': 'Out of date',
  'match.staleDescription':
    'Your profile, preferences or the posting changed after this was calculated.',
  'match.staleNotice':
    'Your profile, preferences or the posting changed after this was calculated, so it is shown as it was. Check the fit again for a current one.',
  'match.versions': 'Algorithm {algorithm}, alias map {aliases}.',

  'match.component.skills': 'Skills',
  'match.component.role_title': 'Role and title',
  'match.component.seniority': 'Seniority',
  'match.component.work_arrangement': 'Work arrangement',
  'match.component.industry': 'Industry',

  'match.unknown.JOB_STATES_NOTHING': 'The posting does not say.',
  'match.unknown.PROFILE_STATES_NOTHING': 'Your confirmed profile does not say.',
  'match.unknown.NO_CONFIRMED_FACTS': 'You have no confirmed facts to compare against yet.',
  'match.unknown.NOT_COMPARABLE': 'The two could not be compared without guessing.',
  'match.unknown.WEIGHT_ZERO': 'You set this component to no weight.',

  'match.outcome.matched': 'Covered',
  'match.outcome.uncertain': 'Uncertain',
  'match.outcome.missing': 'Not covered',

  'eligibility.heading': 'Can you apply?',
  'eligibility.verdict.yes': 'Eligible',
  'eligibility.verdict.no': 'Not eligible',
  'eligibility.verdict.unknown': 'Unknown',
  'eligibility.blocksApplication': 'This has to be answered before applying. Unknown is not a yes.',

  'eligibility.filter.excluded_employer': 'Excluded employer',
  'eligibility.filter.employment_type': 'Employment type',
  'eligibility.filter.location': 'Location eligibility',
  'eligibility.filter.work_authorization': 'Work authorization',
  'eligibility.filter.language': 'Language',
  'eligibility.filter.salary_minimum': 'Salary minimum',

  'eligibility.code.NOT_CONFIGURED': 'You have not set this preference, so nothing was checked.',
  'eligibility.code.PASSES': 'Nothing here rules you out.',
  'eligibility.code.EMPLOYER_EXCLUDED': 'You excluded this employer.',
  'eligibility.code.EMPLOYMENT_TYPE_NOT_ACCEPTED':
    'This is not one of the employment types you accept.',
  'eligibility.code.EMPLOYMENT_TYPE_NOT_STATED': 'The posting does not state an employment type.',
  'eligibility.code.COUNTRY_NOT_ELIGIBLE':
    'The posting lists countries, and none of yours is among them.',
  'eligibility.code.COUNTRY_NOT_STATED':
    'The posting does not say which countries it is open to. Remote does not mean worldwide.',
  'eligibility.code.REMOTE_MODE_NOT_ACCEPTED': 'This work arrangement is not one you accept.',
  'eligibility.code.AUTHORIZATION_NOT_CONFIRMED':
    'You have no confirmed authorization fact for the countries this posting lists.',
  'eligibility.code.AUTHORIZATION_ABSENT':
    'Your profile records no work authorization at all, so this cannot be answered.',
  'eligibility.code.SPONSORSHIP_REQUIRED':
    'You would need sponsorship. Whether this employer sponsors is their answer to give, not ours.',
  'eligibility.code.LANGUAGE_NOT_DECLARED':
    'You have not declared the language this posting is written in.',
  'eligibility.code.LANGUAGE_NOT_STATED': 'The posting does not state a language.',
  'eligibility.code.SALARY_BELOW_MINIMUM': 'The top of the advertised range is below your minimum.',
  'eligibility.code.SALARY_NOT_STATED': 'The posting states no salary.',
  'eligibility.code.SALARY_NOT_COMPARABLE':
    'The salary is in a different currency or period from your minimum. Nothing was converted.',

  'jobs.minScore': 'Minimum ranking',
  'jobs.minScoreAny': 'Any',
  'jobs.minScoreDescription':
    'Only jobs you have checked can pass this. An unchecked job is not a low-scoring one, so it is left out rather than guessed at.',
  'jobs.eligible': 'Eligibility',
  'jobs.eligibleAny': 'Any',

  'jobDetail.checkFit': 'Check fit',
  'jobDetail.recheckFit': 'Check fit again',
  'jobDetail.checkingFit': 'Checking',
  'jobDetail.fitQueued': 'Checking the fit. This runs locally and uses no AI budget.',
  'jobDetail.fitFailed': 'The fit check did not finish.',
  'jobDetail.fitNotChecked':
    'This job has not been checked against your profile yet. Nothing is scored until you ask.',

  // --- CV studio (M3, PR07) ------------------------------------------------
  // Validation catches what a deterministic comparison can catch and nothing
  // more. Nothing below may describe it as proof that a CV is accurate.

  'cvStudio.title': 'CV studio',
  'cvStudio.intro':
    'Generate a CV from the facts you have confirmed, or send the file you uploaded exactly as it is. Nothing is sent anywhere from this screen.',
  'cvStudio.modeLegend': 'Which CV do you want to send?',
  'cvStudio.modeTailored': 'Generate one from my confirmed profile',
  'cvStudio.modeTailoredDescription':
    'Built from your confirmed facts and ordered for this job. Wording may be reordered or shortened; nothing is added.',
  'cvStudio.modeOriginal': 'Send the file I uploaded',
  'cvStudio.modeOriginalDescription':
    'Your file is sent byte for byte. It is never converted, re-rendered or tailored.',
  'cvStudio.job': 'Job',
  'cvStudio.jobNone': 'No job — a general CV',
  'cvStudio.language': 'Language',
  'cvStudio.pageTarget': 'Target length',
  'cvStudio.pageTargetOption': '{count} pages',
  'cvStudio.pageTargetOptionOne': '1 page',
  'cvStudio.file': 'Uploaded file',
  'cvStudio.fileNone': 'You have not uploaded a CV yet.',
  'cvStudio.fileUploadLink': 'Upload one on the profile screen',
  'cvStudio.generate': 'Generate',
  'cvStudio.generating': 'Generating',
  'cvStudio.useOriginal': 'Use this file',
  'cvStudio.queued': 'Generating your CV. This runs locally unless you configured a provider.',
  'cvStudio.failed': 'The CV could not be generated.',
  'cvStudio.loadFailed': 'The CV could not be loaded.',
  'cvStudio.noProviderNotice':
    'No AI provider is configured, so the CV was assembled directly from your confirmed facts with no rewriting. That is a complete CV, just not a tailored one.',

  'cvStudio.reviewHeading': 'Review before you send',
  'cvStudio.reviewNotice':
    'These checks compare the document against your confirmed facts. They catch invented numbers, names and dates. They cannot judge whether a sentence oversells what you did, so reading this yourself is not optional.',
  'cvStudio.checksPassed': 'Automatic checks found nothing to flag.',
  'cvStudio.checksFailed':
    'Automatic checks flagged {count} problem(s). Each one is listed below with what was removed.',
  'cvStudio.findingsHeading': 'What the checks found',
  'cvStudio.findingRemoved': 'Removed from the CV',
  'cvStudio.findingKept': 'Kept, but worth checking',
  'cvStudio.documentHeading': 'The document',
  'cvStudio.documentEmpty':
    'The document has no sections. Confirm some profile facts and generate it again.',
  'cvStudio.factsCited': 'Built from {count} confirmed fact(s).',
  'cvStudio.provenance': 'Template {template}. {source}',
  'cvStudio.provenanceDeterministic': 'Assembled directly from your facts, with no model involved.',
  'cvStudio.provenanceModel': 'Presented by {provider} ({model}), prompt {prompt}.',
  'cvStudio.pages': 'Rendered to {count} page(s).',

  'cvStudio.downloadsHeading': 'Downloads',
  'cvStudio.downloadPdf': 'Download PDF',
  'cvStudio.downloadDocx': 'Download DOCX',
  'cvStudio.downloadOriginal': 'Download your original file',
  'cvStudio.pdfUnavailable':
    'The PDF could not be produced on this installation, so only the DOCX is offered. The button is absent rather than broken.',
  'cvStudio.atsNotice':
    'A simple single-column layout parses more reliably than a designed one. That improves the odds; it cannot guarantee any particular employer system reads it correctly.',

  'cvStudio.approveHeading': 'Your approval',
  'cvStudio.approveNotice':
    'Nothing is approved by generating it. Read the document above, then approve it yourself.',
  'cvStudio.approve': 'I have read this and approve it',
  'cvStudio.approved': 'Approved on {date}',
  'cvStudio.withdraw': 'Withdraw approval',
  'cvStudio.approveFailed': 'The approval could not be recorded.',

  'resumeFinding.BULLET_WITHOUT_FACT': 'A bullet cited no confirmed fact.',
  'resumeFinding.UNKNOWN_FACT_ID': 'Something cited a fact that is not in your profile.',
  'resumeFinding.NUMBER_NOT_IN_FACTS':
    'A figure appeared that none of the cited facts contain. It was removed rather than left for you to defend in an interview.',
  'resumeFinding.NAME_NOT_IN_FACTS': 'An employer or institution your profile does not contain.',
  'resumeFinding.DATE_NOT_IN_FACTS': 'A date your profile does not state.',
  'resumeFinding.CREDENTIAL_NOT_IN_FACTS': 'A credential identifier your profile does not carry.',
  'resumeFinding.ROLES_MERGED': 'Two separate roles had been folded into one entry.',
  'resumeFinding.PROJECT_PRESENTED_AS_EMPLOYMENT':
    'A personal project was being presented as employment.',
  'resumeFinding.SKILL_NOT_CONFIRMED': 'A skill you have not confirmed.',
  'resumeFinding.SECTION_OMITTED_EMPTY': 'A section was left empty once its entries were removed.',
  'resumeFinding.PAGE_OVERFLOW':
    'The CV is longer than your target. Nothing was truncated and no text was shrunk; shorten it yourself if the length matters.',
  'resumeFinding.MODEL_CORRECTED_ONCE': 'The model needed one correction to return valid output.',
  'resumeFinding.NO_PROVIDER_CONFIGURED': 'No provider is configured, so nothing was tailored.',
  'resumeFinding.MODEL_OUTPUT_REJECTED':
    'The model returned something unusable, so your facts were used directly instead.',
  'resumeFinding.PDF_UNAVAILABLE': 'The PDF could not be rendered on this installation.',

  'resumeSection.summary': 'Summary',
  'resumeSection.skills': 'Skills',
  'resumeSection.experience': 'Experience',
  'resumeSection.projects': 'Projects',
  'resumeSection.education': 'Education',
  'resumeSection.certifications': 'Certifications',
  'resumeSection.languages': 'Languages',
} as const;
