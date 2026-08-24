/*
 * Author: MoyuZJ
 * Team: LinearTeam
 * Contact: linearteam@foxmail.com
 * Made by MoyuZJ in China with ♥
 */

import express, { type NextFunction, type Request, type Response } from 'express';
import expressLayouts from 'express-ejs-layouts';
import session from 'express-session';
import path from 'node:path';
import { registerCoreRoutes } from '../controllers/routes.js';
import { getBaseConfig } from '../services/config.service.js';
import { formatDate } from './datetime.js';
import { registerCoreServices } from './core-services.js';
import { setActiveContext } from './context.js';
import { db, runMigrations } from './database.js';
import { HookSystem } from './hook-system.js';
import { maintenance } from './maintenance.js';
import { postUrl } from './permalinks.js';
import { PluginManager } from './plugin-manager.js';
import { RouterCollector } from './router-collector.js';
import { SQLiteSessionStore } from './session-store.js';
import { LINEARPRESS_VERSION } from './version.js';
import type { Post } from '../types/index.js';

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

  app.use(session({ store: context.sessionStoreFactory(), secret: process.env.SESSION_SECRET ?? 'linearpress-development-secret', resave: false, saveUninitialized: false, cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 1000 * 60 * 60 * 24 * 14 } }));

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
      if (config.autoDetect || !config.primaryDomain) return next();
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
    for (const item of plugins.adminMenus) adminMenu.push({ title: item.title, link: item.link });
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

  // 兜底错误处理：进入维护模式并 dump 错误日志。
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[LinearPress] Unhandled error:', error);
    maintenance.enter('fatal');
    maintenance.dumpError(error);
    if (res.headersSent) return;
    res.status(500).type('html').send(maintenance.render());
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
    app.listen(port, () => console.log(`LinearPress running at http://localhost:${port}`));
  } catch (error) {
    onFatal(error);
    throw error;
  }
}
