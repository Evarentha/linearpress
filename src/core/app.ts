/*
 * Author: MoyuZJ
 * Team: LinearTeam
 * Contact: linearteam@foxmail.com
 * Made by MoyuZJ in China with ♥
 */

import express, { type NextFunction, type Request, type Response } from 'express';
import expressLayouts from 'express-ejs-layouts';
import session from 'express-session';
import crypto from 'node:crypto';
import fs from 'fs-extra';
import path from 'node:path';
import { registerCoreRoutes } from '../controllers/routes.js';
import { getBaseConfig } from '../services/config.service.js';
import { formatDate } from './datetime.js';
import { registerCoreServices } from './core-services.js';
import { setActiveContext } from './context.js';
import { db, purgeExpiredSessions, runMigrations } from './database.js';
import { HookSystem } from './hook-system.js';
import { maintenance } from './maintenance.js';
import { postUrl } from './permalinks.js';
import { PluginManager } from './plugin-manager.js';
import { RouterCollector } from './router-collector.js';
import { SQLiteSessionStore } from './session-store.js';
import { LINEARPRESS_VERSION } from './version.js';
import type { Post, SiteConfig } from '../types/index.js';

const DEFAULT_ADMIN_MENU = [
  { title: '控制台', link: '/admin' },
  { title: '文章', link: '/admin/posts' },
  { title: '评论', link: '/admin/comments' },
  { title: '用户', link: '/admin/users' },
  { title: '权限组', link: '/admin/groups' },
  { title: '插件', link: '/admin/plugins' },
  { title: '站点设置', link: '/admin/settings' }
];

const normalizeHost = (value: string): string => String(value ?? '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');

/** 域名急救路径：/rescue 及其子路径在来源校验和域名重定向前放行。 */
const isRescuePath = (pathname: string): boolean => pathname === '/rescue' || pathname.startsWith('/rescue/');

/** 会话签名密钥：优先环境变量；缺失时生成随机密钥并落盘，避免硬编码默认值可被伪造会话。 */
function resolveSessionSecret(): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const secretFile = path.join(process.cwd(), 'data', 'session-secret.json');
  try {
    const stored = fs.readJsonSync(secretFile) as { secret?: string } | undefined;
    if (stored?.secret) return stored.secret;
  } catch { /* 首次启动或文件损坏时重新生成 */ }
  const secret = crypto.randomBytes(48).toString('base64url');
  fs.ensureDirSync(path.dirname(secretFile));
  fs.writeJsonSync(secretFile, { secret }, { mode: 0o600 });
  return secret;
}

