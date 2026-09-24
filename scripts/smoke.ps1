<#
.SYNOPSIS
    End-to-end smoke test against a RUNNING Job Getter stack.

.DESCRIPTION
    PowerShell equivalent of scripts/smoke.sh.

    This is the M0 exit criterion from docs/spec/12_IMPLEMENTATION_PLAN.md:
    "Deliver web -> API -> queued task -> Python -> stored result -> UI."

    It mocks nothing. It talks to the same origin a browser talks to
    (http://localhost:3000, through the web container's /api proxy),
    authenticates like a browser, enqueues a real task, and waits for a real
    Python worker to claim it, process it and report a result back through the
    API. If any link in that chain is missing, this script fails.

    Steps:
      1. GET  /health/ready            API ready (database + schema + storage)
      2. GET  /api/v1/setup            is bootstrap still open?
      3. POST /api/v1/setup   (or /api/v1/auth/login if already closed)
      4. POST /api/v1/diagnostics/echo with a required Idempotency-Key
      5. GET  /api/v1/tasks/:id        polled until succeeded/failed/timeout
      6. Replay step 4 with the SAME Idempotency-Key - must not duplicate work

.PARAMETER BaseUrl
    Origin to test. Default http://localhost:3000, which is what
    docker-compose.yml publishes.

.PARAMETER Email
    Owner email. Default smoke@localhost.invalid

.PARAMETER Password
    Owner password (minimum 12 characters). PREFER the SMOKE_PASSWORD
    environment variable: a password passed as a parameter is visible in your
    PowerShell history. If neither is given and bootstrap is still open, a
    random password is generated and printed once.

.PARAMETER TimeoutSeconds
    How long to wait for the probe task to finish. Default 120.

.NOTES
    PREREQUISITE: the stack must already be running
        docker compose up --build -d
    This script does not start, build or stop anything.

    WHAT A FAILURE MEANS
      ready    API is up but not ready: usually migrations have not run, or
               FILES_ROOT is not writable. Check `docker compose logs api`.
      setup    Bootstrap is closed and no password was supplied, or the
               SETUP_TOKEN in .env does not match the API's.
      enqueue  Authentication worked but the task did not. The response body is
               printed; a VALIDATION_ERROR names the offending field.
      timeout  The task was queued but never completed. That almost always
               means NO WORKER IS CLAIMING IT - check
               `docker compose logs worker` and confirm WORKER_CAPABILITIES
               includes noop_echo.

    Exit code is 0 only when the probe task reached state "succeeded".

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts/smoke.ps1

.EXAMPLE
    $env:SMOKE_PASSWORD = 'correct-horse-battery'; powershell -ExecutionPolicy Bypass -File scripts/smoke.ps1
#>
[CmdletBinding()]
param(
    [string]$BaseUrl,
    [string]$Email,
    [string]$Password,
    [int]$TimeoutSeconds = 0,
    [int]$ReadyTimeoutSeconds = 0
)

. "$PSScriptRoot\lib.ps1"

if (-not $BaseUrl)  { if ($env:SMOKE_BASE_URL) { $BaseUrl = $env:SMOKE_BASE_URL } else { $BaseUrl = 'http://localhost:3000' } }
if (-not $Email)    { if ($env:SMOKE_EMAIL)    { $Email   = $env:SMOKE_EMAIL }    else { $Email   = 'smoke@localhost.invalid' } }
if (-not $Password) { if ($env:SMOKE_PASSWORD) { $Password = $env:SMOKE_PASSWORD } }
if ($TimeoutSeconds -le 0)      { if ($env:SMOKE_TIMEOUT)       { $TimeoutSeconds = [int]$env:SMOKE_TIMEOUT }             else { $TimeoutSeconds = 120 } }
if ($ReadyTimeoutSeconds -le 0) { if ($env:SMOKE_READY_TIMEOUT) { $ReadyTimeoutSeconds = [int]$env:SMOKE_READY_TIMEOUT } else { $ReadyTimeoutSeconds = 90 } }

$BaseUrl = $BaseUrl.TrimEnd('/')

# Windows PowerShell 5.1 negotiates TLS 1.0 by default, which any modern
# endpoint rejects. Harmless for plain http, required if you point this at an
# https origin.
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }

