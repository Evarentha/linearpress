# LinearPress 插件开发指南

## 快速开始

插件目录位于 `src/plugins/<id>`。开发环境直接使用 `tsx` 加载 `.ts` 入口，不需要单独编译。

```text
src/plugins/my-plugin/
├── plugin.json
├── index.ts
├── views/        # 可选，视图文件名与基座相同时覆盖基座
└── public/       # 可选，静态资源由插件优先提供
```

## Manifest

`id` 必须与目录名一致；`main` 是入口文件；`type` 可选 `backend`、`frontend`、`both` 或 `theme`。`views` 和 `public` 是相对于插件目录的目录。

## 激活上下文

```ts
export const activate = async ({ db, hooks, router, viewDir, staticDir, logger }) => {
  db.exec('CREATE TABLE IF NOT EXISTS my_data (id INTEGER PRIMARY KEY)');
  router.register('get', '/admin/my-plugin', (req, res) => res.render('admin/my-plugin'));
  hooks.on('post:beforeSave', (post) => post, { priority: 10 });
  viewDir('views');
  staticDir('public');
  logger.info('ready');
};
```

插件安装代表信任。插件可以访问数据库、Express 和文件系统，系统不提供沙箱。后台插件路由必须显式使用 `checkPermission`；OOBE 只负责创建唯一超级管理员，不向插件开放第二个超级管理员创建入口。

## 优先级规则

数据库中的 `load_order` 越大，插件越晚加载。路由在所有插件激活后倒序挂载，因此后加载路由先匹配。视图与静态资源目录也按照后注册优先。

## 停用与卸载

后台停用只修改数据库中的 `enabled`。卸载会调用 `deactivate`、移除钩子、删除插件目录和注册表记录。需要清理自有数据库表的插件应在 `deactivate` 中执行迁移策略。
