<!--
  Cordis Migration Guide

  Notes on the completed Cordis migration.

  Authors:
  MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥

  Copyright (C) 2026 Evarentha
  SPDX-License-Identifier: GPL-3.0-or-later
-->
<!--
  Records the completed migration to Cordis-native plugins: the new
  plugin entry signatures, services provided through the Cordis
  Context, effect-based resource cleanup, the removed legacy
  PluginEntry / ActivateContext / PrebootContext / ServiceContainer /
  TOKENS APIs, and remaining notes on route mounting and restarts.
  @since 2.0.1
-->

# Cordis Migration

## Status: Complete

LinearPress 已完成 Cordis 原生化。插件入口是 Cordis 函数，核心业务服务通过 Cordis Context 提供，资源通过 Cordis Effect 清理。旧的 `PluginEntry` / `ActivateContext` / `PrebootContext` / `ServiceContainer` / `TOKENS` 已移除。

```text
Cordis: Fiber / Context / Effect（插件内核）
Express: HTTP / Router / Middleware / Session / EJS（Web 层）
LinearPress: Manifest / Installer / Plugin Registry（管理与安装）
```

## Plugin Entry

- 普通插件：`export default (ctx) => {}`
- 驱动插件：`export const preboot/bootstrap/activate = (ctx) => {}`

## Services

业务服务从 Cordis Context 读取：

```ts
ctx.posts
ctx.auth
ctx.databaseService
ctx.permissions
ctx.web
ctx.hooks
```

数据库驱动用 `replaceService(ctx, name, value)` 替换服务；首次注册用 `ctx.provide(name, value)`。

## Effects

```ts
ctx.effect(() => {
  const timer = setInterval(runTask, 30_000);
  return () => clearInterval(timer);
});
```

## Remaining Notes

- 核心控制器仍在启动时从 Context 解析服务；路由通过 `RouterCollector` 倒序挂载，后加载插件优先。
- Express 已挂载的路由不能仅靠 Fiber 销毁移除，因此插件停用/卸载默认需要重启。
- HookSystem 仍是业务动作前后修改 payload 的事件总线；Cordis 事件用于通知和生命周期。
- `scripts/native-smoke.ts` 会临时把 `./Plugins` 中的四个插件复制到运行目录并做启动验证。