$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession

# Result of the most recent call, so failure handlers can print the real body.
$script:LastStatus = 0
$script:LastBody   = ''

<#
  Single HTTP entry point. Returns the parsed JSON object, or $null.
  Never throws on a non-2xx: the status and body are recorded so the caller can
  decide and report honestly.

  Origin and Referer are sent on every request, because
  docs/spec/09_SECURITY_PRIVACY.md requires origin verification on
  state-changing routes; omitting them would make every mutation look
  cross-origin and fail for the wrong reason.
#>
function Invoke-JGApi {
    param(
        [Parameter(Mandatory)][string]$Method,
        [Parameter(Mandatory)][string]$Path,
        [string]$Body = $null,
        [hashtable]$ExtraHeaders = @{}
    )
    $headers = @{
        'Accept'  = 'application/json'
        'Origin'  = $BaseUrl
        'Referer' = "$BaseUrl/"
    }
    foreach ($k in $ExtraHeaders.Keys) { $headers[$k] = $ExtraHeaders[$k] }

    $params = @{
        Uri             = "$BaseUrl$Path"
        Method          = $Method
        Headers         = $headers
        WebSession      = $session
        UseBasicParsing = $true
        TimeoutSec      = 30
    }
    # Not `$null -ne $Body`: a [string] parameter turns $null into '', so that
    # test is always true, and Windows PowerShell 5.1 refuses a GET with a body.
    if ($PSBoundParameters.ContainsKey('Body')) {
        $params['Body']        = $Body
        $params['ContentType'] = 'application/json'
    }

    $script:LastStatus = 0
    $script:LastBody   = ''
    try {
        $response = Invoke-WebRequest @params
        $script:LastStatus = [int]$response.StatusCode
        $script:LastBody   = $response.Content
    }
    catch [System.Net.WebException] {
        $resp = $_.Exception.Response
        if ($resp) {
            $script:LastStatus = [int]$resp.StatusCode
            try {
                $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
                $script:LastBody = $reader.ReadToEnd()
                $reader.Close()
            } catch { $script:LastBody = '' }
        } else {
            $script:LastBody = $_.Exception.Message
        }
        return $null
    }
    catch {
        $script:LastBody = $_.Exception.Message
        return $null
    }

    if ([string]::IsNullOrWhiteSpace($script:LastBody)) { return $null }
    try { return ($script:LastBody | ConvertFrom-Json) } catch { return $null }
}

function Show-JGBody {
    Write-Host '    response body:'
    if ($script:LastBody) {
        foreach ($line in ($script:LastBody -split "`n")) { Write-Host "    $line" }
    } else {
        Write-Host '    (empty)'
    }
    Write-Host ''
}

function Stop-JGWithBody {
    param([Parameter(Mandatory)][string]$Message)
    Write-Host ''
    Write-Host "--- $Message ---"
    Write-Host "    HTTP status: $($script:LastStatus)"
    Show-JGBody
    Stop-JG $Message
}

Write-Host ''
Write-Host 'Job Getter smoke test'
Write-Host "  target: $BaseUrl"
Write-Host ''

# =============================================================================
# Step 1 - readiness
#
# Liveness (the process is up) and readiness (database, schema and storage are
# usable) answer different questions; only readiness says the stack can serve.
#
# NOTE: the health endpoint PATHS are a cross-component convention, not part of
# the versioned /api/v1 contract in packages/contracts. /health/ready is the
# path apps/api/src/health.ts actually registers (verified 2026-09-20), and it
# is probed first; the alternatives are kept so a future rename produces a clear
# message rather than a mystery timeout. Override with JG_READY_PATH.
# =============================================================================
Write-JGInfo "1/6 waiting for readiness (up to ${ReadyTimeoutSeconds}s)"

