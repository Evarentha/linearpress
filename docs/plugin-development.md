<!--
  Author: MoyuZJ
  Team: LinearTeam
  Contact: linearteam@foxmail.com
  Made by MoyuZJ in China with ♥
-->

# LinearPress Plugin Development

## Runtime Model

LinearPress 使用 Cordis 作为插件内核，使用 Express 作为 Web 层。插件是一个 Cordis 插件函数，通过 Cordis Context 获取服务、注册事件和清理资源。

```text
Cordis Context / Fiber / Event / Effect
                |
        LinearPress services + Express web adapter
                |
        Express / Router / Session / EJS / static files
```

## Plugin Entry

普通插件导出默认函数：

```ts
import type { Context } from 'cordis';

export default function myPlugin(ctx: Context) {
  const { web, db, hooks } = ctx.linearpress;

  web.register('get', '/my-plugin', (req, res) => res.send('ok'));
  hooks.on('post:afterSave', (post) => post);
  ctx.effect(() => {
    const timer = setInterval(work, 30_000);
    return () => clearInterval(timer);
  });
}
```

数据库驱动插件使用命名导出，分阶段运行：

```ts
export const preboot = async (ctx: Context) => { /* 替换 database / sessionStoreFactory */ };
export const bootstrap = async (ctx: Context) => { /* 替换业务服务 */ };
export const activate = (ctx: Context) => { /* 注册后台路由 */ };
```

- `preboot`：仅对 Manifest 中 `preboot: true` 的插件执行，在核心业务服务注册前运行。
- `bootstrap`：核心默认服务注册后运行，用于替换业务服务。
- `activate`：核心路由收集后运行，用于注册路由、视图、资源和事件。
- 普通插件使用 `export default`（等价于 `activate`）。

## Manifest

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "type": "both",
  "main": "index.ts",
  "runtime": "cordis",
  "preboot": false,
  "permissions": ["my-plugin:manage"],
  "views": "views",
  "public": "public",
  "styles": ["theme.css"],
  "scripts": ["widget.js"]
}
```

`id` 必须与插件目录名一致。静态资源挂载在 `/plugins/<id>/`，CSS/JS 自动注入前台和后台布局。`views` 和 `public` 会按相对插件目录解析。

## Cordis Context Services

插件通过 `ctx` 直接访问业务服务：

```ts
ctx.database        // 底层数据库对象
ctx.databaseService // 查询服务（all/get/run/exec/transaction）
ctx.sessionStoreFactory
ctx.auth
ctx.users
ctx.posts
ctx.comments
ctx.groups
ctx.permissions
ctx.plugins
ctx.config
```

Web 和事件服务：

```ts
ctx.linearpress.web    // { register, middleware, viewDir, staticDir }
ctx.linearpress.db     // 基础设施 SQLite
ctx.linearpress.hooks  // LinearPress 事件总线
```

等价简写：

```ts
ctx.web
ctx.db
ctx.hooks
```

## Service Replacement

数据库驱动使用 `replaceService` 替换核心服务：

```ts
import { replaceService } from '../../core/context.js';

replaceService(ctx, 'posts', customPostService);
replaceService(ctx, 'auth', customAuthService);
```

核心控制器在请求时从 Cordis Context 解析服务，因此替换在 `bootstrap` 阶段生效。

## Effects

所有定时器、连接、文件监听和外部资源都应登记 Effect：

```ts
ctx.effect(() => {
  const pool = createPool(config);
  return () => pool.end();
});
```

插件 Fiber 销毁时反向执行 disposer。不需要再维护手动的 `deactivate`。

## Web Boundary

Cordis 不提供 Express 的 `Request`、`Response`、Router 或 EJS。需要 HTTP 的插件通过 `ctx.web.register` 注册路由，通过 Manifest 的 `views`/`public` 提供模板和静态资源。不要把请求对象保存到全局状态。

## Trusted Code

插件是完全可信代码，没有沙箱。插件可以访问容器、Express、事件、底层数据库和文件系统。安装器会校验 Manifest、入口路径和压缩包路径，但不会隔离插件代码。

## Disable And Uninstall

启停状态和安装记录由 LinearPress Plugin Registry 保存。停用、安装和卸载后默认重启进程，因为 Express 已挂载的路由不能安全地从 App 中删除。Fiber 销毁会自动清理 Effect、事件和 Cordis 服务。
