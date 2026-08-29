<!--
  Author: MoyuZJ
  Team: LinearTeam
  Contact: linearteam@foxmail.com
  Made by MoyuZJ in China with ♥
-->

# LinearPress

**TypeScript、Express 5、EJS 与 SQLite 驱动的服务端渲染博客系统**——以「一切皆插件」为设计理念，
内核由 **Cordis**（插件运行时）与 **Express**（Web 层）组成：核心只做少量通用能力，
其余功能（编辑器、媒体库、主题、评论增强、认证、数据库驱动……）全部以插件形式外置，
**即插即用、可停用可卸载、与核心零耦合**。

## 功能

- **控制台三栏布局**：左侧功能导航、中间选项卡（页面选项/设置/关于）、右侧详情面板；插件可通过 `ctx.admin` 注册二级菜单、注入面板 HTML 与自定义配置入口。
- **站点设置**：站点信息、日期与时间格式、多域名绑定与重定向、SEO 友好的 Permalink 路由格式、页脚声明（版权预设/ICP 备案/自定义 HTML）。
- **插件管理**：npm 包（支持 `@scope/name`）与 ZIP 上传安装（含批量模式），插件卡片展示图标/版本并提供 CustomSetting、设置、停用、删除；修改顺序即调整加载优先级。
- **维护模式**：插件安装/更新、致命错误或手动开启时进入，渲染即时生成的静态维护页；管理员仍可通过 `/login` 与 `/admin` 访问后台；致命错误 dump 到 `.logs`。
- **OOBE 向导**：欢迎页 → 创建管理员账户 → 设置站点信息 → 配置完成，四步初始化流程。

## 为什么插件化？

- **核心小而稳**：核心只提供文章/评论/用户/权限/配置与插件调度；复杂功能全部外置。核心升级不破坏插件，插件互不牵动。
- **即插即用、卸载干净**：插件目录放入 `src/plugins/`、ZIP 上传或 `npm i` 即可安装；停用/卸载时 Cordis Fiber 自动回收路由、Hook、Effect（定时器/连接）与注册的 Service，无残留。
- **深度定制不 fork**：
  - **视图覆盖**——插件的 `views` 目录同名覆盖核心模板（布局/首页/文章页/后台页），优先级由 `load_order` 排序；
  - **Hook 事件总线**——`post:beforeSave`、`site:locals` 等业务前后修改对象，改文章/换页面外壳都不需要动核心；
  - **区块注入**——`registerBlock` 服务端渲染 + `LinearPressEditor.registerBlock` 编辑器字段注入；
  - **服务替换**——`bootstrap` 阶段可用 `replaceService` 整体替换 `posts`/`auth`/`databaseService`（如 MySQL 驱动）。
- **独立演进、独立分发**：每个插件是独立 git 仓库，可单独发布到 GitHub / npm，任何站点按需安装。

## 快速开始

前置：**Node.js ≥ 22**（推荐 24，本项目使用 Node 24 内置的 `node:sqlite`，无需编译原生模块）。

```bash
# 1. 克隆
git clone <本仓库> LinearPress
cd LinearPress

# 2. 安装依赖
npm install

# 3. 初始化数据库（首次）并启动
npm run db:init
npm run dev          # → http://localhost:3000
```

首次访问会自动进入 `/oobe`：创建全站唯一的超级管理员 → 设置站点信息 → 完成。
完成后执行 `npm run seed` 可写入示例文章（该命令不会创建账号）。

生产运行：`npm start`。Session 持久化在 `data/blog.db`（Node 24 内建 SQLite）。

## 接入插件（怎么拉 / 怎么装）

三种方式任选：

```bash
# 方式一：工作区同步（本仓库 Plugins/ 下的插件）
sh scripts/sync-plugins.sh <plugin-id>       # 单个，如 shuoshuo
sh scripts/sync-plugins.sh                    # 全部

# 方式二：把仓库克隆/复制到运行目录（目录名必须等于插件 id）
git clone <plugin-repo> src/plugins/<plugin-id>

# 方式三：后台「插件」页 —— 上传 ZIP 或 输入 npm 包名安装
```

