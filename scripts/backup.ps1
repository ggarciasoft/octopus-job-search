<#
.SYNOPSIS
    Back up the Job Getter database and files volume.

.DESCRIPTION
    PowerShell equivalent of scripts/backup.sh.

    Produces a directory under backups/ containing:
      database.dump   pg_dump custom format (-Fc), restorable with pg_restore
      files.tar.gz    the FILES_ROOT volume
      manifest.json   what was captured, when, from which versions
      SHA256SUMS      checksums of the three files above
    and then packs and encrypts it, unless you pass -NoEncrypt.

    docs/spec/10_DEPLOYMENT.md requires backups to be ENCRYPTED. This script
    will not silently produce a plaintext backup: either give it a recipient, or
    pass -NoEncrypt and acknowledge what you are doing.

    CONSISTENCY - read before trusting a backup. The database dump and the file
    archive are taken at slightly different moments. For a single-owner local
    installation that is almost always fine. To make it exact:
        docker compose stop api worker
        pwsh -File scripts/backup.ps1
        docker compose start api worker
    The manifest records whether the stack was quiesced, so a restore can tell
    you what it is working with instead of guessing.

.PARAMETER OutDir
    Where to write the backup. Default .\backups

.PARAMETER Label
    Extra label in the backup name, e.g. pre-migration.

.PARAMETER AgeRecipient
    Encrypt with `age` to this public key (recommended). Or set
    $env:JG_AGE_RECIPIENT.

.PARAMETER GpgRecipient
    Encrypt with `gpg` to this recipient. Or set $env:JG_GPG_RECIPIENT.

.PARAMETER NoEncrypt
    Produce a PLAINTEXT backup. You are then responsible for storing it
    somewhere encrypted. It contains every CV, every job record and the whole
    application history in the clear.

.NOTES
    WHAT IS AND IS NOT IN THE BACKUP
      IN      PostgreSQL database (profile, jobs, applications, tasks, events)
              FILES_ROOT volume (uploaded CVs, generated documents, exports)
      NOT IN  .env, and therefore not SESSION_SECRET, ENCRYPTION_KEY,
              WORKER_AUTH_TOKEN or SETUP_TOKEN.

    That exclusion is deliberate. docs/spec/09_SECURITY_PRIVACY.md requires the
    operator encryption key to live OUTSIDE the database so a stolen database
    backup cannot decrypt stored provider API keys. Bundling .env would undo
    exactly that.

    CONSEQUENCE: keep ENCRYPTION_KEY somewhere safe and separate. A restore
    without it recovers everything except stored provider API keys, which must
    be re-entered. The manifest records an 8-character hash prefix of
    ENCRYPTION_KEY so a restore can TELL you whether your key matches, without
    storing the key itself.

    RECOVERY TARGETS (UNVALIDATED): docs/spec/10_DEPLOYMENT.md states pilot
    targets of at most 24 hours data loss and restore within 4 hours, and
    explicitly says to validate them before claiming them. They have NOT been
    validated for this installation. They are targets, not measured results.

.EXAMPLE
    pwsh -File scripts/backup.ps1 -AgeRecipient age1abc...

.EXAMPLE
    pwsh -File scripts/backup.ps1 -NoEncrypt -Label pre-migration
#>
[CmdletBinding()]
param(
    [string]$OutDir,
    [string]$Label = '',
    [string]$AgeRecipient,
    [string]$GpgRecipient,
    [switch]$NoEncrypt,
    [switch]$Yes
)

. "$PSScriptRoot\lib.ps1"

if (-not $OutDir) {
    if ($env:JG_BACKUP_DIR) { $OutDir = $env:JG_BACKUP_DIR }
    else { $OutDir = Join-Path $script:JGRepoRoot 'backups' }
}
if (-not $AgeRecipient -and $env:JG_AGE_RECIPIENT) { $AgeRecipient = $env:JG_AGE_RECIPIENT }
if (-not $GpgRecipient -and $env:JG_GPG_RECIPIENT) { $GpgRecipient = $env:JG_GPG_RECIPIENT }

Set-Location $script:JGRepoRoot
Assert-JGCompose
Assert-JGFile -Path $script:JGEnvFile -Hint 'run scripts/setup.ps1 first'