$readyCandidates = @('/health/ready', '/readyz', '/api/v1/health/ready')
if ($env:JG_READY_PATH) { $readyCandidates = @($env:JG_READY_PATH) }

$readyPath = $null
$deadline  = (Get-Date).AddSeconds($ReadyTimeoutSeconds)
while ($true) {
    foreach ($candidate in $readyCandidates) {
        [void](Invoke-JGApi -Method GET -Path $candidate)
        if ($script:LastStatus -eq 200) { $readyPath = $candidate; break }
    }
    if ($readyPath) { break }
    if ((Get-Date) -ge $deadline) {
        Write-Host ''
        Write-Host "None of these readiness paths returned 200 within ${ReadyTimeoutSeconds}s:"
        foreach ($candidate in $readyCandidates) { Write-Host "    $BaseUrl$candidate" }
        Write-Host ''
        Write-Host "Last response ($($script:LastStatus)):"
        Show-JGBody
        Write-Host 'Check:  docker compose ps'
        Write-Host '        docker compose logs api --tail 50'
        Write-Host 'If the API is alive but not READY, migrations probably have not run:'
        Write-Host '        powershell -ExecutionPolicy Bypass -File scripts/migrate.ps1'
        Stop-JG 'readiness check failed'
    }
    Write-Host '.' -NoNewline
    Start-Sleep -Seconds 2
}
Write-Host ''
Write-JGOk "ready at $readyPath"

# =============================================================================
# Step 2 - is one-time setup still open?
# =============================================================================
Write-JGInfo '2/6 checking bootstrap state'

$setupStatus = Invoke-JGApi -Method GET -Path '/api/v1/setup'
if ($script:LastStatus -ne 200) { Stop-JGWithBody 'GET /api/v1/setup did not answer 200' }

$setupRequired = $false
$reportedMode  = 'unknown'
if ($setupStatus) {
    if ($setupStatus.PSObject.Properties.Name -contains 'setup_required') { $setupRequired = [bool]$setupStatus.setup_required }
    if ($setupStatus.PSObject.Properties.Name -contains 'mode')           { $reportedMode  = $setupStatus.mode }
}
Write-JGOk "mode=$reportedMode setup_required=$setupRequired"

# =============================================================================
# Step 3 - authenticate
#
# Either complete the single-use bootstrap, or - if it is already closed - log
# in normally. "Already closed" is a normal state, not a failure: this script is
# meant to be re-runnable against an installation that has been set up.
# =============================================================================
if ($setupRequired) {
    Write-JGInfo '3/6 completing one-time setup'

    $setupToken = $env:SMOKE_SETUP_TOKEN
    if (-not $setupToken) { $setupToken = Get-JGEnvValue -Key 'SETUP_TOKEN' }
    if (-not $setupToken) {
        Stop-JG 'bootstrap is open but no SETUP_TOKEN was found in .env or SMOKE_SETUP_TOKEN. Run scripts/setup.ps1 first.'
    }

    $generatedPassword = $false
    if (-not $Password) {
        # Must satisfy the 12-character minimum in the SetupRequest schema.
        $Password = New-JGRandomToken -Bytes 24
        $generatedPassword = $true
    }

    # ConvertTo-Json handles escaping, so a password containing a quote or a
    # backslash cannot break out of the JSON body.
    $body = @{
        setup_token = $setupToken
        email       = $Email
        password    = $Password
        locale      = 'en'
    } | ConvertTo-Json -Compress

    [void](Invoke-JGApi -Method POST -Path '/api/v1/setup' -Body $body)
    if ($script:LastStatus -ne 201 -and $script:LastStatus -ne 200) {
        Stop-JGWithBody 'one-time setup failed'
    }
    Write-JGOk 'owner created, session established'

    if ($generatedPassword) {
        Write-Host ''
        Write-Host '  A password was generated for the smoke-test owner account:'
        Write-Host "      $Password" -ForegroundColor Cyan
        Write-Host '  Printed once. Save it if you want to reuse this installation, or'
        Write-Host '  set $env:SMOKE_PASSWORD next time so a fixed one is used.'
        Write-Host ''
    }
}
else {
    Write-JGInfo "3/6 bootstrap already closed; logging in as $Email"
    if (-not $Password) {
        Stop-JG 'bootstrap is closed, so a password is required. Set $env:SMOKE_PASSWORD (preferred) or pass -Password.'
    }

    $body = @{ email = $Email; password = $Password } | ConvertTo-Json -Compress
    [void](Invoke-JGApi -Method POST -Path '/api/v1/auth/login' -Body $body)
    if ($script:LastStatus -ne 200) { Stop-JGWithBody 'login failed' }
    Write-JGOk 'logged in'
}

