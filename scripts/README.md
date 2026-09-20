# Operator scripts

Every script exists twice and the two versions are feature-equivalent:

|         | Shell                   | Run on                                            |
| ------- | ----------------------- | ------------------------------------------------- |
| `*.sh`  | POSIX `sh`              | Linux, macOS, and Windows via **Git Bash** or WSL |
| `*.ps1` | PowerShell (5.1 and 7+) | Windows, natively                                 |

Pick whichever shell you actually live in. You do not need both.

```bash
sh scripts/setup.sh --help            # POSIX
pwsh -File scripts/setup.ps1 -?       # PowerShell (or: Get-Help scripts/setup.ps1 -Full)
```

**Every script has `--help` / comment-based help.** They are written to be read
before they are run.

---

## What each one does

| Script    | Purpose                                                                     | Run it when                                                 |
| --------- | --------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `setup`   | Create `.env`, generate random secrets, print the one-time setup token once | First install, or to repair a partial `.env`                |
| `migrate` | Apply database migrations, via Compose or locally                           | After a `git pull`; before starting the API on a new schema |
| `smoke`   | End-to-end check against a running stack                                    | After any install, upgrade or restore                       |
| `backup`  | Encrypted `pg_dump` + files archive, with a manifest and checksums          | Daily, and **always before a migration or upgrade**         |
| `restore` | Restore a backup, including into a separate installation                    | Recovery, or rehearsing recovery                            |
| `dev`     | Dev loop: database in Docker, API/web/worker on the host                    | Contributing                                                |

`lib.sh` and `lib.ps1` are shared helpers. They are sourced, not executed.

---

## Conventions all of them follow

- **`set -eu` + `pipefail`**, and `Set-StrictMode -Version Latest` with
  `$ErrorActionPreference = 'Stop'`. A failing step stops the script instead of
  continuing with an empty value.
- **Non-zero exit on any failure**, with the actual error — not a summary of it.
- **Secrets come from a CSPRNG**: `openssl rand` or `/dev/urandom`, and
  `System.Security.Cryptography.RandomNumberGenerator`. Never `$RANDOM`, never
  `Get-Random`.
- **No secrets in shell history or in `ps` output.** Request bodies go through a
  temporary file or `ConvertTo-Json`, never inline in an argument list.
- **`.env` is read key-by-key and never sourced.** Sourcing it would execute the
  file and load every secret into the process environment.
- **Destructive actions confirm first**, and say specifically what will be lost.
  `--yes` / `-Yes` skips the prompt for automation.
- **Paths are absolute**, derived from the script's own location, so it does not
  matter where you run it from.

---

## Status

**These scripts have been syntax-checked, and `setup` has been run end to end
against a throwaway environment file. The rest have not been executed against a
real installation, because there is no working installation yet.**

See [`../IMPLEMENTATION_STATUS.md`](../IMPLEMENTATION_STATUS.md) → "Verified
commands" for exactly what was run and what it printed.
