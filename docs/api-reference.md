<!--
  Author: MoyuZJ
  Team: LinearTeam
  Contact: linearteam@foxmail.com
  Made by MoyuZJ in China with ♥
-->

# Service Container Reference

LinearPress 插件不需要等待核心添加专用 CRUD API。核心业务被注册为可替换服务，插件通过 `container.resolve`、`replace` 和 `decorate` 直接注入实现。

## Container

```ts
container.resolve(TOKENS.posts)
container.replace(TOKENS.posts, customPostService)
container.decorate(TOKENS.auth, original => ({
  ...original,
  authenticate: async (username, password) => {
    const user = await original.authenticate(username, password);
    if (user) await verifySecondFactor(user);
    return user;
  }
}))
```

- `register(token, service)`：首次注册，重复时抛错。
- `provide(token, service)`：仅在 token 尚未注册时写入。
- `replace(token, service)`：完全替换并返回旧实现。
- `decorate(token, decorator)`：用旧服务构造新服务；后加载装饰器包在外层。
- `resolve(token)`：读取当前实现。核心控制器在请求时动态调用它。
- `remove(token)`：移除服务。

插件可以用 `createToken<T>('plugin-name:service')` 注册自己的类型化服务。

## Core Tokens

```ts
TOKENS.database
TOKENS.databaseService
TOKENS.sessionStoreFactory
TOKENS.auth
TOKENS.users
TOKENS.posts
TOKENS.comments
TOKENS.groups
TOKENS.permissions
TOKENS.plugins
TOKENS.config
```

接口定义位于 `src/types/services.ts`。所有方法允许同步值或 Promise，因此默认 SQLite 服务和异步 MySQL 服务都能实现相同契约。

## Database Injection

`TOKENS.database` 是底层数据库对象，`TOKENS.databaseService` 是查询服务：

```ts
const database = container.resolve(TOKENS.databaseService);
const users = await database.all('SELECT * FROM users');
await database.transaction(async () => {
  await database.run('UPDATE ...');
});
```

数据库驱动插件应在 `preboot` 替换数据库和 Session 工厂，在 `bootstrap` 替换依赖数据库方言的业务服务：

```ts
export const preboot = ({ container }) => {
  container.replace(TOKENS.database, mysqlConnectionAdapter);
  container.replace(TOKENS.sessionStoreFactory, createMysqlSessionStore);
};

export const bootstrap = ({ container }) => {
  container.replace(TOKENS.databaseService, mysqlDatabaseService);
  container.replace(TOKENS.auth, mysqlAuthService);
  container.replace(TOKENS.users, mysqlUserService);
  container.replace(TOKENS.posts, mysqlPostService);
  container.replace(TOKENS.comments, mysqlCommentService);
  container.replace(TOKENS.groups, mysqlGroupService);
  container.replace(TOKENS.permissions, mysqlPermissionService);
};
```

LinearPress 仍保留本地 SQLite 基础设施库用于插件启停和加载顺序；内容、用户和 Session 可以由驱动插件接管。

## Common Injection Patterns

```ts
// 2FA / OIDC
container.decorate(TOKENS.auth, auth => customAuth(auth));

// 高级文章列表
container.decorate(TOKENS.posts, posts => advancedPosts(posts));

// 高级评论
container.replace(TOKENS.comments, threadedCommentService);

// 权限管理
container.decorate(TOKENS.permissions, permissions => extendedPermissions(permissions));
```

## Permission Registration

Manifest 可以声明权限：

```json
{ "permissions": ["media:upload", "media:delete"] }
```

插件管理器会在 `bootstrap` 前注册这些权限。也可以直接调用：

```ts
await container.resolve(TOKENS.permissions).register('media:upload', '上传媒体');
```

## Block Injection

服务端：

```ts
registerBlock('callout', block => `<aside>${String(block.content)}</aside>`);
```

编辑器端：

```js
window.LinearPressEditor?.registerBlock('callout', {
  label: '提示框',
  description: '强调内容',
  fields: [{ key: 'content', control: 'textarea', default: '' }]
});
```
