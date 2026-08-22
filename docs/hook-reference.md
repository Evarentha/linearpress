<!--
  Author: MoyuZJ
  Team: LinearTeam
  Contact: linearteam@foxmail.com
  Made by MoyuZJ in China with ♥
-->

# Hook Reference

通过 `hooks.on(name, callback, { priority })` 注册。数字越小越先执行。回调返回的新 payload 会传给下一个处理器；抛出异常可阻止当前业务操作。

## Authentication And Users

| Hook | Payload | Timing |
| --- | --- | --- |
| `auth:beforeLogin` | `{ username, password }` | 校验密码前 |
| `auth:afterLogin` | `User` | 登录成功后 |
| `auth:beforeLogout` | `{ userId? }` | 销毁 Session 前 |
| `user:beforeCreate` | `UserDraft` | 创建普通用户或超级管理员前 |
| `user:afterCreate` | `User` | 用户写入数据库后 |
| `user:beforeAssignGroup` | `{ user, group }` | 修改权限组前 |
| `user:afterAssignGroup` | `{ user, group }` | 修改权限组后 |

## Posts

| Hook | Payload | Timing |
| --- | --- | --- |
| `post:beforeSave` | `Post` | 生成缓存和写库前 |
| `post:afterSave` | `Post` | 写库后 |
| `post:beforeDelete` | `{ post }` | 删除前 |
| `post:afterDelete` | `{ post }` | 删除后 |
| `post:beforeRender` | `{ post, html }` | 文章详情模板渲染前 |
| `post:beforeView` | `{ post }` | 增加浏览量前 |
| `post:afterView` | `{ post }` | 增加浏览量后 |

## Comments And Groups

| Hook | Payload | Timing |
| --- | --- | --- |
| `comment:beforeCreate` | `CommentDraft` | 评论校验和写库前 |
| `comment:afterCreate` | `Comment` | 写库后 |
| `comment:beforeModerate` | `{ comment, status }` | 审核状态更新前 |
| `comment:beforeDelete` | `{ comment }` | 删除前 |
| `comment:afterDelete` | `{ comment }` | 删除后 |
| `group:beforeSave` | `GroupDraft` | 创建或更新权限组前 |
| `group:beforeDelete` | `{ group }` | 删除权限组前 |

## Plugins And Rendering

| Hook | Payload | Timing |
| --- | --- | --- |
| `plugin:afterLoad` | `{ id, name, version }` | 插件激活成功后 |
| `plugin:beforeEnable` / `plugin:afterEnable` | `{ id, enabled }` | 启停前后 |
| `plugin:beforeReorder` / `plugin:afterReorder` | `{ id, order }` | 排序更新前后 |
| `plugin:beforeUninstall` / `plugin:afterUninstall` | `{ id }` | 卸载前后 |
| `admin:menu` | `Array<{ title, link }>` | 后台导航生成时 |
| `site:config` | `SiteConfig` | 每个请求读取站点配置时 |
| `site:locals` | `Record<string, unknown>` | 模板 locals 注入前 |

插件停用或卸载时，系统会移除该插件注册的 Hook 和服务端区块渲染器。
