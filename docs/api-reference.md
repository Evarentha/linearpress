<!--
  Author: MoyuZJ
  Team: LinearTeam
  Contact: linearteam@foxmail.com
  Made by MoyuZJ in China with ♥
-->

# Service API Reference

LinearPress 插件通过 Cordis Context 访问业务服务。Cordis 负责 Fiber、依赖作用域和资源清理；Express 负责 HTTP；LinearPress HookSystem 负责业务动作前后修改 payload 的事件总线。

## Plugin Context

```ts
export default function plugin(ctx: Context) {
  ctx.linearpress   // { web, db, hooks }
  ctx.web           // Express web adapter
  ctx.db            // infrastructure SQLite
  ctx.hooks         // LinearPress event bus
  ctx.posts         // PostService
  ctx.auth          // AuthService
  ctx.databaseService // DatabaseService
}
```

## Core Services

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

所有业务服务方法允许同步值或 Promise，因此默认 SQLite 服务和异步 MySQL 服务可以实现相同契约。

## Service Replacement

数据库驱动在 `preboot` 替换数据库和 Session 工厂，在 `bootstrap` 替换业务服务：

```ts
import { replaceService } from '../../core/context.js';

export const preboot = async (ctx) => {
  const pool = createPool(config);
  await ensureSchema(pool);
  replaceService(ctx, 'sessionStoreFactory', () => createSessionStore(pool));
  ctx.effect(() => () => pool.end());
};

export const bootstrap = (ctx) => {
  replaceService(ctx, 'databaseService', mysqlDatabaseService);
  replaceService(ctx, 'auth', mysqlAuthService);
  replaceService(ctx, 'users', mysqlUserService);
  replaceService(ctx, 'posts', mysqlPostService);
  replaceService(ctx, 'comments', mysqlCommentService);
  replaceService(ctx, 'groups', mysqlGroupService);
  replaceService(ctx, 'permissions', mysqlPermissionService);
};
```

首次提供用 `ctx.provide(name, value)`；替换已存在服务用 `replaceService(ctx, name, value)`（内部 `reflect.set`）。

## Effects

```ts
ctx.effect(() => {
  const resource = openResource();
  return () => resource.close();
});
```

## Permission Registration

Manifest 可以声明权限：

```json
{ "permissions": ["media:upload", "media:delete"] }
```

插件管理器会在 `bootstrap` 前注册这些权限。也可以直接调用：

```ts
await ctx.permissions.register('media:upload', '上传媒体');
```

## Block Injection

服务端：

```ts
import { registerBlock } from '../../core/block-registry.js';

registerBlock('callout', (block) => `<aside>${String(block.content)}</aside>`, 'my-plugin');
```

编辑器端：

```js
window.LinearPressEditor?.registerBlock('callout', {
  label: '提示框',
  description: '强调内容',
  fields: [{ key: 'content', control: 'textarea', default: '' }]
});
```
