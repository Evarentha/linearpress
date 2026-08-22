<!--
  Author: MoyuZJ
  Team: LinearTeam
  Contact: linearteam@foxmail.com
  Made by MoyuZJ in China with ♥
-->

# LinearPress 插件开发指南

## 生命周期

插件可以导出三个阶段：

```ts
export const preboot = context => {};
export const bootstrap = context => {};
export const activate = context => {};
export const deactivate = context => {};
```

- `preboot`：只对 Manifest 中 `preboot: true` 的插件执行。适合数据库和 Session 驱动。已安装的 preboot 驱动总会运行，因为此时数据库中的启停状态尚不可用。
- `bootstrap`：默认服务注册后执行。适合 `container.replace/decorate`、迁移和权限注册。
- `activate`：核心路由收集后执行。适合路由、视图、静态资源、中间件和 Hook。
- `deactivate`：卸载或进程关闭时清理插件资源。

插件按 `load_order` 升序执行；后加载插件替换权更高。

## Manifest

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "type": "both",
  "main": "index.ts",
  "preboot": false,
  "permissions": ["my-plugin:manage"],
  "views": "views",
  "public": "public",
  "styles": ["theme.css"],
  "scripts": ["widget.js"]
}
```

`id` 必须与插件目录名一致。静态资源挂载在 `/plugins/<id>/`，CSS/JS 自动注入前台和后台布局。

## Context

```ts
export const bootstrap = ({ container, hooks, db, logger }) => {
  const original = container.resolve(TOKENS.posts);
  container.decorate(TOKENS.posts, posts => ({
    ...posts,
    save: async input => posts.save({ ...input, title: input.title.trim() })
  }));
};

export const activate = ({ router, middleware, registerBlock, viewDir }) => {
  router.register('get', '/my-plugin', handler);
  middleware(customMiddleware);
  registerBlock('custom', renderer);
  viewDir('views');
};
```

完整 token 与注入方式见 `api-reference.md`，事件扩展见 `hook-reference.md`。

## Replace Or Decorate

完全接管功能时使用 `replace`；增强原功能时使用 `decorate`。不要 monkey patch ESM 导出或 Express 私有字段，因为核心可能已经持有旧引用。

核心控制器在每个请求中从容器重新解析服务，因此 `bootstrap` 和 `activate` 中的替换都能生效。

## Routes And Views

核心与插件路由统一延迟注册。后加载插件注册的同路径路由先匹配。插件视图目录后注册优先，因此同名 EJS 可以覆盖核心视图。

## Trusted Code

插件是完全可信代码，没有沙箱。插件可以访问容器、Express、Hook、底层数据库和文件系统。唯一超级管理员数据库约束仍不可绕过。

## Disable And Uninstall

停用和排序在重启后完整生效。卸载会调用 `deactivate`、清理 Hook 和服务端区块渲染器、删除目录和注册记录。Express 已挂载的中间件不能安全移除，因此卸载后应重启进程。
