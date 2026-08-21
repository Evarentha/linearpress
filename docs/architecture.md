# LinearPress Architecture

## Runtime

LinearPress 使用 Node.js、TypeScript/tsx、Express 5、EJS 和 Node 24 内置 SQLite。插件是完全可信代码，不使用沙箱。

## Startup Lifecycle

1. 创建 Express、Hook、路由收集器和 ServiceContainer。
2. 注册默认数据库与 Session Store factory。
3. 从文件系统发现插件。
4. 对 `preboot: true` 插件执行 `preboot`，允许替换数据库和 Session。
5. 初始化本地基础设施 SQLite，它保存插件状态和默认数据。
6. 注册核心默认服务。
7. 按数据库 `load_order` 执行启用插件的 `bootstrap`，允许 replace/decorate 服务。
8. 创建 Session 中间件和 OOBE 门禁。
9. 收集核心路由。
10. 执行插件 `activate`，收集插件路由、视图、资源和中间件。
11. 倒序挂载路由，后加载插件优先。

## Service Container

核心业务不通过静态模块引用绑定到控制器。控制器在请求时解析 token：

```ts
container.resolve(TOKENS.posts)
container.resolve(TOKENS.auth)
container.resolve(TOKENS.permissions)
```

插件可完整替换服务，也可使用装饰器包裹原实现。所有服务方法支持 Promise，使异步数据库驱动能够注入。

默认 token 包含数据库、Session、认证、用户、文章、评论、权限组、权限、插件和站点配置。插件可以用 `createToken` 注册新模块。

## Database Boundary

本地 SQLite 基础设施数据库负责插件注册和默认实现。MySQL 等驱动可以在 preboot 替换主数据库和 Session，并在 bootstrap 替换所有业务服务。这样插件加载状态不依赖可替换的内容数据库。

## Routes, Views And Assets

路由经 RouterCollector 延迟注册并反向挂载。视图目录倒序解析。插件公共目录挂载到 `/plugins/<id>/`，Manifest 中的 CSS/JS 自动进入前后台布局。

## Blocks And Hooks

BlockRegistry 支持服务端自定义区块渲染；浏览器 `LinearPressEditor.registerBlock` 支持编辑器字段注入。Hook 用于轻量事件修改，ServiceContainer 用于完整实现替换。

## Protected Kernel

不可由普通 activate 插件替换的只有进程入口、插件文件发现器和生命周期调度器。preboot 插件可以替换数据库与 Session；bootstrap 插件可以替换其余业务服务。
