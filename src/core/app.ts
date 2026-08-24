/*
 * Author: MoyuZJ
 * Team: LinearTeam
 * Contact: linearteam@foxmail.com
 * Made by MoyuZJ in China with ♥
 */

import express from 'express';
import expressLayouts from 'express-ejs-layouts';
import session from 'express-session';
import path from 'node:path';
import { registerCoreRoutes } from '../controllers/routes.js';
import { registerCoreServices } from './core-services.js';
import { setActiveContext } from './context.js';
import { db, runMigrations } from './database.js';
import { HookSystem } from './hook-system.js';
import { PluginManager } from './plugin-manager.js';
import { RouterCollector } from './router-collector.js';
import { SQLiteSessionStore } from './session-store.js';

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

  // The local infrastructure database keeps plugin state even when content services are replaced.
  runMigrations();
  registerCoreServices(context, hooks, plugins);
  await plugins.bootstrapEnabled();

  app.use(session({ store: context.sessionStoreFactory(), secret: process.env.SESSION_SECRET ?? 'linearpress-development-secret', resave: false, saveUninitialized: false, cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 1000 * 60 * 60 * 24 * 14 } }));
  app.use(async (req, res, next) => {
    if (!await context.auth.isOobeRequired()) return next();
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

  app.use(async (req, res, next) => {
    const user = req.session.userId ? await context.users.findById(req.session.userId) : undefined;
    const locals = await hooks.trigger('site:locals', {
      siteConfig: await context.config.get(),
      pluginStyleUrls: plugins.styleUrls,
      pluginScriptUrls: plugins.scriptUrls,
      currentUser: user,
      currentGroup: user ? await context.users.getGroup(user.group_id) : undefined,
      currentPath: req.path,
      adminMenu: await hooks.collect('admin:menu', [{ title: '控制台', link: '/admin' }, { title: '文章', link: '/admin/posts' }, { title: '评论', link: '/admin/comments' }, { title: '用户', link: '/admin/users' }, { title: '权限组', link: '/admin/groups' }, { title: '插件', link: '/admin/plugins' }])
    });
    Object.assign(res.locals, locals);
    next();
  });
  for (const middleware of plugins.middlewares) app.use(middleware);
  app.use('/admin', (_req, res, next) => { res.locals.layout = 'layouts/admin'; next(); });
  router.applyToApp(app);
  app.use((req, res) => res.status(404).render('error', { title: '未找到', message: '请求的页面不存在。' }));
  return app;
}

export async function start(): Promise<void> {
  if (process.env.LINEARPRESS_RESTART_CHILD === '1') await new Promise((resolve) => setTimeout(resolve, 700));
  const app = await createApp();
  const port = Number(process.env.PORT ?? 3000);
  app.listen(port, () => console.log(`LinearPress running at http://localhost:${port}`));
}
