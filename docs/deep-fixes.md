# Verified plugin management repairs

This release retains the previously merged upstream CSRF origin checks, escaped HTML/JSON attributes, comment privacy, WebAuthn attestation validation, CAPTCHA secret handling, and editor/media improvements. GitHub main was fetched for all15 repositories and matched the local upstream base; no newer main commits were discarded.

## Installation journal and cleanup

- Expected startup plugins reflect the intersection of loaded plugins and persisted enabled state. Older pending journals also respect deliberately disabled plugins.
- Terminal `completed`/`failed` records do not freeze normal writes. The authoritative record remains until history and marker cleanup succeed; reads/startup/new operations retry archival without regressing the result.
- Rollback after a successful commit deletes only a registry row bound to the same installation UUID, row identity and manifest. Replaced or foreign rows are not deleted.
- New staging directories carry owner PID/token metadata. Dead owners can be reaped on boot and subsequent operations without following symlinks. Unidentified legacy stages and live/reused PIDs remain for operator inspection.

## Automatic enable/disable and ordering

The plugins page now submits enable/disable and order changes as durable supervised jobs. The server enters maintenance, restarts and validates actual runtime state before reporting completion. A failed enable restores the prior configuration instead of pretending the plugin is running. Direct mode does not promise managed activation: use `npm start`.

Installation and configuration jobs are mutually exclusive. A temporarily unwritable history directory does not block unrelated writes after a task is durably terminal, but a new task cannot overwrite an unarchived terminal record.

## Package correctness

Pure named type imports/exports are erased dependencies; literal import-equals runtime dependencies are checked. `.mjs/.mts`, `.cjs/.cts` and `.jsx/.tsx` sibling mappings are recognized. Missing explicitly declared assets fail packaging rather than silently producing an incomplete archive. Numeric SemVer prerelease identifiers use lossless comparison, and empty build identifiers are rejected.

Run `npm run test:lpp` for isolated, database-free package regression checks.

## Maintenance navigation

Installation/update maintenance pages poll the minimal readiness endpoint with a bounded duration and reload automatically when the worker is ready. Manual maintenance does not auto-reload in a loop.

## Verification and limits

Changes were tested with fault-injected EIO/EACCES and precise process interruption, real Node supervisor/HTTP restarts, Chrome native/Fluent pages, core/all-plugin checks and the current14 plugin package matrix. These are Windows/Node24 tests; they are not a claim of hardware power-loss durability, Linux execution, arbitrary third-party SQL compatibility, or rollback of plugin side effects.

The easy-2fa plugin also identifies recovery-code consumption by the conditional UPDATE affected-row count rather than a timestamp readback, including concurrent consumers sharing the same timestamp.