# --- Decide on encryption BEFORE doing any work -------------------------------
$encryption = 'none'
if ($NoEncrypt) {
    Write-JGWarn 'PLAINTEXT BACKUP: it will contain CVs, contact details and the full'
    Write-JGWarn 'application history with no encryption at rest.'
    Confirm-JGAction -Prompt 'Write an unencrypted backup?' -AssumeYes:$Yes
}
elseif ($AgeRecipient) {
    Assert-JGCommand -Name 'age' -Hint 'Install age, or use -GpgRecipient, or -NoEncrypt.'
    $encryption = 'age'
}
elseif ($GpgRecipient) {
    Assert-JGCommand -Name 'gpg' -Hint 'Install gnupg, or use -AgeRecipient, or -NoEncrypt.'
    $encryption = 'gpg'
}
else {
    Stop-JG @'
No encryption configured, and docs/spec/10_DEPLOYMENT.md requires backups to be encrypted.

Pick one:
  -AgeRecipient age1...    (install: https://github.com/FiloSottile/age)
  -GpgRecipient you@...
  -NoEncrypt               produce a PLAINTEXT backup and take responsibility
                           for storing it encrypted yourself
'@
}

# --- Gather context -----------------------------------------------------------
$pgUser   = Get-JGEnvValue -Key 'POSTGRES_USER'; if (-not $pgUser)   { $pgUser   = 'jobgetter' }
$pgDb     = Get-JGEnvValue -Key 'POSTGRES_DB';   if (-not $pgDb)     { $pgDb     = 'jobgetter' }
$filesRoot = Get-JGEnvValue -Key 'FILES_ROOT';   if (-not $filesRoot) { $filesRoot = '/var/lib/job-getter/files' }

$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$name  = "job-getter-$stamp"
if ($Label) { $name = "$name-$Label" }
$stage = Join-Path $OutDir $name

New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
New-Item -ItemType Directory -Path $stage  -Force | Out-Null
[void](Set-JGPrivateAcl -Path $stage)

Write-JGInfo "Backup: $stage"

# Is the stack quiesced? Recorded in the manifest so a restore knows whether
# the two halves are guaranteed consistent with each other.
$apiRunning    = (& docker compose ps --status running --quiet api 2>$null) -join ''
$workerRunning = (& docker compose ps --status running --quiet worker 2>$null) -join ''
$quiesced = 'true'
if ($apiRunning -or $workerRunning) {
    $quiesced = 'false'
    Write-JGWarn 'api/worker are running: the dump and the file archive are taken moments apart.'
    Write-JGWarn 'For a strictly consistent backup: docker compose stop api worker'
}

try {
    # --- Database -------------------------------------------------------------
    Write-JGInfo 'Dumping the database...'
    & docker compose up -d --wait db *> $null
    if ($LASTEXITCODE -ne 0) { throw "the 'db' service is not healthy; cannot dump. Check: docker compose logs db" }

    $dumpPath = Join-Path $stage 'database.dump'
    # -Fc  custom format: compressed, and pg_restore can filter/reorder it.
    # --no-owner/--no-privileges: the restore target may use a different role.
    # --serializable-deferrable: a genuinely consistent snapshot, not a
    #   read-committed smear across the dump's duration.
    # cmd /c is used so the container's stdout is redirected as raw bytes;
    # PowerShell's own redirection would re-encode the binary dump and corrupt it.
    & cmd /c "docker compose exec -T db pg_dump --username=$pgUser --dbname=$pgDb --format=custom --no-owner --no-privileges --serializable-deferrable > `"$dumpPath`""
    if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed. Nothing was written.' }
    if (-not (Test-Path -LiteralPath $dumpPath) -or (Get-Item -LiteralPath $dumpPath).Length -eq 0) {
        throw 'pg_dump produced an empty file. Refusing to call this a backup.'
    }
    Write-JGOk "database.dump ($((Get-Item -LiteralPath $dumpPath).Length) bytes)"

    $pgVersion = ((& docker compose exec -T db psql -U $pgUser -d $pgDb -tAc 'SHOW server_version' 2>$null) -join '').Trim()
    if (-not $pgVersion) { $pgVersion = 'unknown' }

    # --- Files ----------------------------------------------------------------
    Write-JGInfo "Archiving the files volume ($filesRoot)..."
    $filesPath = Join-Path $stage 'files.tar.gz'
    & cmd /c "docker compose run --rm --no-deps --entrypoint sh api -c `"tar -C '$filesRoot' -czf - .`" > `"$filesPath`""
    if ($LASTEXITCODE -ne 0) { throw "archiving $filesRoot failed." }

    $fileCount = ((& docker compose run --rm --no-deps --entrypoint sh api -c "find '$filesRoot' -type f | wc -l" 2>$null) -join '').Trim()
    if (-not $fileCount) { $fileCount = '0' }
    Write-JGOk "files.tar.gz ($fileCount files, $((Get-Item -LiteralPath $filesPath).Length) bytes)"

    # --- Manifest -------------------------------------------------------------
    # A fingerprint of ENCRYPTION_KEY, NOT the key. Lets restore.ps1 say "your
    # ENCRYPTION_KEY does not match this backup" instead of leaving you to
    # discover it later.
    $encKey = Get-JGEnvValue -Key 'ENCRYPTION_KEY'
    $encFingerprint = 'unknown'
    if ($encKey) {
        $sha = [System.Security.Cryptography.SHA256]::Create()
        try {
            $hash = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($encKey))
            $encFingerprint = ([BitConverter]::ToString($hash) -replace '-', '').ToLower().Substring(0, 8)
        } finally { $sha.Dispose() }
    }

    $appMode = Get-JGEnvValue -Key 'APP_MODE'; if (-not $appMode) { $appMode = 'local' }
    $manifest = @"
{
  "format_version": 1,
  "created_at": "$((Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'))",
  "source_app_mode": "$appMode",
  "postgres_server_version": "$pgVersion",
  "database": "$pgDb",
  "files_root": "$filesRoot",
  "file_count": $fileCount,
  "stack_quiesced": $quiesced,
  "encryption_key_fingerprint": "$encFingerprint",
  "contains_env_file": false,
  "deletion_ledger_included": false,
  "notes": [
    "The .env file and therefore ENCRYPTION_KEY are NOT in this backup, by design.",
    "encryption_key_fingerprint is sha256(ENCRYPTION_KEY) truncated to 8 hex chars; it is a match indicator, not the key.",
    "stack_quiesced=false means api/worker were running during the dump; database and files may be seconds apart.",
    "deletion_ledger_included=false: the deletion ledger is M4 work and does not exist yet. See scripts/restore.ps1."
  ]
}
"@
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText((Join-Path $stage 'manifest.json'), $manifest, $utf8NoBom)
    Write-JGOk 'manifest.json'

    # --- Checksums ------------------------------------------------------------
    # sha256sum-compatible format, so scripts/restore.sh on another OS can
    # verify an archive produced here.
    $lines = foreach ($f in @('database.dump', 'files.tar.gz', 'manifest.json')) {
        $h = (Get-FileHash -LiteralPath (Join-Path $stage $f) -Algorithm SHA256).Hash.ToLower()
        "$h  $f"
    }
    [System.IO.File]::WriteAllLines((Join-Path $stage 'SHA256SUMS'), [string[]]$lines, $utf8NoBom)
    Write-JGOk 'SHA256SUMS'
}
catch {
    Write-JGWarn "backup failed; removing the incomplete directory $stage"
    Remove-Item -Recurse -Force -LiteralPath $stage -ErrorAction SilentlyContinue
    Stop-JG $_.Exception.Message
}

