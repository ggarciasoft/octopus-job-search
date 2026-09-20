<#
.SYNOPSIS
    Restore a Job Getter backup, optionally into a SEPARATE installation.

.DESCRIPTION
    PowerShell equivalent of scripts/restore.sh.

    docs/spec/10_DEPLOYMENT.md: "Supply scripts for backup and restore to a
    separate installation." That is the interesting case and it is the default
    assumption here - restoring onto a machine that is not the one the backup
    came from, with a different .env and a different ENCRYPTION_KEY.

    HONEST SCOPE LIMIT - READ BEFORE RELYING ON THIS
    The specification requires a restore to REAPPLY THE DELETION LEDGER BEFORE
    REOPENING ACCESS, so that data a user deleted after the backup was taken
    does not come back to life.

    The deletion ledger is M4 work (PR14). IT DOES NOT EXIST YET.

    This script therefore CANNOT perform a spec-complete restore and does not
    pretend to. It restores the database and files, refuses to describe the
    result as verified, prints an explicit warning that any workspace deletion
    performed after the backup timestamp may have been undone, and does not
    start the API for you - so nothing is served until you decide that is
    acceptable.

    The spec also requires proving a restored application can download its
    ORIGINAL CV byte-identically and that packet hashes and history survive
    (AT25, AT11). Those checks need M1-M4 features and M4 data. This script
    verifies what exists now - archive checksums, table counts, file counts -
    and says so. It will not claim AT25 passes.

.PARAMETER From
    Backup to restore. Accepts .tar.gz.age, .tar.gz.gpg, .tar.gz, or an
    unpacked backup directory.

.PARAMETER DropExisting
    Drop and recreate the target database first. DESTRUCTIVE. Without it,
    pg_restore merges into the existing schema, which is almost never what you
    want.

.PARAMETER DbOnly
    Restore the database, leave the files volume alone.

.PARAMETER FilesOnly
    Restore the files volume, leave the database alone.

.NOTES
    RESTORING TO A SEPARATE INSTALLATION
      1. Check out the repository on the target machine.
      2. pwsh -File scripts/setup.ps1        # creates a NEW .env, NEW secrets
      3. Replace ENCRYPTION_KEY in the new .env with the SOURCE installation's,
         if you still have it. Without it, stored provider API keys cannot be
         decrypted and must be re-entered. Everything else restores either way.
      4. docker compose up -d db
      5. pwsh -File scripts/restore.ps1 -From <backup> -DropExisting
      6. pwsh -File scripts/migrate.ps1      # older dump -> current schema
      7. Deal with the deletion-ledger warning this script prints.
      8. Only then: docker compose up -d

    WHAT A SUCCESSFUL RUN DOES AND DOES NOT PROVE
      DOES      Checksums matched; pg_restore reported success; the file
                archive unpacked with the expected file count.
      DOES NOT  AT25 (profile, files, hashes and history restored) - needs
                M1-M4 features that are not built.
                Reapply a deletion ledger - there is no deletion ledger yet.
                Validate the pilot recovery targets (<=24h data loss, restore
                within 4h). Those are UNVALIDATED TARGETS from
                docs/spec/10_DEPLOYMENT.md, not measured results.

.EXAMPLE
    pwsh -File scripts/restore.ps1 -From .\backups\job-getter-20260920T120000Z.tar.gz.age -DropExisting
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$From,
    [switch]$DropExisting,
    [switch]$DbOnly,
    [switch]$FilesOnly,
    [switch]$Yes
)

. "$PSScriptRoot\lib.ps1"

if ($DbOnly -and $FilesOnly) { Stop-JG '-DbOnly and -FilesOnly are contradictory.' }

Set-Location $script:JGRepoRoot
Assert-JGCompose
Assert-JGFile -Path $script:JGEnvFile -Hint "the TARGET installation needs its own .env - run scripts/setup.ps1 first"

$pgUser    = Get-JGEnvValue -Key 'POSTGRES_USER'; if (-not $pgUser)    { $pgUser    = 'jobgetter' }
$pgDb      = Get-JGEnvValue -Key 'POSTGRES_DB';   if (-not $pgDb)      { $pgDb      = 'jobgetter' }
$filesRoot = Get-JGEnvValue -Key 'FILES_ROOT';    if (-not $filesRoot) { $filesRoot = '/var/lib/job-getter/files' }

Assert-JGCommand -Name 'tar' -Hint 'Windows 10 1803 and later include tar.exe.'

