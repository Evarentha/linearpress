<!--
  LinearPress LPP Format
  Copyright (C) 2026 Evarentha
  SPDX-License-Identifier: GPL-3.0-or-later
-->
# LinearPress plugin packages: LPP v1

`.lpp` is a ZIP container, not a renamed JavaScript bundle. The source tree is
installed unchanged under `src/plugins/<pluginId>`: imports such as
`../../core/...`, `../../services/...` and `../../types/...` keep their meaning.
There is no compilation, network dependency installation, npm lifecycle script
execution, or plugin execution during packing or preparation.

**Plugins are trusted server-side code, not a sandbox. SHA-256 detects damaged
or changed package contents; it is NOT a publisher signature or a proof of
safety.** An attacker can replace both a file and its hash. Obtain packages from
publishers you trust and review their code. Install/activate can access the
server's privileges, secrets and databases. Static lifecycle validation does
not guarantee safe behavior or successful activation.

## Creating a package

From the host `Base` directory, with its dependencies already installed:

```sh
node scripts/run.js scripts/pack-plugin.ts ../Plugins/modern-editor --out dist/modern-editor.lpp
# Equivalent when package.json contains the plugin:pack script:
npm run plugin:pack -- ../Plugins/modern-editor --out dist/modern-editor.lpp
```

The command accepts exactly one plugin source directory and `--out <file.lpp>`.
Output must be outside the source tree. It validates manifest/lifecycle exports,
compatibility and dependencies, writes a temporary output, and renames it only
when the complete container passes validation. Errors exit nonzero. A previous
output is not removed when source validation fails. Entry source is parsed with
TypeScript; it is never imported.

The source root must contain `plugin.json`. `package.json`, if present, supplies
`peerDependencies.linearpress`, `engines.node` and production dependencies.
Absent an explicit LinearPress peer requirement, v1 uses `^3.0.0`.

Included: source files, legal notices, README, templates, `views`, `public`, and
prebuilt browser assets. No bundling/rebasing of plugin-relative imports occurs.
Excluded at any depth:

- `.git`, `.github`, `.pi`, `.svn`, `.hg`, `node_modules`, `data`, `uploads`, `dist`;
- `.env` and `.env.*`, `.npmrc`, `.yarnrc`, `.yarnrc.yml`, `.idea`, `.vscode`, `.cache`;
- `test`, `tests`, `__tests__`, `__snapshots__`, `coverage`, `test-results`, `playwright-report`;
- `*.test.[cm]?[jt]sx?`, `*.spec.[cm]?[jt]sx?`, package archives, logs,
  SQLite/database files and `.pem`, `.key`, `.p12` key material;
- old root `lpp.json` (regenerated), `.DS_Store`, `Thumbs.db`.

Nonexcluded links or special files fail packing, not follow their targets.
Exclusions are a safety default, not a secret scanner: review the final file
list, especially custom-named credentials. Runtime entry imports of an excluded
local file fail rather than silently producing a broken archive. Empty folders
are not needed/included by the packer. Keep required build products somewhere
other than `dist`, for example `public/vendor` or `lib`.

## Container schema

At the ZIP root, exactly one `plugin.json` and one `lpp.json` are required. A
wrapper folder is not permitted for LPP. Example `lpp.json`:

```json
{
  "format": "linearpress-plugin",
  "formatVersion": 1,
  "pluginId": "example",
  "pluginVersion": "3.0.0",
  "requires": {
    "linearpress": "^3.0.0",
    "node": ">=22.0.0",
    "host": { "express": "^5.1.0" }
  },
  "files": [
    { "path": "plugin.json", "size": 120, "sha256": "<64 lowercase hexadecimal characters>" },
    { "path": "index.ts", "size": 321, "sha256": "<64 lowercase hexadecimal characters>" }
  ]
}
```

- `requires.linearpress` is mandatory; `requires.node` and `requires.host` are
  optional. Requirements are checked against **actual installed versions**, not
  merely package.json dependency declarations, during pack and install.
- `pluginId` and `pluginVersion` must equal the validated `plugin.json` values.
- `files` lists every regular file **including plugin.json and package.json**,
  but excludes `lpp.json` itself. `size` is the uncompressed byte count; `sha256`
  hashes the exact file bytes. No extra, omitted, duplicate or conflicting file
  is accepted. Directory ZIP records contain no data and are not extracted.
