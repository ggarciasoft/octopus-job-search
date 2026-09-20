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
} as const;
