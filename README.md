# LinearPress

[![npm](https://img.shields.io/npm/v/linearpress.svg)](https://www.npmjs.com/package/@evarentha/linearpress) [![LinearPress](https://img.shields.io/badge/LinearPress-core-7C3AED.svg)](https://www.npmjs.com/package/@evarentha/linearpress) [![Node.js](https://img.shields.io/badge/node-%3E%3D22-green.svg)](https://nodejs.org) [![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://www.typescriptlang.org) [![License: GPL-3.0-or-later](https://img.shields.io/badge/License-GPL--3.0--or--later-blue.svg)](LICENSE)

**English** | [简体中文](README.zh-CN.md)

LinearPress is a server-rendered blogging system where everything beyond the core is a plugin. The kernel, Cordis for plugin lifecycle and Express 5 for HTTP, provides posts, comments, users, permission groups, site configuration and plugin scheduling. The visual editor, media library, themes, authentication and even the database driver ship as plugins you install, disable or remove without touching core code (a minimal built-in block editor serves as the fallback).

You need Node.js 22 or newer (24 recommended: the project uses the built-in `node:sqlite`, so there is nothing to compile).

## Quick start

```bash
git clone https://github.com/Evarentha/linearpress.git LinearPress
cd LinearPress
npm install
npm run db:init
npm run dev          # http://localhost:3000
```

The first visit opens `/oobe`: create the super administrator (a site has exactly one, enforced at the database level), fill in the site name, done. `npm run seed` writes a few sample posts afterwards and never creates accounts. Production runs `npm start`.

```bash
npm run typecheck    # tsc --noEmit over the whole project
npm test             # end-to-end smoke: OOBE, login, publish, permalink
npm run sync         # copy sibling plugin checkouts into src/plugins/
```

## How it works

```
Cordis Context / Fiber / Effect        plugin lifecycle and cleanup
        |
LinearPress services + web adapter    hooks, route collector, admin registry
        |
Express 5 / EJS / Session / static    HTTP, server rendering, assets
```

At startup the app discovers plugins, lets driver plugins swap the database and session store (`preboot`), registers core services, lets drivers replace business services (`bootstrap`), then activates the rest and mounts routes in reverse registration order, which is what lets a plugin safely override a core route.

A plugin can extend the system four ways without forking:

- register the same route later and take it over, since routes mount in reverse order
- ship a `views/` directory whose templates outrank core templates by load order
- hook the payload bus (`post:beforeSave`, `site:locals`, and the rest) to rewrite objects before and after business actions
- replace an entire service in the `bootstrap` phase, which is how the MySQL driver swaps every data layer

Security posture: non-GET requests are checked against Origin/Referer with same-origin enforced even in auto-detect domain mode (the setting where the site accepts any host name), sessions are SameSite=Lax and regenerated on login, passwords hash with bcrypt at cost 12, and the single super administrator is enforced by a partial unique index, not just by the UI.

## Plugins

Every plugin below is its own repository in this workspace:

| Repository | What it adds |
| --- | --- |
| linearpress-modern-editor | visual block editor, drafts, scheduled publishing |
| linearpress-shuoshuo | microblog-style short posts on the home list |
| linearpress-advanced-posts-list | filters, bulk actions, quick edit, categories and tags |
| linearpress-custom-pages | custom-routed pages and static HTML hosting |
| linearpress-import-from-wordpress | WXR import of posts, media, users, comments |
| linearpress-advanced-user-management | login rate limiting, email activation, account deletion |
| linearpress-easy-2fa | TOTP two-factor auth with recovery codes and passkeys |
| linearpress-easy-captcha | PNG text captcha or Cloudflare Turnstile |
| linearpress-oidc-sso | OIDC/OAuth2 single sign-on |
| linearpress-colorful-profiles | avatars, nicknames, per-user profile pages |
| linearpress-advanced-comments | Markdown comments, rate limiting, emoji panel |
| linearpress-media-library | media library wired into both editors |
| linearpress-theme-fluent | Fluent 2 theme for the whole site, light and dark |
| linearpress-mysql-plugin | MySQL driver with one-shot migration |

To install one, run `sh scripts/sync-plugins.sh <plugin-id>` from this repository (it picks up sibling checkouts), or clone the plugin into `src/plugins/<plugin-id>`, or upload its ZIP or npm name from the admin Plugins page. The directory name must equal the plugin id. Restart after installing: views and routes are collected at startup. Dragging entries on the Plugins page changes load order, which decides who wins when two plugins override the same view: the later-loaded plugin wins.

## Writing a plugin

A plugin is a Cordis plugin function:

```ts
import type { Context } from 'cordis';

export default function myPlugin(ctx: Context) {
  const { web, hooks } = ctx.linearpress;

  web.register('get', '/my-plugin', (_req, res) => res.send('ok'));
  hooks.on('post:afterSave', (post) => post);
  ctx.effect(() => {
    const timer = setInterval(work, 30_000);
    return () => clearInterval(timer);
  });
}
```

The manifest (`plugin.json`) declares the id (equal to the directory name), type (`backend` / `frontend` / `both` / `theme` / `driver`), views, public assets and permissions. Regular plugins export the function above; database drivers export `preboot` / `bootstrap` / `activate` phases instead. Through `ctx` you reach the services (`auth`, `users`, `posts`, `comments`, `groups`, `permissions`, `plugins`, `config`, `databaseService`) and the admin extensions (`ctx.admin.registerMenu` / `registerPanel` / `registerCustomSetting`). Content blocks can be injected server-side with `registerBlock()` and in the browser with `window.LinearPressEditor.registerBlock()`.

The details live in `docs/`: [architecture.md](docs/architecture.md) for the startup sequence, [plugin-development.md](docs/plugin-development.md) for entries and the manifest, [api-reference.md](docs/api-reference.md) for services and replacement conventions, [hook-reference.md](docs/hook-reference.md) for the full hook catalog, and [cordis-migration.md](docs/cordis-migration.md) for the migration history.

## Configuration

Three environment variables (see `.env.example`), plus one for reverse proxies:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `SESSION_SECRET` | generated and persisted | session signing key; set it explicitly in production |
| `DB_PATH` | `data/blog.db` | SQLite location |
| `TRUST_PROXY` | unset | set to `1` behind a proxy to honor `X-Real-IP` / `X-Forwarded-For` |

Site settings, including the permalink format among the seven available, domains, date formats and the footer, are edited from the admin console and most take effect without a restart.

## License

GPL-3.0-or-later, Copyright (C) 2026 Evarentha. See [LICENSE](LICENSE).