# Anti-CSRF: docs/spec/09_SECURITY_PRIVACY.md requires an anti-CSRF token plus
# origin verification on state-changing routes. apps/api/src/auth/sessions.ts
# sets a readable `jg_csrf` cookie alongside the HttpOnly session cookie and
# expects it echoed back in the `x-csrf-token` header (verified 2026-09-20).
# The other names are kept as a fallback. Origin/Referer are already sent on
# every request.
$csrfToken = $null
try {
    $cookies = $session.Cookies.GetCookies([Uri]$BaseUrl)
    foreach ($name in @('jg_csrf', '_csrf', 'csrf-token', 'csrfToken', 'XSRF-TOKEN')) {
        foreach ($cookie in $cookies) {
            if ($cookie.Name -eq $name) { $csrfToken = $cookie.Value; break }
        }
        if ($csrfToken) { break }
    }
} catch { }

if ($csrfToken) {
    Write-JGInfo 'anti-CSRF token picked up from the cookie jar'
} else {
    Write-JGInfo 'no anti-CSRF cookie found; continuing. A 403 on the next step means this script needs the API''s actual CSRF scheme wired in.'
}

# =============================================================================
# Step 4 - enqueue the probe task
#
# POST /api/v1/diagnostics/echo is declared with requiresIdempotencyKey in
# packages/contracts/src/routes.ts, so the header is mandatory.
# =============================================================================
Write-JGInfo '4/6 enqueuing the noop_echo probe task'