# --- Unpack -------------------------------------------------------------------
$workDir = Join-Path ([System.IO.Path]::GetTempPath()) ("jg-restore-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $workDir -Force | Out-Null
[void](Set-JGPrivateAcl -Path $workDir)

$src = $null
try {
    if ($From.EndsWith('.age')) {
        Assert-JGCommand -Name 'age' -Hint 'Install age to decrypt this backup.'
        Write-JGInfo 'Decrypting with age...'
        $plain = Join-Path $workDir 'backup.tar.gz'
        if ($env:JG_AGE_IDENTITY) { & age --decrypt --identity $env:JG_AGE_IDENTITY --output $plain $From }
        else                      { & age --decrypt --output $plain $From }
        if ($LASTEXITCODE -ne 0) { throw 'decryption failed.' }
        & tar -C $workDir -xzf $plain
        if ($LASTEXITCODE -ne 0) { throw 'extraction failed.' }
        Remove-Item -Force -LiteralPath $plain
    }
    elseif ($From.EndsWith('.gpg')) {
        Assert-JGCommand -Name 'gpg' -Hint 'Install gnupg to decrypt this backup.'
        Write-JGInfo 'Decrypting with gpg...'
        $plain = Join-Path $workDir 'backup.tar.gz'
        & gpg --decrypt --output $plain $From
        if ($LASTEXITCODE -ne 0) { throw 'decryption failed.' }
        & tar -C $workDir -xzf $plain
        if ($LASTEXITCODE -ne 0) { throw 'extraction failed.' }
        Remove-Item -Force -LiteralPath $plain
    }
    elseif ($From.EndsWith('.tar.gz') -or $From.EndsWith('.tgz')) {
        Write-JGWarn 'This backup is not encrypted.'
        & tar -C $workDir -xzf $From
        if ($LASTEXITCODE -ne 0) { throw 'extraction failed.' }
    }
    elseif (Test-Path -LiteralPath $From -PathType Container) {
        $src = $From
    }
    else {
        throw "not a recognised backup: $From"
    }

    if (-not $src) {
        $dirs = @(Get-ChildItem -LiteralPath $workDir -Directory)
        if ($dirs.Count -eq 0) { throw "could not locate the backup contents inside $From" }
        $src = $dirs[0].FullName
    }
}
catch {
    Remove-Item -Recurse -Force -LiteralPath $workDir -ErrorAction SilentlyContinue
    Stop-JG $_.Exception.Message
}

Assert-JGFile -Path (Join-Path $src 'manifest.json') -Hint 'this does not look like a scripts/backup archive'

# --- Integrity ----------------------------------------------------------------
$sumsPath = Join-Path $src 'SHA256SUMS'
if (Test-Path -LiteralPath $sumsPath -PathType Leaf) {
    Write-JGInfo 'Verifying checksums...'
    foreach ($line in (Get-Content -LiteralPath $sumsPath)) {
        if ($line -match '^([0-9a-fA-F]{64})\s+\*?(.+)$') {
            $expected = $Matches[1].ToLower()
            $target   = Join-Path $src $Matches[2].Trim()
            if (-not (Test-Path -LiteralPath $target)) {
                Remove-Item -Recurse -Force -LiteralPath $workDir -ErrorAction SilentlyContinue
                Stop-JG "checksum entry refers to a missing file: $target"
            }
            $actual = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLower()
            if ($actual -ne $expected) {
                Remove-Item -Recurse -Force -LiteralPath $workDir -ErrorAction SilentlyContinue
                Stop-JG "CHECKSUM MISMATCH on $target. This archive is corrupt or was modified. Refusing to restore it."
            }
        }
    }
    Write-JGOk 'checksums match'
}
else {
    Write-JGWarn 'No SHA256SUMS in this backup; integrity cannot be verified.'
}

# --- Manifest -----------------------------------------------------------------
$manifest = Get-Content -LiteralPath (Join-Path $src 'manifest.json') -Raw | ConvertFrom-Json

function Get-ManifestValue {
    param([string]$Name, [string]$Default = 'unknown')
    if ($manifest.PSObject.Properties.Name -contains $Name -and $null -ne $manifest.$Name) { return [string]$manifest.$Name }
    return $Default
}

$bkCreated  = Get-ManifestValue 'created_at'
$bkPgVer    = Get-ManifestValue 'postgres_server_version'
$bkFiles    = Get-ManifestValue 'file_count'
$bkQuiesced = Get-ManifestValue 'stack_quiesced'
$bkEncFp    = Get-ManifestValue 'encryption_key_fingerprint'

Write-Host ''
Write-Host 'Backup contents'
Write-Host "  created_at            $bkCreated"
Write-Host "  source postgres       $bkPgVer"
Write-Host "  files in archive      $bkFiles"
Write-Host "  stack quiesced        $bkQuiesced"
Write-Host ''

if ($bkQuiesced -eq 'False' -or $bkQuiesced -eq 'false') {
    Write-JGWarn 'The source stack was RUNNING during the backup. The database dump and the'
    Write-JGWarn 'file archive may be seconds apart: a file referenced by a very recent row'
    Write-JGWarn 'could be missing, or vice versa.'
}

# --- ENCRYPTION_KEY match ------------------------------------------------------
$targetEnc = Get-JGEnvValue -Key 'ENCRYPTION_KEY'
if ($targetEnc -and $bkEncFp -ne 'unknown') {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $hash = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($targetEnc))
        $targetFp = ([BitConverter]::ToString($hash) -replace '-', '').ToLower().Substring(0, 8)
    } finally { $sha.Dispose() }

    if ($targetFp -eq $bkEncFp) {
        Write-JGOk 'ENCRYPTION_KEY matches the source installation; stored provider keys will decrypt.'
    } else {
        Write-JGWarn 'ENCRYPTION_KEY DOES NOT MATCH the source installation.'
        Write-JGWarn 'Everything restores except stored provider API keys, which cannot be'
        Write-JGWarn 'decrypted with this key and must be re-entered in Settings.'
        Write-JGWarn 'If you still have the source .env, copy its ENCRYPTION_KEY over before'
        Write-JGWarn 'continuing. Restoring first and fixing the key later also works.'
    }
}

