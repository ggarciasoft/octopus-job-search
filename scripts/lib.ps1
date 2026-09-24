# =============================================================================
# Shared helpers for the PowerShell scripts in this directory.
#
# Dot-sourced, not executed:  . "$PSScriptRoot\lib.ps1"
#
# Targets Windows PowerShell 5.1 as well as PowerShell 7+, so no ternary
# operator, no ?? / ?. and no -AsHashtable.
# =============================================================================

# The PowerShell equivalent of `set -euo pipefail`. Without these two lines a
# failing cmdlet only writes to the error stream and the script keeps going -
# which is how a setup script "succeeds" having generated nothing.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:JGScriptDir = $PSScriptRoot
$script:JGRepoRoot  = Split-Path -Parent $PSScriptRoot
$script:JGEnvFile   = Join-Path $script:JGRepoRoot '.env'
if ($env:JG_ENV_FILE) { $script:JGEnvFile = $env:JG_ENV_FILE }

function Write-JGInfo { param([string]$Message) Write-Host "==> $Message" -ForegroundColor DarkGray }
function Write-JGOk   { param([string]$Message) Write-Host " OK  $Message" -ForegroundColor Green }
function Write-JGWarn { param([string]$Message) Write-Host "warn $Message" -ForegroundColor Yellow }

# Always terminates. Every failure path ends here so the caller's exit code is
# meaningful.
function Stop-JG {
    param([Parameter(Mandatory)][string]$Message)
    Write-Host "error $Message" -ForegroundColor Red
    exit 1
}

# Runs a native command with its stderr discarded, returning its stdout and
# leaving $LASTEXITCODE set. Plain `2>$null` is not enough: under
# $ErrorActionPreference = 'Stop', Windows PowerShell 5.1 turns every line a
# native program writes to a redirected stderr into a terminating error, and
# docker compose writes its progress there even when it succeeds.
function Invoke-JGNative {
    param([Parameter(Mandatory)][scriptblock]$Command)
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & $Command 2>$null } finally { $ErrorActionPreference = $previous }
}

function Assert-JGCommand {
    param(
        [Parameter(Mandatory)][string]$Name,
        [string]$Hint = ''
    )
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        if ($Hint) { Stop-JG "required command '$Name' not found. $Hint" }
        Stop-JG "required command '$Name' not found on PATH."
    }
}

function Assert-JGFile {
    param(
        [Parameter(Mandatory)][string]$Path,
        [string]$Hint = ''
    )
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        $suffix = ''
        if ($Hint) { $suffix = " ($Hint)" }
        Stop-JG "expected file not found: $Path$suffix"
    }
}

# `docker compose` v2 only. The legacy v1 `docker-compose` cannot express the
# service_completed_successfully dependency that gates the API behind the
# migration job, so falling back to it would silently break ordering.
function Assert-JGCompose {
    Assert-JGCommand -Name 'docker' -Hint 'Install Docker Desktop.'
    Invoke-JGNative { docker compose version } | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Stop-JG "'docker compose' (v2) is not available. Legacy 'docker-compose' v1 is not supported."
    }
}

# --- .env handling -----------------------------------------------------------

# Reads one key WITHOUT executing the file. Never loads every secret into this
# process's environment.
function Get-JGEnvValue {
    param(
        [Parameter(Mandatory)][string]$Key,
        [string]$Path = $script:JGEnvFile
    )
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return '' }
    $pattern = '^\s*' + [regex]::Escape($Key) + '='
    $matched = @(Get-Content -LiteralPath $Path -Encoding UTF8 | Where-Object { $_ -match $pattern })
    if ($matched.Count -eq 0) { return '' }
    # Last assignment wins, matching dotenv loaders.
    $value = ($matched[-1] -replace $pattern, '')
    $value = $value.Trim()
    if ($value.Length -ge 2) {
        if (($value.StartsWith('"') -and $value.EndsWith('"')) -or
            ($value.StartsWith("'") -and $value.EndsWith("'"))) {
            $value = $value.Substring(1, $value.Length - 2)
        }
    }
    return $value
}

# Replaces KEY=... in place or appends it. Writes UTF-8 WITHOUT a BOM: a BOM on
# the first line makes the first variable name unparseable to every dotenv
# reader and to Docker Compose's env_file.
function Set-JGEnvValue {
    param(
        [Parameter(Mandatory)][string]$Key,
        [Parameter(Mandatory)][AllowEmptyString()][string]$Value,
        [string]$Path = $script:JGEnvFile
    )
    Assert-JGFile -Path $Path
    $pattern = '^\s*' + [regex]::Escape($Key) + '='
    $lines   = @(Get-Content -LiteralPath $Path -Encoding UTF8)
    $found   = $false
    $out     = New-Object System.Collections.Generic.List[string]
    foreach ($line in $lines) {
        if ($line -match $pattern) {
            $out.Add("$Key=$Value")
            $found = $true
        } else {
            $out.Add($line)
        }
    }
    if (-not $found) { $out.Add("$Key=$Value") }

    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllLines($Path, $out.ToArray(), $utf8NoBom)
}

# --- Secret generation -------------------------------------------------------

# Cryptographically secure random bytes, base64 encoded.
# Uses RandomNumberGenerator, NOT Get-Random: Get-Random is seeded from a
# pseudo-random source and is NOT suitable for secrets.
function New-JGRandomBase64 {
    param([int]$Bytes = 32)
    $buffer = New-Object 'byte[]' $Bytes
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($buffer) } finally { $rng.Dispose() }
    return [Convert]::ToBase64String($buffer)
}

# URL-safe, unpadded: the value gets copied and pasted by a human and travels
# in an HTTP body.
function New-JGRandomToken {
    param([int]$Bytes = 32)
    return (New-JGRandomBase64 -Bytes $Bytes).Replace('+', '-').Replace('/', '_').Replace('=', '')
}

function Get-JGRedacted {
    param([AllowEmptyString()][string]$Value)
    if ([string]::IsNullOrEmpty($Value)) { return '(empty)' }
    $head = $Value.Substring(0, [Math]::Min(4, $Value.Length))
    return "$head********"
}

function Confirm-JGAction {
    param(
        [Parameter(Mandatory)][string]$Prompt,
        [switch]$AssumeYes
    )
    if ($AssumeYes) { return }
    $answer = Read-Host "$Prompt [y/N]"
    if ($answer -notmatch '^(y|Y|yes|YES)$') { Stop-JG 'aborted by user.' }
}

# Restricts a file to the current user only. NTFS has no chmod; this is the
# closest equivalent and it matters for .env and for backup archives.
function Set-JGPrivateAcl {
    param([Parameter(Mandatory)][string]$Path)
    try {
        $acl = Get-Acl -LiteralPath $Path
        $acl.SetAccessRuleProtection($true, $false)   # break inheritance
        foreach ($rule in @($acl.Access)) { [void]$acl.RemoveAccessRule($rule) }
        $me = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
            $me, 'FullControl', 'Allow')
        $acl.AddAccessRule($rule)
        Set-Acl -LiteralPath $Path -AclObject $acl
        return $true
    } catch {
        Write-JGWarn "could not restrict permissions on $Path : $($_.Exception.Message)"
        return $false
    }
}
