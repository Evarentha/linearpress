# LinearPress

LinearPress 是一个 TypeScript、Express 5、EJS 和 SQLite 驱动的服务端渲染博客系统。

## 开发

```bash
npm install
npm run db:init
npm run dev
```

默认地址为 `http://localhost:3000`。全新数据库首次访问会自动进入 `/oobe`，必须创建全站唯一的超级管理员账号。项目不提供默认管理员用户名或密码。

完成 OOBE 后可执行 `npm run seed` 写入示例文章；该命令不会创建账号。

当前运行时使用 Node.js 24 内置的 `node:sqlite`，因此在 Windows 上不需要编译 `better-sqlite3` 原生模块。Session 也持久化在 `data/blog.db`。

## 检查

```bash
npm run typecheck
npm test
```

目录结构和插件契约见 `docs/plugin-development.md`、`docs/api-reference.md`（服务容器与注入）与 `docs/hook-reference.md`。
