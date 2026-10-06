# Durable installation state and crash cleanup

<!-- Authors: MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥; worryzu <worryzu@gmail.com> @LinearTeam. Copyright (C) 2026 Evarentha; SPDX-License-Identifier: GPL-3.0-or-later -->

## Desired state and pending work

An install snapshots **actually loaded plugin IDs intersected with registry `enabled=1`**. Verification and recovery also exclude explicitly disabled IDs in older schema-1 journals. A missing registry row is not treated as a deliberate disable. Existing disabled or previously failed plugins are not newly required by an install.

`hasPendingInstall()` covers in-process preparation as well as durable nonterminal work. It returns false for a retained `completed`/`failed` journal. Therefore a history-directory permission failure cannot lock all site mutations after safe terminalization. Configuration jobs must consult this predicate before beginning, and installations check maintenance again after asynchronous preparation.

## One authoritative terminal state

`data/plugin-install-job.json` is authoritative while present. State changes are atomic writes; in-memory phase advances only after that write succeeds. A terminal phase is never changed by cleanup errors.

History is a replica, not grounds for discarding the journal. Terminal archival proceeds in this order:

1. Atomically write the same terminal record to `data/plugin-install-jobs/<uuid>.json`.
2. For completed installs, remove only this job's installation marker. Read/removal failure is retryable.
3. Remove the authoritative journal.
4. Best-effort prune old history; pruning cannot invalidate success.

If history or marker/journal cleanup fails, status remains terminal and normal site writes are allowed. Status polling, a later install request, verification, recovery, and boot housekeeping retry archival. A **new installation** is refused until the old authoritative record is safely archived; it never overwrites the only terminal copy. Repair filesystem permissions and retry; no operator restart is needed for this case.

If code quarantine, owned registry rollback, or the authoritative terminal write fails, the deployment is not safely finished. The nonterminal journal remains pending and the site is not unlocked by throwing away that record. Recovery remains bounded by the supervisor policy described in [supervised-deployment.md](supervised-deployment.md).

## Registry ownership

For managed commits, registry INSERT and a `plugin_install_ownership` record are one SQLite transaction. Ownership binds installation UUID, plugin ID, registry rowid, and manifest identity (`name`, `version`, `type`, `icon`, `description`). Delete/insert/replace/ID-change triggers invalidate the old ownership identity. Rollback after a successful commit can thus remove its own row without deleting a concurrent replacement or a changed manifest merely because the plugin ID matches.

Recovery additionally requires this job's marker in the quarantined directory before deleting its registry row. Existing IDs are rejected before deployment and never treated as owned. Historical journals without an ownership record still quarantine marker-owned code and reach terminal status; an unverifiable legacy registry row is conservatively retained for operator inspection rather than guessed to be safe to delete. This is not a rollback of arbitrary plugin data mutations.

## Staging ownership and housekeeping

Preparation uses sibling `src/.plugin-install-staging/install-<pid>-<boot-token>-<stage-token>` directories and a reserved `.linearpress-stage.json` owner record. Package payloads cannot supply either the stage or deployment marker. The directory name itself covers the small mkdir-before-record crash window.

`runPluginInstallHousekeeping()` from `core/plugin-install-jobs.ts` is a synchronous pre-discovery boot hook. It retries terminal archival and reaps dead-owned staging. Recovery workers reap staging even when no journal exists; every subsequent prepare also reaps it. `reapPluginInstallStaging()` is exported from the installer for staging-only callers.

Reaping requires an identified owner PID that the OS reports **absent (`ESRCH`)**. A live/reused PID, `EPERM`, an active local stage, foreign owner token, symlink/junction or nested foreign link is not deleted. Old timestamps alone are never authority to delete a live stage. Old-format unidentifiable stages require operator inspection. This conservative policy prefers delayed reclaim on PID reuse over deleting an active upload; normal process-exit orphans are reclaimed immediately without a TTL.

## Regression evidence

Run from the isolated worktree with private dependency copies created by `.pi/lpp/test-utils.mjs`:

```sh
node Base/node_modules/tsx/dist/cli.mjs .pi/lpp/fix-deep-journal-regression.mts
node Base/node_modules/tsx/dist/cli.mjs .pi/lpp/fix-deep-journal-http.mts
node Base/node_modules/tsx/dist/cli.mjs .pi/lpp/fix-deep-journal-e2e.mts
node Base/node_modules/typescript/bin/tsc --noEmit -p Base/tsconfig.json
```

The fault suite preserves the old audit separately, changes its 22 behavioral assertions to the required outcomes, and extends coverage to 37 checks. It injects worker-local EIO/EACCES/ENOSPC, performs actual process exits between rename/INSERT and quarantine/phase transitions, exercises real SQLite row replacement and manifest ownership, and tests active/dead/PID-reuse/symlink staging. Its preparation-concurrency case stubs fetch (no external request), and module-level cases stub managed IPC capability only; they do not claim supervisor protocol coverage.

The separate HTTP regression uses the real supervisor, authenticated toggle and install endpoints, readiness boot IDs, and the candidate's live route. It supports both deferred pre-LP048 toggle and managed change-job responses. The E2E suite covers real install/restart and activation/import/hang recovery. These runs use private fixture data/dependencies and loopback ports, never the original site's data. No physical power-loss or hardware cache durability claim is made.