安装后重启进程生效（视图与路由在启动时收集）。停用/卸载记录在基础设施数据库，
卸载会删除插件目录并清理由 Cordis Fiber 持有的资源。

## 开发插件

插件入口是 Cordis 插件函数，通过 Context 取服务、注册事件、清理资源：

```ts
import type { Context } from 'cordis';

export default function myPlugin(ctx: Context) {
  const { web, hooks } = ctx.linearpress;

  web.register('get', '/my-plugin', (_req, res) => res.send('ok'));   // 路由
  hooks.on('post:afterSave', (post) => post);                          // Hook
  ctx.effect(() => {                                                   // 资源
    const timer = setInterval(work, 30_000);
    return () => clearInterval(timer);
  });
}
```

- **入口**：普通插件 `export default`；数据库驱动插件用 `preboot` / `bootstrap` / `activate` 分阶段运行（`preboot` 需在 plugin.json 声明 `preboot: true`）。
- **Manifest**：`plugin.json` 声明 `id/name/version/type/main/runtime/views/public/styles/scripts/permissions`；`id` 必须与目录名一致；`type` 为 `backend|frontend|both|theme|driver`。
- **Context 服务**：`ctx.databaseService / auth / users / posts / comments / groups / permissions / plugins / config` 与 `ctx.linearpress.web|hooks|db|admin`。
- **后台扩展**：`ctx.admin.registerMenu / registerPanel / registerCustomSetting`。
- **权限**：manifest `permissions` 声明 + `checkPermission('xxx')` 守卫。

详细文档（`docs/` 目录）：

| 文档 | 内容 |
| --- | --- |
| [architecture.md](docs/architecture.md) | 启动顺序与 Cordis + Express 边界 |
| [plugin-development.md](docs/plugin-development.md) | 插件入口、Web 适配器、Manifest |
| [api-reference.md](docs/api-reference.md) | Context 服务与替换约定 |
| [hook-reference.md](docs/hook-reference.md) | Hook 与 Cordis 事件映射 |
| [cordis-migration.md](docs/cordis-migration.md) | 迁移记录与剩余说明 |

## 测试与检查

```bash
npm run typecheck    # TS 全量检查
npm test             # smoke test
```

> smoke test 默认假定只加载仓库内置插件；若工作区额外放置了插件，插件资源会被自动发现，测试中的资源断言需要相应调整。

## 发布到 GitHub / npm

- **提交规范**：conventional commits（`feat:` / `fix:` / `docs:` / `refactor:` …）。
- **验证**：提交前跑 `npm run typecheck && npm test`。
- **版本**：`git tag v1.0.0 && git push --tags`。
- **发 npm（可选）**：确认 `package.json` 的 `main`/`exports` 指向编译产物后 `npm publish`；插件目录结构与运行依赖需自包含（本仓库以 tsx 直接运行 TypeScript，分发版如需免构建可参考各插件的打包说明）。

## 目录结构

```text
base/
├── index.ts               # 入口：start()
├── scripts/               # run / init-db / seed / smoke / sync-plugins
├── src/
│   ├── core/              # 内核：app / plugin-manager / cordis-runtime / hook-system / context …
│   ├── controllers/       # 核心路由
│   ├── services/          # 业务层（posts / comments / users / groups / config / installer）
│   ├── types/             # 稳定业务契约（services.ts / hooks.ts / plugin.ts / index.ts）
│   ├── views/             # 核心 EJS 模板（layouts / web / admin / auth / error）
│   ├── public/            # 核心静态资源（css / js）
│   └── plugins/           # 运行时的插件目录（由 sync / 安装器写入）
├── docs/                  # 架构与插件开发文档
├── config/                # 默认配置
├── data/                  # 运行时数据（数据库 / session / 上传）
└── uploads/               # 媒体与头像
```

## License

MIT，见仓库根目录 LICENSE 文件。