# --- Pack and encrypt ---------------------------------------------------------
# bsdtar ships with Windows 10 1803+ as tar.exe.
Assert-JGCommand -Name 'tar' -Hint 'Windows 10 1803 and later include tar.exe.'

$tarPath = Join-Path $OutDir "$name.tar.gz"
& tar -C $OutDir -czf $tarPath $name
if ($LASTEXITCODE -ne 0) { Stop-JG "packing failed; the plaintext staging directory is still at $stage" }

$artifact = $tarPath
switch ($encryption) {
    'age' {
        Write-JGInfo "Encrypting with age -> $name.tar.gz.age"
        & age --recipient $AgeRecipient --output "$tarPath.age" $tarPath
        if ($LASTEXITCODE -ne 0) { Stop-JG "age encryption failed; plaintext is still at $tarPath and $stage. Encrypt or delete them." }
        Remove-Item -Force -LiteralPath $tarPath
        $artifact = "$tarPath.age"
    }
    'gpg' {
        Write-JGInfo "Encrypting with gpg -> $name.tar.gz.gpg"
        & gpg --encrypt --recipient $GpgRecipient --output "$tarPath.gpg" $tarPath
        if ($LASTEXITCODE -ne 0) { Stop-JG "gpg encryption failed; plaintext is still at $tarPath and $stage. Encrypt or delete them." }
        Remove-Item -Force -LiteralPath $tarPath
        $artifact = "$tarPath.gpg"
    }
}

Remove-Item -Recurse -Force -LiteralPath $stage -ErrorAction SilentlyContinue
[void](Set-JGPrivateAcl -Path $artifact)

Write-Host ''
Write-JGOk "Backup written: $artifact"
Write-Host ''
Write-Host "  Restore it with:  pwsh -File scripts/restore.ps1 -From '$artifact'"
Write-Host ''
if ($encryption -eq 'none') {
    Write-JGWarn 'This backup is NOT encrypted. Store it somewhere encrypted at rest.'
}
if ($quiesced -eq 'false') {
    Write-JGWarn 'Taken with api/worker running: database and files are not guaranteed to'
    Write-JGWarn 'be from the same instant. Recorded in manifest.json.'
}
Write-Host 'A backup you have never restored is a hypothesis, not a backup.'
Write-Host "docs/RUNBOOK.md -> 'Backup and restore' has a rehearsal procedure."