export async function createApp() {
  const app = express();
  const hooks = new HookSystem();
  const router = new RouterCollector();

  app.disable('x-powered-by');
  app.set('view engine', 'ejs');
  app.use(expressLayouts);
  app.set('layout', 'layouts/web');
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());

  const plugins = new PluginManager(app, db, hooks, router);
  const context = plugins.context;
  setActiveContext(context);

  context.provide('database', db);
  context.provide('sessionStoreFactory', () => new SQLiteSessionStore(context.database));

  plugins.discover();
  await plugins.prebootAll();

  // 本地基础设施数据库始终保留插件状态与站点设置，即使业务服务被替换。
  runMigrations();
  registerCoreServices(context, hooks, plugins);
  await plugins.bootstrapEnabled();

  maintenance.setSiteNameProvider(() => {
    try { return getBaseConfig().siteName || 'LINEARPRESS'; }
    catch { return 'LINEARPRESS'; }
  });

  app.use(session({ store: context.sessionStoreFactory(), secret: resolveSessionSecret(), resave: false, saveUninitialized: false, cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' ? 'auto' : false, maxAge: 1000 * 60 * 60 * 24 * 14 } }));

  // CSRF 纵深防御：校验非安全方法的 Origin/Referer 是否属于本站。
  // SameSite=Lax 已拦截跨站 POST 携带 Cookie；此检查覆盖浏览器忽略 SameSite 的场景。
  // 无 Origin 且无 Referer 的非浏览器客户端（curl/API）不受影响。
  app.use(async (req: Request, res: Response, next: NextFunction) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    // 域名急救：无论当前域名/来源如何都要允许提交，否则填错域名后无法自救。
    if (isRescuePath(req.path)) return next();
    let siteConfig: SiteConfig | undefined;
    try { siteConfig = await context.config.get(); } catch { /* 配置不可用时仅比对请求 Host */ }
    // 自动配置模式：任何域名都接受，不校验 Origin 是否属于配置中的域名。
    if (siteConfig?.autoDetect) return next();
    const allowedHosts = new Set<string>([normalizeHost(req.headers.host ?? '')]);
    if (siteConfig?.primaryDomain) allowedHosts.add(normalizeHost(siteConfig.primaryDomain));
    for (const item of siteConfig?.backupDomains ?? []) allowedHosts.add(normalizeHost(item));
    allowedHosts.delete('');
    const origin = req.headers.origin;
    const referer = req.headers.referer;
    if (!origin && !referer) return next();
    try {
      const host = normalizeHost(new URL(origin ?? new URL(referer!).origin).host);
      if (allowedHosts.has(host)) return next();
    } catch { /* 解析失败按拒绝处理 */ }
    return res.status(403).type('html').send('请求来源校验失败，请从站点页面正常提交。');
  });

  // 维护模式：普通路由被拦截，/login 与 /admin 仍可访问。
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!maintenance.isEnabled()) return next();
    if (maintenance.isBypassPath(req.path)) return next();
    res.status(503).type('html').send(maintenance.render());
  });

  // 域名重定向：autoDetect 关闭时，非主/备用域名 301 到主域名。
  app.use(async (req: Request, res: Response, next: NextFunction) => {
    try {
      const config = await context.config.get();
      // 自动配置、未配置主域名、急救路径以及静态资源不参与域名强制跳转。
      if (config.autoDetect || !config.primaryDomain || isRescuePath(req.path) || req.path === '/favicon.ico' || req.path.startsWith('/css/') || req.path.startsWith('/js/') || req.path.startsWith('/plugins/') || req.path.startsWith('/uploads/')) return next();
      const primary = normalizeHost(config.primaryDomain);
      const backups = config.backupDomains.map(normalizeHost).filter(Boolean);
      const host = normalizeHost(req.headers.host ?? '');
      if (host !== primary && !backups.includes(host)) {
        return res.redirect(301, `${req.protocol}://${primary}${req.originalUrl}`);
      }
      next();
    } catch (error) { next(error); }
  });

  // OOBE 门禁：未完成初始化向导前，仅放行 /oobe 与静态资源。
  app.use(async (req: Request, res: Response, next: NextFunction) => {
    if (await context.config.isOobeCompleted()) return next();
    if (req.path === '/oobe' || req.path.startsWith('/css/') || req.path.startsWith('/js/') || req.path.startsWith('/plugins/') || req.path === '/favicon.ico') return next();
    res.redirect('/oobe');
  });

  registerCoreRoutes(router, hooks, context);
  await plugins.activateAll();

  app.set('views', [...plugins.viewPaths].reverse().concat(path.join(process.cwd(), 'src', 'views')));
  const staticGroups = new Map<string, string[]>();
  for (const mount of plugins.staticMounts) staticGroups.set(mount.id, [...(staticGroups.get(mount.id) ?? []), mount.dir]);
  for (const [id, dirs] of [...staticGroups.entries()].reverse()) app.use(`/plugins/${id}`, ...dirs.map((dir) => express.static(dir)));
  app.use(express.static(path.join(process.cwd(), 'src', 'public')));

  app.use(async (req: Request, res: Response, next: NextFunction) => {
    const user = req.session.userId ? await context.users.findById(req.session.userId) : undefined;
    const config = await context.config.get();
    const adminMenu = await hooks.collect('admin:menu', [...DEFAULT_ADMIN_MENU]);
    for (const item of plugins.adminMenus) adminMenu.push({ ...item });
    const locals = await hooks.trigger('site:locals', {
      siteConfig: config,
      pluginStyleUrls: plugins.styleUrls,
      pluginScriptUrls: plugins.scriptUrls,
      currentUser: user,
      currentGroup: user ? await context.users.getGroup(user.group_id) : undefined,
      currentPath: req.path,
      adminMenu,
      adminPanels: plugins.adminPanels,
      customSettings: plugins.customSettings,
      customSettingsFor: (id: string) => plugins.customSettingsFor(id),
      postUrl: (post: Post) => postUrl(post, config.permalink),
      formatDate: (value: Date | string | null | undefined) => formatDate(value, config),
      LINEARPRESS_VERSION,
      maintenanceEnabled: maintenance.isEnabled()
    });
    Object.assign(res.locals, locals);
    next();
  });
  for (const middleware of plugins.middlewares) app.use(middleware);
  app.use('/admin', (_req: Request, res: Response, next: NextFunction) => { res.locals.layout = 'layouts/admin'; next(); });
  router.applyToApp(app);
  app.use((req: Request, res: Response) => res.status(404).render('error', { title: '未找到', message: '请求的页面不存在。' }));

  // 兜底错误处理：记录并 dump 错误日志，返回一次性致命页。
  // 单个请求异常不进入全站维护模式（避免攻击者用单请求把整站打成 503）；
  // 全站维护仅由进程级致命错误（uncaughtException 等）或管理员/更新流程显式开启。
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[LinearPress] Unhandled error:', error);
    maintenance.dumpError(error);
    if (res.headersSent) return;
    res.status(500).type('html').send(maintenance.renderFatalPage());
  });

  return app;
}

export async function start(): Promise<void> {
  if (process.env.LINEARPRESS_RESTART_CHILD === '1') await new Promise((resolve) => setTimeout(resolve, 700));

  const onFatal = (error: unknown) => {
    console.error('[LinearPress] Fatal error:', error);
    maintenance.enter('fatal');
    maintenance.dumpError(error);
  };
  process.on('uncaughtException', onFatal);
  process.on('unhandledRejection', onFatal);

  try {
    const app = await createApp();
    const port = Number(process.env.PORT ?? 3000);
    // 定时清理过期会话（每小时），避免 sessions 表无限膨胀。
    purgeExpiredSessions();
    const sessionSweeper = setInterval(purgeExpiredSessions, 60 * 60 * 1000);
    sessionSweeper.unref?.();
    app.listen(port, () => console.log(`LinearPress running at http://localhost:${port}`));
  } catch (error) {
    onFatal(error);
    throw error;
  }
}
