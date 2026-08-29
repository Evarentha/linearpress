<!--
  Author: MoyuZJ
  Team: LinearTeam
  Contact: linearteam@foxmail.com
  Made by MoyuZJ in China with ♥
-->

# LinearPress

A **server-rendered blogging system** built with **TypeScript, Express 5, EJS and SQLite** — designed around "everything is a plugin". The kernel is powered by **Cordis** (plugin runtime) and **Express** (web layer): the core only provides a few generic capabilities; everything else (editor, media library, themes, comment enhancement, auth, database drivers…) lives as plugins — **install on demand, disable/uninstall cleanly, zero coupling**.

一个由 **TypeScript、Express 5、EJS 与 SQLite** 驱动的服务端渲染博客系统，以「一切皆插件」为设计理念。内核由 **Cordis**（插件运行时）与 **Express**（Web 层）组成：核心只提供少量通用能力，其余功能（编辑器、媒体库、主题、评论增强、认证、数据库驱动……）全部以插件形式外置——**即插即用、可停用可卸载、与核心零耦合**。

## Features / 功能

- **Admin console（三栏布局）** —— left navigation, center tabs, right detail panel; plugins can register sub-menus, inject panel HTML and expose custom settings via `ctx.admin`.
  **控制台三栏布局**——左侧功能导航、中间选项卡、右侧详情面板；插件可通过 `ctx.admin` 注册二级菜单、注入面板 HTML 与自定义配置入口。
- **Site settings** —— site info, date/time formats, multi-domain binding & redirect, SEO-friendly Permalink routing, footer declarations (copyright presets / ICP / custom HTML).
  **站点设置**——站点信息、日期与时间格式、多域名绑定与重定向、SEO 友好的 Permalink 路由格式、页脚声明。
- **Plugin manager** —— npm packages (incl. `@scope/name`) and ZIP upload with batch mode; cards show icon/version with CustomSetting, settings, disable, delete; reordering adjusts load priority.
  **插件管理**——npm 包与 ZIP 上传安装（含批量模式）；插件卡片提供 CustomSetting、设置、停用、删除；调整顺序即调整加载优先级。
- **Maintenance mode** —— engaged during plugin install/update, fatal errors or manually; renders an instant static page; admins can still reach `/login` and `/admin`; fatal errors dump to `.logs`.
  **维护模式**——插件安装/更新、致命错误或手动开启时进入；管理员仍可访问后台；致命错误 dump 到 `.logs`。
- **OOBE wizard** —— welcome → create super admin → site info → done, four-step initialization.
  **OOBE 向导**——欢迎页 → 创建超级管理员 → 站点信息 → 完成，四步初始化。

## Why Plugins? / 为什么插件化？

- **Small, stable core** —— core provides posts/comments/users/permissions/config and plugin orchestration only; plugins don't constrain each other, and core upgrades don't break them.
  **核心小而稳**——只提供文章/评论/用户/权限/配置与插件调度；插件互不牵动，核心升级不破坏插件。
- **Install on demand, clean uninstall** —— drop a dir into `src/plugins/`, upload ZIP or `npm i`; Cordis Fiber reclaims routes, hooks, effects (timers/connections) and services on disable/uninstall.  **即插即用、卸载干净**——放入 `src/plugins/`、ZIP 上传或 `npm i` 即可安装；停用/卸载时 Cordis Fiber 自动回收路由、Hook、Effect 与注册的服务。
- **Deep customization without forking** ——  **深度定制不 fork**：
  - **View override** —— same-named views in a plugin's `views/` dir override core templates (layouts/home/post/admin), priority by `load_order`.
    **视图覆盖**——插件 `views` 目录同名覆盖核心模板，优先级由 `load_order` 排序；
  - **Hook event bus** —— rewrite objects before/after business actions (`post:beforeSave`, `site:locals`…).
    **Hook 事件总线**——业务前后修改对象；
  - **Block injection** —— `registerBlock` server-side + `LinearPressEditor.registerBlock` editor field injection.
    **区块注入**——服务端渲染 + 编辑器字段注入；
  - **Service replacement** —— `bootstrap` phase can swap `posts`/`auth`/`databaseService` (e.g. MySQL driver).
    **服务替换**——`bootstrap` 阶段可整体替换业务服务。
- **Evolve and publish independently** —— every plugin is its own git repo, publishable to GitHub / npm; sites install what they need.
  **独立演进、独立分发**——每个插件是独立 git 仓库，可单独发布到 GitHub / npm。

## Quick Start / 快速开始

Prerequisites / 前置：**Node.js ≥ 22**（recommend 24 — this project uses the built-in `node:sqlite`, no native compilation needed / 推荐 24，使用内置 `node:sqlite`，无需编译原生模块）。

