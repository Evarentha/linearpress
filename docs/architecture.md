# LinearPress Architecture

## Runtime

The application runs TypeScript directly through `tsx`. On Node.js 24 the database adapter is the built-in synchronous `node:sqlite` API. This keeps the project free of native package compilation on Windows while preserving the synchronous repository API used by services and plugins.

`src/core/app.ts` owns process composition. It creates the Express app, migrations, SQLite-backed sessions, plugin manager, view paths, static paths and final route registration.

## Request flow

1. Express parses the request and restores the session from `data/blog.db`.
2. If no super administrator exists, the OOBE gate redirects all non-static requests to `/oobe`.
3. Plugins are scanned from `src/plugins/*/plugin.json`.
4. Enabled plugins activate in ascending `load_order`.
5. Core routes and plugin routes are collected before registration.
6. Collected routes are applied in reverse order, so later registrations have precedence.
7. EJS resolves plugin view directories before `src/views`.
8. Static plugin directories are mounted before `src/public`.

## Boundaries

- Controllers translate HTTP input into service calls.
- Services own validation, persistence and domain behavior.
- Models are represented by TypeScript interfaces and service-level hydration functions.
- Hooks are typed by `HookPayloadMap`; callbacks can transform a payload and priority controls execution order.
- Plugins are trusted code. They receive database and Express access and are not sandboxed.

## Persistence

The database migration is idempotent and creates users, groups, posts, comments, plugins and sessions. A partial unique index guarantees that at most one user can have `is_super_admin = 1`. Existing installations promote the oldest user in the system `admin` group during migration; clean installations must complete OOBE. Plugin registration is synchronized from manifests without overwriting an administrator's enabled state or load order.

## Extension rules

A plugin should use its own tables with `CREATE TABLE IF NOT EXISTS`, register cleanup in `deactivate`, and protect administrative routes with `checkPermission`. View and static overrides should be deliberate because the later-loaded plugin wins.
