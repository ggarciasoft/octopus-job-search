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
  'setup.passwordDescription': 'At least 12 characters. Hashed with Argon2id; never stored as text.',
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
    'The specification also puts AI provider configuration, a connection test and optional profile import on this screen. Those arrive with M1 and are deliberately absent rather than shown as controls that do nothing.',

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
    'Milestones M1 to M7 are not built yet. The implementation status document is the single record of what is done.',
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
  'status.not_checked.description':
    'Nothing has looked at this yet. It is not a negative result.',
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
  'error.INTERNAL_ERROR': 'The server hit an internal error. The request ID below identifies it in the logs.',
} as const;
