<#
.SYNOPSIS
    Restore a Job Getter backup, optionally into a SEPARATE installation.

.DESCRIPTION
    PowerShell equivalent of scripts/restore.sh.

    docs/spec/10_DEPLOYMENT.md: "Supply scripts for backup and restore to a
    separate installation." That is the interesting case and it is the default
    assumption here - restoring onto a machine that is not the one the backup
    came from, with a different .env and a different ENCRYPTION_KEY.

    THE DELETION LEDGER, AND WHAT THIS SCRIPT STILL WILL NOT CLAIM
    The specification requires a restore to REAPPLY THE DELETION LEDGER BEFORE
    REOPENING ACCESS, so that data a user deleted after the backup was taken
    does not come back to life.

    The ledger exists as of M4 (migration 0007), and this script now does it:
    it saves the target's ledger before touching the database, restores the
    dump, merges the saved rows back in, and runs
    scripts/reapply-deletions.sql so anything either copy recorded as deleted
    stays deleted. It still does not start the API for you.

    What it STILL does not verify: that a restored application can download
    its ORIGINAL CV byte-identically, and that packet hashes and history
    survive (AT11, AT25). Those need a populated installation and are a pilot
    exercise, not something a script can assert.

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
      DOES      Save, merge and reapply the deletion ledger, so data deleted
                after the backup stays deleted.
      DOES NOT  AT25 (profile, files, hashes and history restored) - that
                needs a populated installation, not a script.
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
# THE DELETION LEDGER
#
# Saved BEFORE the restore. The target's ledger knows about deletions the
# backup predates; the backup's ledger is about to overwrite it, so the copy
# has to be taken now or not at all.
# =============================================================================
$ledgerSql      = Join-Path $workDir 'deletion-ledger.sql'
$ledgerSaved    = $false
$ledgerReapplied = 'not run'

if (-not $FilesOnly) {
    & docker compose up -d --wait db 2>$null | Out-Null
    $ledgerPresent = ((& docker compose exec -T db psql -U $pgUser -d $pgDb -tAc "SELECT to_regclass('public.deletion_ledger') IS NOT NULL" 2>$null) -join '').Trim()
    if ($ledgerPresent -eq 't') {
        # Emitted as idempotent INSERTs rather than CSV: one file, readable by
        # a person, replayable into a ledger that already holds some of them.
        $rows = & docker compose exec -T db psql -U $pgUser -d $pgDb -tAc "SELECT format('INSERT INTO deletion_ledger (id, workspace_id, object_kind, object_id, deleted_at, reason, created_at) VALUES (%L,%L,%L,%L,%L,%L,%L) ON CONFLICT (id) DO NOTHING;', id, workspace_id, object_kind, object_id, deleted_at, reason, created_at) FROM deletion_ledger" 2>$null
        Set-Content -LiteralPath $ledgerSql -Value ($rows -join "`n") -Encoding utf8
        $ledgerSaved = $true
        Write-JGOk "saved $(@($rows | Where-Object { $_ -match 'INSERT INTO' }).Count) deletion-ledger row(s) from the target"
    }
    else {
        Write-JGInfo 'the target has no deletion_ledger table yet (pre-M4 schema); nothing to save'
    }
}

Write-Host ''
Write-Host ' After the restore this script merges that saved ledger back in and runs'
Write-Host ' scripts/reapply-deletions.sql, so anything either copy recorded as'
Write-Host ' deleted stays deleted. It will NOT start the API for you.'
Write-Host ''

Confirm-JGAction -Prompt 'Continue with the restore?' -AssumeYes:$Yes

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

        # --- Reapply the deletion ledger --------------------------------------
        # docs/spec/03_DATA_MODEL.md: "Restore must reapply a deletion ledger
        # before exposing data." This is that step, before the script returns.
        $ledgerAfter = ((& docker compose exec -T db psql -U $pgUser -d $pgDb -tAc "SELECT to_regclass('public.deletion_ledger') IS NOT NULL" 2>$null) -join '').Trim()
        if ($ledgerAfter -ne 't') {
            # The dump predates migration 0007. Migrating is migrate.ps1's job,
            # so the ledger is kept and the exact commands printed.
            $ledgerKeep = Join-Path $src 'deletion-ledger.sql'
            if ($ledgerSaved) { Copy-Item -LiteralPath $ledgerSql -Destination $ledgerKeep -Force -ErrorAction SilentlyContinue }
            $ledgerReapplied = 'NO - the restored schema has no deletion_ledger'
            Write-JGWarn 'The restored dump predates the deletion ledger (migration 0007).'
            Write-JGWarn 'The ledger was NOT reapplied. Before serving anything, run:'
            Write-JGWarn '    pwsh scripts/migrate.ps1'
            if ($ledgerSaved) { Write-JGWarn "    cmd /c `"docker compose exec -T db psql -U $pgUser -d $pgDb < `"$ledgerKeep`"`"" }
            Write-JGWarn "    cmd /c `"docker compose exec -T db psql -U $pgUser -d $pgDb -v ON_ERROR_STOP=1 < scripts/reapply-deletions.sql`""
        }
        else {
            if ($ledgerSaved -and (Get-Item -LiteralPath $ledgerSql).Length -gt 0) {
                & cmd /c "docker compose exec -T db psql -U $pgUser -d $pgDb -v ON_ERROR_STOP=1 -q < `"$ledgerSql`"" | Out-Null
                if ($LASTEXITCODE -ne 0) { throw 'merging the saved deletion ledger failed. Do NOT start the API: deleted data may be present.' }
                Write-JGOk "merged the target's deletion-ledger rows back in"
            }
            & cmd /c "docker compose exec -T db psql -U $pgUser -d $pgDb -v ON_ERROR_STOP=1 -q < scripts/reapply-deletions.sql" | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'reapplying the deletion ledger failed. Do NOT start the API: deleted data may be present.' }
            $ledgerTotal = ((& docker compose exec -T db psql -U $pgUser -d $pgDb -tAc 'SELECT count(*) FROM deletion_ledger' 2>$null) -join '').Trim()
            if (-not $ledgerTotal) { $ledgerTotal = '?' }
            $ledgerReapplied = "yes - $ledgerTotal ledger entries replayed"
            Write-JGOk "deletion ledger reapplied ($ledgerTotal entries)"
        }
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
if (-not $FilesOnly) { Write-Host "   deletion ledger: $ledgerReapplied" }
Write-Host ''
Write-Host ' NOT verified, because a script cannot assert them:'
Write-Host '   original CV downloads byte-identical (AT11 - needs a populated install)'
Write-Host '   packet hashes and history preserved  (AT25 - needs a populated install)'
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
