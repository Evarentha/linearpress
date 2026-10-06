# 插件安装与重启验证

<!-- Copyright (C) 2026 Evarentha; SPDX-License-Identifier: GPL-3.0-or-later -->

后台「插件」页支持推荐的 **`.lpp` 插件包**、兼容 `.zip` 包和 npm 包名。原生主题和 Fluent 主题共用同一安装脚本，保留现有主题样式。插件会运行受信任的服务器代码，不是沙箱；请只安装可信来源。LPP 文件完整性校验不代表发布者身份认证。

## 操作与进度

1. 选择一个 `.lpp` / `.zip` 文件，或输入 npm 包名（可指定版本），点击安装。
2. 服务器受理后返回持久化任务编号；页面持续显示校验、安装、重启、验证或恢复阶段。
3. **只有任务为 `completed` 时才显示成功及「查看插件列表」链接**。安装接口返回 202、服务器端口恢复、readiness 成功，都不是安装成功。浏览器不再发起单独的重启请求，不弹出重启确认，不按固定时间刷新。
4. `failed` 显示后端安全诊断并停止队列。服务器消息以纯文本输出，不插入 HTML。恢复阶段不是成功；不得据此宣称数据库回滚完成。

提交和查询期间两个安装表单都禁用，原生按钮和 `fluent-button.disabled` 一致；Fluent npm 输入读取当前 `.value`。不确定进度不伪造百分比，使用带标签的 indeterminate `progress` 和 `role=status` / `aria-live=polite` 状态区。安装依赖 JavaScript；无脚本时有明确说明且表单控件禁用，避免无反馈安装。

## 刷新、断线和登录

- 已受理任务由后端执行；关闭页面或停止查询不会取消后端任务。
- 当前任务的 ID、状态 URL、文件名及批量计数保存在本标签页的 `sessionStorage`（键 `linearpress.plugin-install.v1`）。**同一标签页刷新后自动恢复 GET 查询，不重新上传。** 浏览器限制存储时页面明确提示保留页面及任务编号。
- `sessionStorage` 不承诺跨关闭标签页、其他浏览器或隐私清理恢复。需跨浏览器查询时保留任务 ID，由已登录管理员查询对应状态接口。此版本没有从未知任务编号自动发现最近任务的接口。
- 断线或 503 进入等待就绪流程：查询公开 `/__linearpress/ready`，就绪后回到已登录的任务接口；不会把维护 HTML、网络错误、404 或未知阶段视为成功。
- 单次 GET 超时 15 秒。查询间隔从 1.5 秒退避到 15 秒；尊重数字 `Retry-After`（最多 30 秒）。每轮自动查询最多约 10 分钟（在途请求最多再占 15 秒），之后停下并显示「继续查询（不重新安装）」。继续查询只开启同一任务的新一轮有界 GET，不再 POST 安装。
- 401 或跳转 `/login` 表示登录过期，**不表示安装失败**。任务保留，提供新标签页登录链接；登录后回原标签页继续查询。403 暂停并提示联系管理员。
- 安装 POST 最多等待 120 秒，且永不自动重发。上传中刷新、网络中断、网关错误或缺少可信 202 任务凭据时，提交结果为**未确认**，表单保持锁定（刷新也保留此状态）。此时可能已受理，必须先核对插件列表和服务器任务记录，不要重复上传；核对后可手动解锁表单，解锁本身不发送安装或重启请求。

## 批量安装

选择多个文件需要显式启用批量安装。先检查所有扩展名；非法选择不会部分上传。按选择顺序逐个执行：**上传一包 → 等待该任务重启后验证 `completed` → 再上传下一包**，不存在并发重启。任一失败停止后续包，并显示已完成数量。登录过期或查询超时可在当前页面继续同一队列。

文件对象不写入浏览器存储。刷新或关闭页面会丢失**尚未上传**的队列，但不会中止当前后端任务。刷新恢复当前任务后显示已完成数量，并提示重新选择剩余文件；不会把部分完成宣称为整批完成。

## 后端契约依赖

详细协调见 [`.pi/lpp/contract.md`](../.pi/lpp/contract.md)。UI 不修改 routes、core 或包管理依赖。

| 操作 | 请求 / 响应 |
| --- | --- |
| LPP | `POST /admin/plugins/install-lpp`，原始文件字节，`Content-Type: application/vnd.linearpress.plugin+zip` |
| ZIP | `POST /admin/plugins/install-zip`，原始文件字节，`Content-Type: application/zip` |
| npm | `POST /admin/plugins/install-npm`，JSON `{ "package": "@scope/plugin@1.0.0" }` |
| 受理 | **202** `{ok:true,jobId,statusUrl,message?}`；必须在后端任务持久化之后返回 |
| 状态 | `GET /admin/plugins/install-jobs/:id` → **200** `{ok:true,job:{id,phase,message,plugins,errors?}}` |
| 就绪 | `GET /__linearpress/ready` → **200** `{ready:true,bootId}` 才继续认证状态查询；不可泄露详细任务数据 |

任务 ID 使用 1–128 位字母、数字、`_` 或 `-`（兼容 UUID）。`statusUrl` 必须同源、无查询参数/片段，且路径与 `/admin/plugins/install-jobs/<jobId>` 完全一致；UI 不接受外站状态地址。中间阶段为 `validating/installing/restarting/verifying/recovering`，终态仅为 `completed/failed`。必须在新 worker 已加载并验证候选插件后才能报告 `completed`。`message` 及可选字符串数组 `errors` 应为可向管理员展示的安全诊断，避免泄漏凭据；前端以 `textContent` 显示，错误数组最多展示前五项。

认证/权限由后端强制执行，同源 cookie 随请求发送；重启后必须保留可用会话或返回 401（兼容跳转 `/login`）。后端仍须串行化任务，防止多标签页/多管理员并发；前端锁定不能替代服务端互斥。服务器拒绝新请求时可返回明确 4xx `{ok:false,message}`；未知 5xx 不被当作确定失败。

## 浏览器回归

```sh
node .pi/lpp/ui-regression.mjs
```

测试启动仅含安装页实际模板片段的本地 HTTP fixture，加载真实共用脚本以及主题已提交的 Fluent Web Components bundle，在**实际 Chrome** 中点击、填写输入和上传文件；只 mock 安装、任务与 readiness HTTP 响应。不启动真实应用，不读写原始业务数据，不改共享 `node_modules`。

优先使用可解析的 `playwright`；否则使用原审计工具目录 `E:/Projects/LinearPress/.pi/audit/browser-deps`。其他机器可设置 `LINEARPRESS_BROWSER_DEPENDENCIES` 指向现有 Playwright 工具目录，需安装 Chrome。此脚本不自行安装依赖。

覆盖 native/Fluent：一次上传及重复提交拦截、LPP/ZIP/npm、真实 Fluent `.value`、server-directed restart、503 → readiness → completed、断线恢复、安全失败诊断、刷新恢复/丢失剩余队列提示、401 登录继续、串行批量失败停止、未知 POST 保守锁定、10 分钟有界查询及手动继续、无 JavaScript 说明。浏览器时钟加速仅用于退避/超时测试，不改变生产重试策略。该回归证明 UI 行为，不替代后端包验证、真实进程重启和持久化集成测试。