- `.linearpress-install.json` is a reserved server-generated ownership marker;
  archives containing a path component with that name (case insensitive) fail.
- Semver ranges supported in v1: full `major.minor.patch` versions (including
  prerelease/build suffixes), `=`, `>`, `>=`, `<`, `<=`, `^`, `~`, whitespace AND,
  `||` OR, and `*`. Unsupported shorthand such as `3.x`, `>=22`, hyphen ranges,
  npm aliases, git URLs and tags fails closed. Prerelease candidates only match
  clauses explicitly naming a prerelease with the same version triple.

Incompatible format, host/core/Node version, CRC, SHA-256 or identity is a hard
failure **before deployment and DB registration**; it is not just a warning.
Uploading root-level LPP bytes through the historical ZIP endpoint still checks
LPP hashes. A wrapped `lpp.json` is rejected instead of downgraded to legacy ZIP.

## Dependency policy (intentionally conservative v1)

The host's direct production dependencies are explicit externals: `adm-zip`,
`bcryptjs`, `cordis`, `ejs`, `express`, `express-ejs-layouts`, `express-session`,
`fs-extra`, `lodash-es`, `mysql2`, `tar`, and `typescript` in this host release.
Host dependency availability and installed version are checked. Declared
`dependencies`, nonoptional peers and `optionalDependencies` must be host
externals; v1 rejects unsupported production dependencies even if a developer
has installed them locally. Archive `node_modules` is rejected. There is no
implicit transitive-host dependency allowance, vendoring promise, native-module
portability promise or server-side `npm install`.

Literal runtime imports/re-exports/`require`/dynamic `import('literal')` reachable
from the entry are inspected recursively. Built-ins are permitted. Undeclared
host imports acquire the host's own version constraint; undeclared non-host
imports fail. Build scripts and browser assets are not treated as server entry
modules. Arbitrary computed imports cannot be established statically; author
review is still required and this is not a complete runtime correctness check.
Explicit optional peer metadata can permit an absent non-host optional feature;
this neither packages nor installs it. For example, the existing user-management
SMTP integration declares optional `nodemailer` metadata: default plugins pack,
but SMTP requires a separate operator-reviewed host provisioning step. Do not
mistake a successful pack for availability of that optional feature.

The 14 existing plugin repositories pack with this policy. In the isolated
regression environment, `modern-editor` requires `express ^5.1.0` and installed
`5.2.1` passes; `mysql-plugin` requires `mysql2 ^3.11.5` and installed `3.23.4`
passes. The algorithm reads installed package metadata each time, not these
example version strings.

## Archive safety and quotas

Classic single-disk ZIP only, stored or deflated entries. No ZIP64, encryption,
self-extracting prefix, hidden/overlapping local records or unsupported methods.
Central/local names, methods, flags, CRCs, sizes and data descriptors agree.
Each inflate has a bounded output length and its actual CRC/size is verified.
UTF-8 names are required (ASCII works without the UTF-8 flag).

Defaults (shared with legacy ZIP; npm has corresponding limits):

| Limit | Value |
| --- | ---: |
| Compressed upload | 50 MiB |
| One uncompressed file | 32 MiB |
| Total regular-file bytes | 150 MiB |
| Archive entries | 10,000 |
| Expansion ratio for entries larger than 1 MiB | 200:1 |
| Each JSON metadata document | 2 MiB |
| Relative path length / depth | 240 characters / 24 components |

Absolute, parent/`.` traversal, backslash, NUL/control, percent-encoded, drive,
ADS and Windows device/alias paths are rejected. Names must use NFC Unicode;
duplicate/case-insensitive paths and file/directory conflicts also consider
implicit directories (`Foo/a` versus `foo/b`). Symlinks and special file modes
are rejected. Only the already validated regular file map is written with
exclusive creation, never a library's general-purpose extraction routine.

Legacy ZIP accepts either a root plugin or one direct wrapper folder, never
multiple plugin roots or files outside that wrapper. It retains lifecycle,
compatibility, dependency, path, link and quota checks, but has no publisher
identity or SHA-256 manifest guarantee. ZIPs including `node_modules` should be
repacked using the documented dependency policy.

