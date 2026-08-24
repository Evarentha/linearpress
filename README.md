<!--
  Author: MoyuZJ
  Team: LinearTeam
  Contact: linearteam@foxmail.com
  Made by MoyuZJ in China with ♥
-->

# LinearPress

LinearPress 是一个 TypeScript、Express 5、EJS 和 SQLite 驱动的服务端渲染博客系统。

## 功能

- **控制台三栏布局**：左侧功能导航、中间选项卡（页面选项/设置/关于）、右侧详情面板；插件可通过 `ctx.admin` 注册二级菜单、注入面板 HTML 与自定义配置入口。
- **站点设置**：站点信息、日期与时间格式、多域名绑定与重定向、SEO 友好的 Permalink 路由格式、页脚声明（版权预设/ICP 备案/自定义 HTML）。
- **插件管理**：npm 包（支持 `@scope/name`）与 ZIP 上传安装（含批量模式），插件卡片展示图标/版本并提供 CustomSetting、设置、停用、删除。
- **维护模式**：插件安装/更新、致命错误或手动开启时进入，渲染即时生成的静态维护页；管理员仍可通过 `/login` 与 `/admin` 访问后台；致命错误 dump 到 `.logs`。
- **OOBE 向导**：欢迎页 → 创建管理员账户 → 设置站点信息 → 配置完成，四步初始化流程。

插件运行时采用 **Cordis + Express**：Cordis 是插件内核，负责 Fiber、依赖作用域、服务和资源清理；Express 继续提供 HTTP 路由、中间件、Session、EJS 和静态资源。插件入口是 Cordis 函数（`export default` 或 driver 的 `preboot`/`bootstrap`/`activate`），业务服务通过 Cordis Context 提供。

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

smoke test 默认假定只加载仓库内置插件。如果工作区额外放置了插件，插件资源会被自动发现，测试中的资源断言需要相应调整。

## 插件文档

- `docs/architecture.md`：启动顺序和 Cordis + Express 边界
- `docs/plugin-development.md`：Cordis 插件入口、Express Web 适配器和 Manifest
- `docs/api-reference.md`：Cordis Context 服务和替换约定
- `docs/hook-reference.md`：LinearPress Hook 与 Cordis 事件映射
- `docs/cordis-migration.md`：迁移结果与剩余说明
