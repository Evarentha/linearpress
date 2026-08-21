# Hook Reference

所有钩子都在 `src/types/hooks.ts` 中声明，插件通过 `hooks.on(name, callback, { priority })` 注册。数字越小越先执行，回调返回的新值会传递给下一个处理器。

| Hook | Payload | 用途 |
| --- | --- | --- |
| `post:beforeSave` | `Post` | 保存前修改文章 |
| `post:afterSave` | `Post` | 保存完成后的通知或索引 |
| `post:beforeRender` | `{ post, html }` | 修改文章详情 HTML |
| `admin:menu` | `Array<{ title, link }>` | 向后台菜单添加入口 |

插件停用时由系统移除该插件注册的所有钩子。钩子回调应保持短小，数据库写入应使用事务或幂等语句。