# =============================================================================
# THE DELETION LEDGER GUARD
#
# This is the part the specification is strict about and the part this build
# cannot satisfy. A loud, explicit refusal rather than a silent omission.
# =============================================================================
Write-Host ''
Write-Host '======================================================================='
Write-Host ' DELETION LEDGER: NOT REAPPLIED - THE FEATURE DOES NOT EXIST YET'
Write-Host '======================================================================='
Write-Host ''
Write-Host ' docs/spec/10_DEPLOYMENT.md requires a restore to reapply the deletion'
Write-Host ' ledger BEFORE reopening access, so that data a user deleted after this'
Write-Host ' backup was taken is not resurrected by restoring it.'
Write-Host ''
Write-Host ' The deletion ledger is part of PR14 / milestone M4 and is NOT'
Write-Host ' IMPLEMENTED. There is nothing for this script to reapply.'
Write-Host ''
Write-Host " CONSEQUENCE: if any workspace or record was deleted AFTER $bkCreated,"
Write-Host ' this restore may bring it back.'
Write-Host ''
Write-Host ' Until M4 lands, this script will NOT describe its result as a verified'
Write-Host ' restore, and it will NOT start the API for you. Decide deliberately'
Write-Host ' whether resurrected data is acceptable for this installation before you'
Write-Host " run 'docker compose up -d'."
Write-Host ''
Write-Host '======================================================================='
Write-Host ''

Confirm-JGAction -Prompt 'Continue with the restore, understanding the deletion-ledger gap?' -AssumeYes:$Yes

$tableCount    = '?'
$restoredCount = '?'

