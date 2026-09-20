<#
.SYNOPSIS
    Create .env and generate cryptographically random local secrets.

.DESCRIPTION
    PowerShell equivalent of scripts/setup.sh, for Windows users who are not
    running Git Bash or WSL. The two are feature-equivalent; use whichever
    shell you actually live in.

    It:
      1. Copies .env.example to .env (only if .env does not already exist).
      2. Generates cryptographically random values for
           SESSION_SECRET     32 random bytes, base64  (session cookie signing)
           ENCRYPTION_KEY     32 random bytes, base64  (encrypts stored provider
                                                        API keys; must decode to
                                                        exactly 32 bytes)
           WORKER_AUTH_TOKEN  32 random bytes, URL-safe (worker -> /internal/v1)
           SETUP_TOKEN        32 random bytes, URL-safe (one-time bootstrap)
      3. Prints SETUP_TOKEN to this terminal ONCE.

    Randomness comes from System.Security.Cryptography.RandomNumberGenerator,
    never from Get-Random.

.PARAMETER Force
    Overwrite an existing .env. This REGENERATES EVERY SECRET:
      new SESSION_SECRET     every logged-in session is invalidated
      new ENCRYPTION_KEY     provider API keys already stored in the database
                             CAN NO LONGER BE DECRYPTED and must be re-entered
      new WORKER_AUTH_TOKEN  restart the worker so it picks up the new value
      new SETUP_TOKEN        inert if bootstrap has already completed
    Your database and files are not touched. The previous .env is backed up
    with a timestamp, because the old ENCRYPTION_KEY is the only thing that can
    decrypt already-stored provider secrets.

.PARAMETER KeepExisting
    Fill in only the secrets that are currently empty; leave non-empty ones
    alone. Safe to re-run; use this to repair a partially configured .env.

.PARAMETER Yes
    Do not prompt for confirmation.

.NOTES
    ABOUT SETUP_TOKEN
    It is single-use. You enter it once at http://localhost:3000 to create the
    owner account, after which POST /api/v1/setup closes PERMANENTLY for this
    installation and no token is ever accepted again - so a token leaked after
    bootstrap is inert.

    This script prints it once and writes it to .env so the API can compare
    against it. Nowhere else: no log file, no separate token file, and not in
    your PowerShell history (it is never typed as a command argument).

    Lost it before completing setup?
        Select-String -Path .env -Pattern '^SETUP_TOKEN='
    Bootstrap already closed and you cannot log in? A new token will not help.
    See docs/RUNBOOK.md -> "Lost owner access".

    Never commit .env. It is already excluded by .gitignore.

.EXAMPLE
    pwsh -File scripts/setup.ps1

.EXAMPLE
    pwsh -File scripts/setup.ps1 -KeepExisting
#>
[CmdletBinding()]
param(
    [switch]$Force,
    [switch]$KeepExisting,
    [switch]$Yes
)

. "$PSScriptRoot\lib.ps1"

if ($Force -and $KeepExisting) {
    Stop-JG '-Force and -KeepExisting are contradictory: one regenerates every secret, the other preserves every existing one.'
}

$exampleFile = Join-Path $script:JGRepoRoot '.env.example'
Assert-JGFile -Path $exampleFile -Hint 'run this script from a checkout of the repository'

$envFile = $script:JGEnvFile

# --- Decide what to do with an existing .env ---------------------------------

if (Test-Path -LiteralPath $envFile -PathType Leaf) {
    if ($KeepExisting) {
        Write-JGInfo 'Existing .env kept; filling in empty secrets only.'
    }
    elseif ($Force) {
        Write-JGWarn "-Force: overwriting $envFile and regenerating ALL secrets."
        Write-JGWarn 'Provider API keys already stored in the database will become undecryptable.'
        Confirm-JGAction -Prompt 'Overwrite .env and regenerate every secret?' -AssumeYes:$Yes

        $stamp  = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
        $backup = "$envFile.bak.$stamp"
        Copy-Item -LiteralPath $envFile -Destination $backup -Force
        [void](Set-JGPrivateAcl -Path $backup)
        Write-JGWarn "Previous .env saved to: $backup"
        Write-JGWarn 'It contains the OLD secrets. Keep it out of git and delete it once you are sure.'

        Copy-Item -LiteralPath $exampleFile -Destination $envFile -Force
    }
    else {
        Stop-JG @"
.env already exists at $envFile.
Refusing to overwrite it, because that would destroy the ENCRYPTION_KEY that
decrypts any provider secrets already stored in your database.

  -KeepExisting   fill in only the secrets that are still empty (safe)
  -Force          overwrite and regenerate everything (backs up the old file)
"@
    }
}
else {
    Write-JGInfo "Creating $envFile from .env.example"
    Copy-Item -LiteralPath $exampleFile -Destination $envFile -Force
}