The npm API accepts public registry package names with optional versions/tags.
Metadata and tarball downloads are bounded, HTTPS-only to `registry.npmjs.org`,
no redirects; tarballs require matching SHA-512/SHA-256 integrity or legacy
SHA-1 metadata. TAR links and special entries are forbidden and extraction uses
the same regular-file map. npm integrity is also not a signature. The installer
never invokes npm, an install script, shell package commands or a plugin entry.

## Backend integration API

`src/services/lpp-package.ts` exports:

```ts
validateLpp(buffer: Buffer): Promise<ValidatedPackage & { metadata: LppMetadata }>
validateZip(buffer: Buffer): Promise<ValidatedPackage>
packPluginDirectory(root: string): Promise<Buffer>
// ValidatedPackage = { manifest: PluginManifest; metadata?: LppMetadata;
//                      files: Map<string, Buffer> }
```

`src/services/plugin-installer.ts` exports:

```ts
type PluginInstallSource =
  | { kind: 'lpp' | 'zip'; buffer: Buffer }
  | { kind: 'npm'; spec: string };
interface PreparedPluginInstall {
  manifest: PluginManifest;
  commit(manager: PluginManager, options?: { installationId?: string }): Promise<PluginInstallResult>;
  cleanup(): Promise<void>;
}
preparePluginInstall(source: PluginInstallSource): Promise<PreparedPluginInstall>
inspectPluginArchive(buffer: Buffer, format: 'lpp' | 'zip'): Promise<{ manifest: PluginManifest }>
installFromLpp(manager: PluginManager, buffer: Buffer): Promise<PluginInstallResult>
installFromZip(manager: PluginManager, buffer: Buffer): Promise<PluginInstallResult>
installFromNpm(manager: PluginManager, spec: string): Promise<PluginInstallResult>
// PluginInstallResult = { id: string; name: string; version: string }
// INSTALL_MARKER = '.linearpress-install.json'
```

`validateLpp` validates container, metadata, compatibility and dependencies in
memory. `preparePluginInstall` additionally creates private staging under
`src/.plugin-install-staging`, validates callable lifecycle exports statically,
and returns a manifest copy. It does **not** write deployed plugin files or DB
records. `inspectPluginArchive` prepares and cleans up before returning metadata.

The managed job owner must serialize installation, check candidate IDs, write
its durable job with an installation UUID, then call
`prepared.commit(manager, { installationId: job.id })` and finally `cleanup()`.
Commit rejects existing IDs in either DB or filesystem (case insensitive),
writes `{ "installationId": "<UUID>" }` to the reserved marker in staging, then
atomically renames that stage to `src/plugins/<id>` on the same filesystem. A DB
registration exception removes only the destination this commit deployed;
preexisting directories are not removed. No copy directly into a discoverable
partial plugin and no automatic restart occurs here. Old install APIs are
prepare/commit/cleanup wrappers without a marker.

The job owner handles the rename/DB crash window and recovery using its durable
journal and matching ownership marker; do not infer ownership from the ID alone.
It verifies activation after restart and removes the marker after success.
This module does not own jobs, restart, activation success, DB schema rollback,
power-loss durability guarantees, or cleanup of abandoned crash-time stages.
Staging lives outside plugin discovery. Local server filesystem writers are
trusted; managed job serialization is required and is not a distributed lock
against unrelated processes modifying the same plugin directories.

## Regression

From the isolated workspace root (private dependencies via `.pi/lpp/test-utils.mjs`):

```sh
node Base/node_modules/tsx/dist/cli.mjs .pi/lpp/package-regression.mts
node Base/node_modules/typescript/bin/tsc --noEmit -p Base/tsconfig.json
```

The test uses a disposable runtime, real SQLite registration and the actual CLI
for all 14 plugins. It covers normal/staged installs, DB failure cleanup,
existing-ID rejection, marker ownership, exclusions, compatibility, integrity,
path/link/duplicate/quota attacks and npm compatibility with a mocked registry.
It asserts that neither a top-level plugin sentinel nor an npm install-script
sentinel executes. These tests do not claim activation, a live registry request,
native dependency portability or restart/recovery orchestration coverage.