```bash
git clone <repo> LinearPress
cd LinearPress

npm install            # install dependencies
npm run db:init        # initialize the database (first run)
npm run dev            # → http://localhost:3000
```

The first visit goes through `/oobe`: create the only super admin → set site info → done. `npm run seed` writes sample posts afterwards (it never creates accounts).

首次访问会进入 `/oobe`：创建全站唯一的超级管理员 → 设置站点信息 → 完成。之后 `npm run seed` 可写入示例文章。

Production / 生产：`npm start`. Sessions persist in `data/blog.db`（Node 24 内建 SQLite）。

## Adding Plugins / 接入插件

```bash
# 1) Workspace sync（本仓库 Plugins/ 下的插件）
sh scripts/sync-plugins.sh <plugin-id>
sh scripts/sync-plugins.sh                  # all / 全部

# 2) Clone into the runtime directory（目录名必须等于插件 id）
git clone <plugin-repo> src/plugins/<plugin-id>

# 3) Admin UI — 后台「插件」页：上传 ZIP 或输入 npm 包名
```

Restart after install（视图与路由在启动时收集）。Uninstalling removes the plugin directory and frees all Cordis Fiber resources / 卸载会删除插件目录并清理资源。

## Developing Plugins / 开发插件

Plugin entry is a Cordis plugin function / 插件入口是 Cordis 插件函数：

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

- **Entry** —— `export default`; database drivers use `preboot` / `bootstrap` / `activate` stages（`preboot` needs `"preboot": true` in manifest）. **入口**——普通插件 `export default`；驱动用 `preboot/bootstrap/activate` 分阶段运行。
- **Manifest** —— `plugin.json`: `id/name/version/type/main/runtime/views/public/styles/scripts/permissions`; `id` must equal the directory name; `type` ∈ `backend|frontend|both|theme|driver`. **Manifest**——`id` 必须等于目录名。
- **Context services** —— `ctx.databaseService / auth / users / posts / comments / groups / permissions / plugins / config` and `ctx.linearpress.web|hooks|db|admin`. **Context 服务**。
- **Admin extensions** —— `ctx.admin.registerMenu / registerPanel / registerCustomSetting`. **后台扩展**。
- **Permissions** —— declare in manifest + `checkPermission('xxx')` guard. **权限**。

Docs / 详细文档（`docs/`）：

| Document / 文档 | Content / 内容 |
| --- | --- |
| [architecture.md](docs/architecture.md) | Startup sequence & Cordis + Express boundary / 启动顺序与边界 |
| [plugin-development.md](docs/plugin-development.md) | Plugin entry, Web adapter, Manifest / 插件入口与 Manifest |
| [api-reference.md](docs/api-reference.md) | Context services & replacement conventions / 服务与替换约定 |
| [hook-reference.md](docs/hook-reference.md) | Hook ↔ Cordis event mapping / Hook 映射 |
| [cordis-migration.md](docs/cordis-migration.md) | Migration notes / 迁移记录 |

## Tests / 测试与检查

```bash
npm run typecheck    # TypeScript full check / TS 全量检查
npm test             # smoke test
```

> The smoke test assumes only built-in plugins are loaded; extra workspace plugins are auto-discovered and assertions may need adjusting. / smoke test 默认假定只加载内置插件。

## Publish to GitHub / npm / 发布到 GitHub / npm

- **Commits**：conventional commits（`feat:` / `fix:` / `docs:` / `refactor:`…）。
- **Verify**：`npm run typecheck && npm test` before committing.
- **Version**：`git tag v1.0.0 && git push --tags`。
- **npm（可选）**：confirm `main`/`exports` then `npm publish`。

## Directory / 目录结构

```text
base/
├── index.ts               # entry：start()
├── scripts/               # run / init-db / seed / smoke / sync-plugins
├── src/
│   ├── core/              # kernel：app / plugin-manager / cordis-runtime / hook-system / context …
│   ├── controllers/       # core routes
│   ├── services/          # business layer（posts / comments / users / groups / config / installer）
│   ├── types/             # stable contracts（services.ts / hooks.ts / plugin.ts / index.ts）
│   ├── views/             # core EJS templates（layouts / web / admin / auth / error）
│   ├── public/            # core static assets（css / js）
│   └── plugins/           # runtime plugin dir — populated by sync / installer（gitignored, except the built-in seo / minimal-theme）
├── docs/                  # architecture & plugin development docs
├── config/                # defaults
├── data/                  # runtime data（database / session / uploads）
└── uploads/               # media & avatars
```

## License / 许可

MIT license — see / 见 LICENSE in this repository.