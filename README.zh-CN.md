# LinearPress

[![npm](https://img.shields.io/npm/v/linearpress.svg)](https://www.npmjs.com/package/@evarentha/linearpress) [![LinearPress](https://img.shields.io/badge/LinearPress-core-7C3AED.svg)](https://www.npmjs.com/package/@evarentha/linearpress) [![Node.js](https://img.shields.io/badge/node-%3E%3D22-green.svg)](https://nodejs.org) [![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://www.typescriptlang.org) [![License: GPL-3.0-or-later](https://img.shields.io/badge/License-GPL--3.0--or--later-blue.svg)](LICENSE)

[English](README.md) | **简体中文**

LinearPress 是一个服务端渲染的博客系统，核心之外的一切均以插件形式存在。内核仅负责六项事务：文章、评论、用户、权限组、站点配置与插件调度，插件生命周期交由 Cordis 管理，HTTP 交由 Express 5 处理。可视化编辑器、媒体库、主题、认证乃至数据库驱动均以插件形式分发，可按需安装、停用或卸载，全程不修改核心代码（基础程序内置一个极简块编辑器作为兜底）。

环境要求 Node.js 22 或更高版本（推荐 24：项目使用内置的 `node:sqlite`，无须编译任何原生模块）。

## 快速开始

```bash
git clone https://github.com/Evarentha/linearpress.git LinearPress
cd LinearPress
npm install
npm run db:init
npm run dev          # http://localhost:3000
```

首次访问将进入 `/oobe`：创建超级管理员（全站唯一，由数据库层强制），填写站点名称，完成初始化。此后 `npm run seed` 可写入若干示例文章，该命令不会创建任何账号。生产环境使用 `npm start`。

```bash
npm run typecheck    # 全量 TypeScript 检查
npm test             # 端到端冒烟:OOBE、登录、发文、固定链接
npm run sync         # 将旁边的插件检出同步至 src/plugins/
```

## 运行原理

```
Cordis Context / Fiber / Effect        插件生命周期与资源回收
        |
LinearPress 服务层 + Web 适配器         Hook 总线、路由收集器、后台扩展注册表
        |
Express 5 / EJS / Session / 静态资源    HTTP、服务端渲染、资产
```

启动时先发现插件，允许驱动插件在 `preboot` 阶段替换数据库与会话存储；注册核心服务后，允许驱动在 `bootstrap` 阶段替换业务服务；最后激活其余插件并按注册的倒序挂载路由。倒序挂载即插件能够安全覆盖核心路由的原因。

不修改核心代码的四条扩展路径：

- 晚于核心注册同一路由即可接管，因为路由按倒序挂载
- 提供自有 `views/` 目录，同名模板按加载顺序优先于核心模板
- 挂载 Hook 总线（`post:beforeSave`、`site:locals` 等），在业务动作前后改写对象
- 在 `bootstrap` 阶段整体替换某一服务，MySQL 驱动更换整个数据层即采用此方式

安全基线：非 GET 请求执行 Origin/Referer 校验，自动配置域名模式下同样强制同源；会话 SameSite=Lax，登录时重建；密码使用 bcrypt（cost 12）；全站唯一的超级管理员由数据库部分唯一索引保证，而非仅依赖界面约束。

## 插件

以下每个插件均为本工作区内的独立仓库：

| 仓库 | 提供的功能 |
| --- | --- |
| linearpress-modern-editor | 可视化块编辑器、草稿、定时发布 |
| linearpress-shuoshuo | 首页时间线上的说说短内容 |
| linearpress-advanced-posts-list | 筛选、批量操作、快捷编辑、分类标签 |
| linearpress-custom-pages | 自定义路由页面、静态 HTML 托管 |
| linearpress-import-from-wordpress | WXR 导入文章、媒体、用户、评论 |
| linearpress-advanced-user-management | 登录限流、邮箱激活、账号注销 |
| linearpress-easy-2fa | TOTP 两步验证、还原码、通行密钥 |
| linearpress-easy-captcha | PNG 文字验证码或 Cloudflare Turnstile |
| linearpress-oidc-sso | OIDC/OAuth2 单点登录 |
| linearpress-colorful-profiles | 头像、昵称、资料页 |
| linearpress-advanced-comments | Markdown 评论、限频、表情面板 |
| linearpress-media-library | 接入两个编辑器的媒体库 |
| linearpress-theme-fluent | Fluent 2 全站主题，亮暗双模式 |
| linearpress-mysql-plugin | MySQL 驱动，一键迁移 |

安装方式：在本仓库执行 `sh scripts/sync-plugins.sh <plugin-id>`（自动发现旁边的检出），或将插件克隆至 `src/plugins/<plugin-id>`，或在后台插件页上传 ZIP、填写 npm 包名。目录名必须与插件 id 一致。安装后需重启：视图与路由均在启动时收集；插件页内拖动条目即调整加载顺序，两个插件覆盖同一视图时，后加载者生效。

## 开发插件

插件即一个 Cordis 插件函数：

```ts
import type { Context } from 'cordis';

export default function myPlugin(ctx: Context) {
  const { web, hooks } = ctx.linearpress;

  web.register('get', '/my-plugin', (_req, res) => res.send('ok'));
  hooks.on('post:afterSave', (post) => post);
  ctx.effect(() => {
    const timer = setInterval(work, 30_000);
    return () => clearInterval(timer);
  });
}
```

manifest（`plugin.json`）声明 id（必须与目录名一致）、type（`backend` / `frontend` / `both` / `theme` / `driver`）、views、public 资产与权限。常规插件导出上述函数；数据库驱动改为导出 `preboot` / `bootstrap` / `activate` 三个阶段。服务从 `ctx` 获取（`auth`、`users`、`posts`、`comments`、`groups`、`permissions`、`plugins`、`config`、`databaseService`）；后台扩展使用 `ctx.admin.registerMenu` / `registerPanel` / `registerCustomSetting`。内容区块服务端经 `registerBlock()` 注入，浏览器端经 `window.LinearPressEditor.registerBlock()` 注入。

细节文档位于 `docs/`：启动顺序参阅 [architecture.md](docs/architecture.md)，入口与 manifest 参阅 [plugin-development.md](docs/plugin-development.md)，服务与替换约定参阅 [api-reference.md](docs/api-reference.md)，Hook 全目录参阅 [hook-reference.md](docs/hook-reference.md)，迁移记录参阅 [cordis-migration.md](docs/cordis-migration.md)。

## 配置

三个环境变量（参见 `.env.example`），外加一项供反向代理使用：

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `PORT` | `3000` | HTTP 端口 |
| `SESSION_SECRET` | 自动生成并落盘 | 会话签名密钥，生产环境请显式设置 |
| `DB_PATH` | `data/blog.db` | SQLite 位置 |
| `TRUST_PROXY` | 未设置 | 位于代理后时设为 `1`，信任 `X-Real-IP` / `X-Forwarded-For` |

站点设置（七种固定链接格式、域名、日期格式、页脚等）均在后台修改，大部分无须重启即生效。

## 许可证

本项目以 GPL-3.0-or-later 许可发布，Copyright (C) 2026 Evarentha，完整文本见 [LICENSE](LICENSE)。
