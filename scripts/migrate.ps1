<#
.SYNOPSIS
    Apply database migrations, locally or through Docker Compose.

.DESCRIPTION
    PowerShell equivalent of scripts/migrate.sh.

    This is a thin wrapper. The migration runner itself lives in the API
    (`pnpm --filter @job-getter/api migrate`), because invariant 1 says Node
    owns persistence: exactly one piece of code changes the schema.

.PARAMETER Compose
    Run migrations inside the Compose stack as the one-shot `migrate` service.
    Uses the API image, so migration code and serving code come from the same
    build.

.PARAMETER Local
    Run migrations on the host with pnpm, against the DATABASE_URL in your
    environment or .env. For the scripts/dev.ps1 loop.

.NOTES
    Default is auto: Compose if the `db` service is running, otherwise local.

    BEFORE YOU RUN THIS ON DATA YOU CARE ABOUT, take a backup.
    docs/spec/10_DEPLOYMENT.md: "Back up before migration."

        powershell -ExecutionPolicy Bypass -File scripts/backup.ps1

    Migrations are additive by preference and must be repeatable from an empty
    database. This script never runs DOWN migrations: docs/spec/10_DEPLOYMENT.md
    forbids blindly reversing migrations on live data. To roll back, restore the
    backup you took and read docs/RUNBOOK.md -> "Migration".

    A non-zero exit means DO NOT START THE API against this database.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts/migrate.ps1

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts/migrate.ps1 -Local
#>
[CmdletBinding()]
param(
    [switch]$Compose,
    [switch]$Local
)

. "$PSScriptRoot\lib.ps1"

if ($Compose -and $Local) { Stop-JG '-Compose and -Local are mutually exclusive.' }

Set-Location $script:JGRepoRoot

$mode = 'auto'
if ($Compose) { $mode = 'compose' }
if ($Local)   { $mode = 'local' }

if ($mode -eq 'auto') {
    $dbRunning = ''
    try {
        Invoke-JGNative { docker compose version } | Out-Null
        if ($LASTEXITCODE -eq 0) { $dbRunning = (Invoke-JGNative { docker compose ps --quiet db }) -join '' }
    } catch { }
    if ($dbRunning) {
        $mode = 'compose'
        Write-JGInfo "Compose 'db' service is running; using -Compose."
    } else {
        $mode = 'local'
        Write-JGInfo 'No running Compose database detected; using -Local.'
    }
}

if ($mode -eq 'compose') {
    Assert-JGCompose
    Assert-JGFile -Path $script:JGEnvFile -Hint 'run scripts/setup.ps1 first'

    Write-JGInfo 'Ensuring the database is healthy before migrating...'
    & docker compose up -d --wait db
    if ($LASTEXITCODE -ne 0) {
        Stop-JG "the 'db' service did not become healthy. Check: docker compose logs db"
    }

    Write-JGInfo 'Running the one-shot migrate service...'
    # `run --rm` rather than `up migrate`: this shell's exit code must be the
    # migration's exit code, and the container must be removed either way.
    & docker compose run --rm --no-deps migrate
    if ($LASTEXITCODE -ne 0) {
        Stop-JG @"
Migration failed. The API must not be started against this database.
Inspect the output above, then see docs/RUNBOOK.md -> 'Migration'.
"@
    }
    Write-JGOk 'Migrations applied (Compose).'
}
else {
    Assert-JGCommand -Name 'pnpm' -Hint 'Install pnpm: corepack enable; corepack prepare --activate'

    $databaseUrl = $env:DATABASE_URL
    if (-not $databaseUrl) {
        $databaseUrl = Get-JGEnvValue -Key 'DATABASE_URL'
        # .env defaults to the Compose hostname `db`, which does not resolve on
        # the host. Rewrite it rather than failing with a DNS error the user has
        # to decode.
        if ($databaseUrl -match '@db:') {
            $databaseUrl = $databaseUrl -replace '@db:', '@127.0.0.1:'
            Write-JGInfo "Rewrote the Compose hostname 'db' to 127.0.0.1 for host-side use."
        }
    }
    if (-not $databaseUrl) {
        Stop-JG 'DATABASE_URL is not set and could not be read from .env. Run scripts/setup.ps1 or set $env:DATABASE_URL.'
    }
    $env:DATABASE_URL = $databaseUrl

    # The URL contains a password, so it is never echoed verbatim.
    $redacted = $databaseUrl -replace '://[^@]*@', '://***:***@'
    Write-JGInfo "Migrating $redacted"

    & pnpm --filter '@job-getter/api' migrate
    if ($LASTEXITCODE -ne 0) {
        Stop-JG 'Migration failed. The API must not be started against this database.'
    }
    Write-JGOk 'Migrations applied (local).'
}
