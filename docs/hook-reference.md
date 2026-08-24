<!--
  Author: MoyuZJ
  Team: LinearTeam
  Contact: linearteam@foxmail.com
  Made by MoyuZJ in China with ♥
-->

# Hook Reference

LinearPress HookSystem 是 payload waterfall，适合在业务动作前后读取或修改对象。Cordis Event 是插件生命周期和通知机制。两者不要混为一个 API。

## Hook 与 Cordis 映射

| LinearPress Hook | 推荐 Cordis 事件 | 说明 |
| --- | --- | --- |
| `auth:beforeLogin` | `linearpress/auth-before-login` | 需要修改 payload 时继续使用 Hook |
| `auth:afterLogin` | `linearpress/auth-after-login` | 通知型逻辑可以使用 Cordis |
| `user:afterCreate` | `linearpress/user-created` | 通知型逻辑可以使用 Cordis |
| `post:beforeSave` | `linearpress/post-before-save` | 修改文章仍使用 Hook |
| `post:afterSave` | `linearpress/post-saved` | 通知型逻辑可以使用 Cordis |
| `post:beforeRender` | `linearpress/post-before-render` | 修改 HTML 仍使用 Hook |
| `comment:afterCreate` | `linearpress/comment-created` | 通知型逻辑可以使用 Cordis |
| `plugin:afterLoad` | `linearpress/plugin-loaded` | 新代码可以监听 Cordis 生命周期事件 |

当前版本已经把插件代码放在 Cordis Fiber 中，但尚未强制把所有旧 Hook 改名，以保持第三方插件兼容。

## Existing Hooks

### Authentication And Users

| Hook | Payload | Timing |
| --- | --- | --- |
| `auth:beforeLogin` | `{ username, password }` | 校验密码前 |
| `auth:afterLogin` | `User` | 登录成功后 |
| `auth:beforeLogout` | `{ userId? }` | 销毁 Session 前 |
| `user:beforeCreate` | `UserDraft` | 创建用户前 |
| `user:afterCreate` | `User` | 用户写入数据库后 |
| `user:beforeAssignGroup` | `{ user, group }` | 修改权限组前 |
| `user:afterAssignGroup` | `{ user, group }` | 修改权限组后 |

### Posts

| Hook | Payload | Timing |
| --- | --- | --- |
| `post:beforeSave` | `Post` | 写库前 |
| `post:afterSave` | `Post` | 写库后 |
| `post:beforeDelete` | `{ post }` | 删除前 |
| `post:afterDelete` | `{ post }` | 删除后 |
| `post:beforeRender` | `{ post, html }` | 模板渲染前 |
| `post:beforeView` | `{ post }` | 增加浏览量前 |
| `post:afterView` | `{ post }` | 增加浏览量后 |

### Comments And Groups

| Hook | Payload | Timing |
| --- | --- | --- |
| `comment:beforeCreate` | `CommentDraft` | 评论写库前 |
| `comment:afterCreate` | `Comment` | 写库后 |
| `comment:beforeModerate` | `{ comment, status }` | 审核前 |
| `comment:beforeDelete` | `{ comment }` | 删除前 |
| `comment:afterDelete` | `{ comment }` | 删除后 |
| `group:beforeSave` | `GroupDraft` | 创建或更新前 |
| `group:beforeDelete` | `{ group }` | 删除前 |

### Plugins And Rendering

| Hook | Payload | Timing |
| --- | --- | --- |
| `plugin:afterLoad` | `{ id, name, version }` | 插件激活成功后 |
| `plugin:beforeEnable` / `plugin:afterEnable` | `{ id, enabled }` | 启停前后 |
| `plugin:beforeReorder` / `plugin:afterReorder` | `{ id, order }` | 排序更新前后 |
| `plugin:beforeUninstall` / `plugin:afterUninstall` | `{ id }` | 卸载前后 |
| `admin:menu` | `Array<{ title, link }>` | 后台导航生成时 |
| `site:config` | `SiteConfig` | 请求读取站点配置时 |
| `site:locals` | `Record<string, unknown>` | 模板 locals 注入前 |

插件停用或卸载时，Cordis 会自动清理其 Fiber 中注册的事件和 Effect；旧 Hook 仍由 LinearPress 根据插件 ID 清理。