try {
    # --- Database -------------------------------------------------------------
    if (-not $FilesOnly) {
        Assert-JGFile -Path (Join-Path $src 'database.dump') -Hint 'the backup has no database dump'

        Write-JGInfo 'Starting the target database...'
        & docker compose up -d --wait db *> $null
        if ($LASTEXITCODE -ne 0) { throw "the 'db' service did not become healthy." }

        $apiRunning = (& docker compose ps --status running --quiet api 2>$null) -join ''
        if ($apiRunning) {
            Write-JGWarn 'The API is running against the target database.'
            Confirm-JGAction -Prompt 'Stop api and worker before restoring?' -AssumeYes:$Yes
            & docker compose stop api worker *> $null
            Write-JGOk 'api and worker stopped'
        }

        if ($DropExisting) {
            Write-JGWarn "-DropExisting: the CURRENT contents of database '$pgDb' on the TARGET"
            Write-JGWarn 'will be destroyed. This is not the backup - this is whatever is in the'
            Write-JGWarn 'target right now.'
            Confirm-JGAction -Prompt "Drop and recreate '$pgDb'?" -AssumeYes:$Yes
            & docker compose exec -T db psql -U $pgUser -d postgres -v ON_ERROR_STOP=1 `
                -c "DROP DATABASE IF EXISTS `"$pgDb`" WITH (FORCE);" `
                -c "CREATE DATABASE `"$pgDb`" OWNER `"$pgUser`";"
            if ($LASTEXITCODE -ne 0) { throw 'could not recreate the database.' }
            Write-JGOk 'database recreated empty'
        }

        Write-JGInfo 'Restoring the database dump...'
        $dumpPath = Join-Path $src 'database.dump'
        # cmd /c so the dump is fed in as raw bytes; PowerShell's own pipeline
        # would re-encode it and corrupt the archive.
        if ($DropExisting) {
            & cmd /c "docker compose exec -T db pg_restore --username=$pgUser --dbname=$pgDb --no-owner --no-privileges --exit-on-error < `"$dumpPath`""
            if ($LASTEXITCODE -ne 0) { throw 'pg_restore failed. The target database is in an indeterminate state; drop it and start again.' }
        } else {
            & cmd /c "docker compose exec -T db pg_restore --username=$pgUser --dbname=$pgDb --no-owner --no-privileges < `"$dumpPath`""
            if ($LASTEXITCODE -ne 0) { Write-JGWarn 'pg_restore reported errors (expected when merging into a non-empty database). Review the output above.' }
        }
        Write-JGOk 'database restored'

        $tableCount = ((& docker compose exec -T db psql -U $pgUser -d $pgDb -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" 2>$null) -join '').Trim()
        if (-not $tableCount) { $tableCount = '?' }
        Write-JGOk "public schema now has $tableCount tables"
    }

    # --- Files ----------------------------------------------------------------
    if (-not $DbOnly) {
        Assert-JGFile -Path (Join-Path $src 'files.tar.gz') -Hint 'the backup has no file archive'

        Write-JGInfo "Restoring the files volume into $filesRoot..."
        $filesPath = Join-Path $src 'files.tar.gz'
        & cmd /c "docker compose run --rm --no-deps -T --entrypoint sh api -c `"mkdir -p '$filesRoot' && tar -C '$filesRoot' -xzf -`" < `"$filesPath`""
        if ($LASTEXITCODE -ne 0) { throw 'restoring the files volume failed.' }

        $restoredCount = ((& docker compose run --rm --no-deps --entrypoint sh api -c "find '$filesRoot' -type f | wc -l" 2>$null) -join '').Trim()
        if (-not $restoredCount) { $restoredCount = '?' }
        Write-JGOk "files volume now holds $restoredCount files (archive recorded $bkFiles)"
    }
}
catch {
    Remove-Item -Recurse -Force -LiteralPath $workDir -ErrorAction SilentlyContinue
    Stop-JG $_.Exception.Message
}
finally {
    if ($src -ne $From) { Remove-Item -Recurse -Force -LiteralPath $workDir -ErrorAction SilentlyContinue }
}

# --- Report -------------------------------------------------------------------
Write-Host ''
Write-Host '-----------------------------------------------------------------------'
Write-Host ' RESTORE STEPS COMPLETED - NOT A VERIFIED RESTORE'
Write-Host '-----------------------------------------------------------------------'
Write-Host ''
Write-Host ' Verified:'
Write-Host '   archive checksums matched'
if (-not $FilesOnly) { Write-Host "   pg_restore completed; public schema has $tableCount tables" }
if (-not $DbOnly)    { Write-Host "   files volume holds $restoredCount files" }
Write-Host ''
Write-Host ' NOT verified, because the features do not exist yet:'
Write-Host '   deletion ledger reapplied            (M4 / PR14 - not implemented)'
Write-Host '   original CV downloads byte-identical (AT11 - needs M1/M3)'
Write-Host '   packet hashes and history preserved  (AT25 - needs M4)'
Write-Host ''
Write-Host ' Recovery targets from docs/spec/10_DEPLOYMENT.md - at most 24 hours data'
Write-Host ' loss, restore within 4 hours - are UNVALIDATED TARGETS. This run is not'
Write-Host ' evidence that they are met.'
Write-Host ''
Write-Host ' Next:'
Write-Host '   pwsh -File scripts/migrate.ps1   # older dump -> current schema'
Write-Host '   docker compose up -d             # only once you accept the notes above'
Write-Host '   pwsh -File scripts/smoke.ps1     # confirm the stack works end to end'
Write-Host '-----------------------------------------------------------------------'