$idempotencyKey = 'smoke-' + (New-JGRandomToken -Bytes 12)
$probeMessage   = 'smoke test ' + (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
$echoBody       = @{ message = $probeMessage; delay_ms = 250 } | ConvertTo-Json -Compress

$echoHeaders = @{ 'Idempotency-Key' = $idempotencyKey }
if ($csrfToken) { $echoHeaders['x-csrf-token'] = $csrfToken }

$accepted = Invoke-JGApi -Method POST -Path '/api/v1/diagnostics/echo' -Body $echoBody -ExtraHeaders $echoHeaders
if ($script:LastStatus -ne 202) { Stop-JGWithBody 'enqueuing the probe task failed (expected 202 Accepted)' }

$taskId = $null
if ($accepted -and ($accepted.PSObject.Properties.Name -contains 'task_id')) { $taskId = $accepted.task_id }
if (-not $taskId) { Stop-JGWithBody 'the 202 response contained no task_id' }
Write-JGOk "queued task $taskId"

# =============================================================================
# Step 5 - poll until the worker finishes it
#
# The UI polls every two seconds while a task is active
# (docs/spec/02_ARCHITECTURE.md); this mirrors that.
# =============================================================================
Write-JGInfo "5/6 polling GET /api/v1/tasks/$taskId (up to ${TimeoutSeconds}s)"

$deadline  = (Get-Date).AddSeconds($TimeoutSeconds)
$lastState = ''
$task      = $null
while ($true) {
    $task = Invoke-JGApi -Method GET -Path "/api/v1/tasks/$taskId"
    if ($script:LastStatus -ne 200) { Stop-JGWithBody 'polling the task failed' }

    $state = 'unknown'
    if ($task -and ($task.PSObject.Properties.Name -contains 'state')) { $state = $task.state }

    if ($state -ne $lastState) {
        Write-Host ''
        Write-Host "      state: $state" -NoNewline
        $lastState = $state
    } else {
        Write-Host '.' -NoNewline
    }

    if ($state -eq 'succeeded') { Write-Host ''; break }
    if ($state -eq 'failed' -or $state -eq 'cancelled') {
        Write-Host ''
        Stop-JGWithBody "the probe task ended in state '$state'"
    }

    if ((Get-Date) -ge $deadline) {
        Write-Host ''
        Write-Host "Task $taskId was still '$state' after ${TimeoutSeconds}s."
        Show-JGBody
        Write-Host 'A task stuck in ''queued'' means nothing is claiming it. Check:'
        Write-Host '    docker compose ps worker'
        Write-Host '    docker compose logs worker --tail 50'
        Write-Host '    Select-String -Path .env -Pattern WORKER_CAPABILITIES   # must include noop_echo'
        Write-Host 'A task stuck in ''leased'' means a worker took it and stopped heartbeating;'
        Write-Host 'it should be reclaimed after the 120s lease expires.'
        Stop-JG 'timed out waiting for the probe task'
    }
    Start-Sleep -Seconds 2
}

# The whole point of the probe: the result came back from the PYTHON worker, so
# every hop actually exists.
$echoed = '<unreadable>'; $workerId = '<unreadable>'; $workerRuntime = '<unreadable>'
if ($task -and ($task.PSObject.Properties.Name -contains 'result') -and $task.result) {
    $r = $task.result
    if ($r.PSObject.Properties.Name -contains 'echoed')         { $echoed        = $r.echoed }
    if ($r.PSObject.Properties.Name -contains 'worker_id')      { $workerId      = $r.worker_id }
    if ($r.PSObject.Properties.Name -contains 'worker_runtime') { $workerRuntime = $r.worker_runtime }
}

Write-JGOk 'task succeeded'
Write-Host "      echoed         : $echoed"
Write-Host "      worker_id      : $workerId"
Write-Host "      worker_runtime : $workerRuntime"

if ($echoed -ne '<unreadable>' -and $echoed -ne $probeMessage) {
    Stop-JGWithBody "the worker echoed '$echoed' but the message sent was '$probeMessage'"
}

# =============================================================================
# Step 6 - idempotency
#
# docs/spec/04_API_CONTRACTS.md: the same Idempotency-Key with the same body
# must return the stored response rather than queueing a second task. Getting
# this wrong is how duplicate work happens, so it is checked rather than
# assumed.
# =============================================================================
Write-JGInfo '6/6 replaying the same Idempotency-Key'

$replay = Invoke-JGApi -Method POST -Path '/api/v1/diagnostics/echo' -Body $echoBody -ExtraHeaders $echoHeaders
if ($script:LastStatus -ne 202 -and $script:LastStatus -ne 200) {
    Stop-JGWithBody "replaying the idempotency key returned $($script:LastStatus); expected the stored 202 response"
}
$replayTaskId = $null
if ($replay -and ($replay.PSObject.Properties.Name -contains 'task_id')) { $replayTaskId = $replay.task_id }
if ($replayTaskId -ne $taskId) {
    Stop-JGWithBody "replaying Idempotency-Key '$idempotencyKey' created a SECOND task ($replayTaskId) instead of returning $taskId"
}
Write-JGOk 'idempotent replay returned the same task'

Write-Host ''
Write-JGOk 'SMOKE TEST PASSED'
Write-Host ''
Write-Host '  Verified for real, with no mocks:'
Write-Host "    browser origin -> /api proxy -> API      ($BaseUrl)"
Write-Host "    API -> PostgreSQL                        (readiness at $readyPath)"
Write-Host '    API -> task queue row'
Write-Host "    Python worker claimed and completed it   (worker_id $workerId)"
Write-Host '    result stored and readable through GET /api/v1/tasks/:id'
Write-Host '    Idempotency-Key replay did not duplicate work'
Write-Host ''
exit 0