[void](Set-JGPrivateAcl -Path $envFile)

# --- Generate -----------------------------------------------------------------

function Set-JGSecret {
    param(
        [Parameter(Mandatory)][string]$Key,
        [Parameter(Mandatory)][string]$Value
    )
    $current = Get-JGEnvValue -Key $Key
    if ($current -and -not $Force) {
        Write-JGInfo "$Key already set, leaving it alone ($(Get-JGRedacted $current))"
        return
    }
    Set-JGEnvValue -Key $Key -Value $Value
    Write-JGOk "$Key generated"
}

Write-JGInfo 'Generating secrets with System.Security.Cryptography.RandomNumberGenerator'

# 32 raw bytes each. ENCRYPTION_KEY must decode to exactly 32 bytes because it
# keys an AEAD cipher - do not change that number.
Set-JGSecret -Key 'SESSION_SECRET'    -Value (New-JGRandomBase64 -Bytes 32)
Set-JGSecret -Key 'ENCRYPTION_KEY'    -Value (New-JGRandomBase64 -Bytes 32)
Set-JGSecret -Key 'WORKER_AUTH_TOKEN' -Value (New-JGRandomToken  -Bytes 32)

$setupToken   = Get-JGEnvValue -Key 'SETUP_TOKEN'
$setupTokenNew = $false
if ((-not $setupToken) -or $Force) {
    $setupToken = New-JGRandomToken -Bytes 32
    Set-JGEnvValue -Key 'SETUP_TOKEN' -Value $setupToken
    $setupTokenNew = $true
    Write-JGOk 'SETUP_TOKEN generated'
}

# --- Sanity checks ------------------------------------------------------------

foreach ($required in @('SESSION_SECRET', 'ENCRYPTION_KEY', 'WORKER_AUTH_TOKEN', 'SETUP_TOKEN')) {
    if (-not (Get-JGEnvValue -Key $required)) {
        Stop-JG "$required is still empty after generation. Refusing to report success."
    }
}

# A truncated ENCRYPTION_KEY would fail much later, deep inside the API, with a
# far worse error message than this one.
try {
    $decoded = [Convert]::FromBase64String((Get-JGEnvValue -Key 'ENCRYPTION_KEY'))
    if ($decoded.Length -ne 32) {
        Stop-JG "ENCRYPTION_KEY decodes to $($decoded.Length) bytes, expected 32. Re-run with -Force."
    }
} catch {
    Stop-JG "ENCRYPTION_KEY is not valid base64. Re-run with -Force."
}

# --- Report -------------------------------------------------------------------

Write-Host ''
Write-JGOk "Wrote $envFile"
Write-Host ''

if ($setupTokenNew) {
    Write-Host '-----------------------------------------------------------------------'
    Write-Host ' ONE-TIME SETUP TOKEN'
    Write-Host '-----------------------------------------------------------------------'
    Write-Host ''
    # The one and only place this value is printed.
    Write-Host "   $setupToken" -ForegroundColor Cyan
    Write-Host ''
    Write-Host ' Enter it at http://localhost:3000 to create the owner account.'
    Write-Host ''
    Write-Host ' * It is SINGLE-USE. After you complete setup, POST /api/v1/setup closes'
    Write-Host '   permanently for this installation and no token is accepted again.'
    Write-Host ' * It is stored only in .env. This script wrote it nowhere else, and it'
    Write-Host '   is not in your PowerShell history.'
    Write-Host ' * Treat it like a password until you have used it.'
    Write-Host '-----------------------------------------------------------------------'
}
else {
    Write-JGInfo 'SETUP_TOKEN already present; not reprinting it.'
    Write-JGInfo "Read it with: Select-String -Path .env -Pattern '^SETUP_TOKEN='"
}

Write-Host ''
Write-Host 'Next:'
Write-Host '  1. Review .env  (APP_ORIGIN, PROVIDER_DEFAULT, POSTGRES_PASSWORD)'
Write-Host '  2. docker compose up --build -d'
Write-Host '  3. Open http://localhost:3000'
Write-Host ''
Write-Host 'Never commit .env. It is already excluded by .gitignore.'
