<!--
  LinearPress Architecture Overview

  Overview of the LinearPress runtime architecture.

  Authors:
  MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥

  Copyright (C) 2026 Evarentha
  SPDX-License-Identifier: GPL-3.0-or-later
-->
<!--
  Documents the runtime stack (Node.js, TypeScript/tsx, Express 5,
  EJS, Cordis, built-in SQLite), the split between the Cordis plugin
  kernel and the Express web layer, the startup lifecycle, service
  registration, the database boundary, routing, blocks and hooks,
  dynamic unload behavior, and the protected kernel.
  @since 2.0.1
-->

# LinearPress Architecture

## Runtime

LinearPress 使用 Node.js、TypeScript/tsx、Express 5、EJS、Cordis 和 Node 24 内置 SQLite。

Cordis 是插件内核，Express 是 Web 层。系统分为：

```text
Cordis Context / Fiber / Event / Effect
                |
        LinearPress services + Express web adapter
                |
Express app / Router / Session / EJS / static files
```

Cordis 负责插件 Fiber、依赖作用域、服务解析和资源清理；Express 负责 HTTP 请求、中间件、Session、EJS 和静态资源。插件不直接依赖 `ServiceContainer`、`TOKENS` 或旧生命周期对象。

## Startup Lifecycle

1. 创建 Express、HookSystem、RouterCollector 和 Cordis root Context。
2. 在 Context 中提供默认数据库与 Session Store factory。
3. 从文件系统发现插件。
4. 对 `preboot: true` 插件执行 `preboot`，允许替换数据库和 Session 工厂。
5. 初始化本地基础设施 SQLite，保存插件状态和默认数据。
6. 注册核心默认服务到 Cordis Context。
7. 按数据库 `load_order` 执行启用插件的 `bootstrap`，允许替换业务服务。
8. 创建 Session 中间件和 OOBE 门禁。
9. 收集核心路由。
10. 执行插件 `activate`（或 `default`），收集插件路由、视图、资源和事件。
11. 倒序挂载路由，后加载插件优先。

插件停止或进程退出时销毁对应 Cordis Fiber；Cordis 注册的 Effect、事件和 Service 会自动清理。

## Services

核心业务服务注册在 Cordis Context 中：

```ts
ctx.database
ctx.databaseService
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

`types/services.ts` 是稳定的业务契约。核心控制器在请求时从 Context 解析服务，因此 `bootstrap` 阶段的服务替换对后续请求立即生效。

## Database Boundary

本地 SQLite 基础设施数据库负责插件注册、启停和加载顺序。MySQL 等驱动在 `preboot` 替换 Session 工厂，在 `bootstrap` 替换业务服务。基础设施 SQLite 始终保留插件状态。

## Routes, Views And Assets

Express 负责路由、EJS 和静态资源。插件通过：

```ts
ctx.web.register('get', '/my-plugin', handler);
```

Manifest 的 `views` 和 `public` 自动注册；CSS/JS 自动进入前后台布局。

## Blocks And Hooks

BlockRegistry 支持服务端自定义区块渲染；浏览器 `LinearPressEditor.registerBlock` 支持编辑器字段注入。LinearPress HookSystem 提供 payload waterfall 语义，用于业务动作前后修改对象；Cordis 事件用于通知和生命周期。

## Dynamic Unload

Express 已挂载的路由不能仅靠 Fiber 销毁安全移除，因此插件启停和安装默认通过重启生效。Cordis 已负责 Effect、事件和服务的销毁；实现独立 Router Mount Manager 后才适合提供无重启动态停用。

## Protected Kernel

不可由普通插件替换的是进程入口、插件文件发现器和生命周期调度器。`preboot` 插件可以替换数据库与 Session；`bootstrap` 插件可以替换业务服务。Cordis 是生命周期内核，LinearPress Plugin Registry 负责 plugin.json、npm/ZIP 安装、启停状态和加载顺序。
