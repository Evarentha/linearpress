import express from 'express';
import expressLayouts from 'express-ejs-layouts';
import session from 'express-session';
import path from 'node:path';
import { siteConfig } from '../../config/default.js';
import { registerCoreRoutes } from '../controllers/routes.js';
import { findUserById, getGroup, isOobeRequired } from '../services/user.service.js';
import { db, runMigrations } from './database.js';
import { HookSystem } from './hook-system.js';
import { PluginManager } from './plugin-manager.js';
import { RouterCollector } from './router-collector.js';

type SessionCallback = (error?: Error | null, session?: session.SessionData | null) => void;
class SQLiteSessionStore extends session.Store {
  get(sid: string, callback: SessionCallback): void {
    try {
      const row = db.prepare('SELECT sess, expired FROM sessions WHERE sid=?').get(sid) as { sess: string; expired: number } | undefined;
      if (!row || row.expired <= Date.now()) return callback(null, null);
      callback(null, JSON.parse(row.sess) as session.SessionData);
    } catch (error) { callback(error as Error); }
  }
  set(sid: string, sess: session.SessionData, callback: (error?: Error | null) => void): void {
    try {
      const expires = sess.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 86400000;
      db.prepare('INSERT INTO sessions(sid,sess,expired) VALUES(?,?,?) ON CONFLICT(sid) DO UPDATE SET sess=excluded.sess, expired=excluded.expired').run(sid, JSON.stringify(sess), expires);
      callback(null);
    } catch (error) { callback(error as Error); }
  }
  destroy(sid: string, callback: (error?: Error | null) => void): void { try { db.prepare('DELETE FROM sessions WHERE sid=?').run(sid); callback(null); } catch (error) { callback(error as Error); } }
  touch(sid: string, sess: session.SessionData, callback: (error?: Error | null) => void): void { this.set(sid, sess, callback); }
}

export async function createApp() {
  runMigrations();
  const app = express();
  const hooks = new HookSystem();
  const router = new RouterCollector();
  app.disable('x-powered-by');
  app.set('view engine', 'ejs');
  app.use(expressLayouts);
  app.set('layout', 'layouts/web');
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(session({ store: new SQLiteSessionStore(), secret: process.env.SESSION_SECRET ?? 'linearpress-development-secret', resave: false, saveUninitialized: false, cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 1000 * 60 * 60 * 24 * 14 } }));
  app.use((req, res, next) => {
    if (!isOobeRequired()) return next();
    if (req.path === '/oobe' || req.path.startsWith('/css/') || req.path.startsWith('/js/') || req.path === '/favicon.ico') return next();
    res.redirect('/oobe');
  });

  const plugins = new PluginManager(app, db, hooks, router);
  registerCoreRoutes(router, hooks, plugins);
  await plugins.loadAll();
  app.set('views', [...plugins.viewPaths].reverse().concat(path.join(process.cwd(), 'src', 'views')));
  for (const dir of [...plugins.staticPaths].reverse()) app.use(express.static(dir));
  app.use(express.static(path.join(process.cwd(), 'src', 'public')));
  app.use(async (req, res, next) => {
    const user = req.session.userId ? findUserById(req.session.userId) : undefined;
    res.locals.siteConfig = siteConfig;
    res.locals.currentUser = user;
    res.locals.currentGroup = user ? getGroup(user.group_id) : undefined;
    res.locals.currentPath = req.path;
    res.locals.adminMenu = await hooks.collect('admin:menu', [{ title: '控制台', link: '/admin' }, { title: '文章', link: '/admin/posts' }, { title: '评论', link: '/admin/comments' }, { title: '用户', link: '/admin/users' }, { title: '权限组', link: '/admin/groups' }, { title: '插件', link: '/admin/plugins' }]);
    next();
  });
  app.use('/admin', (_req, res, next) => { res.locals.layout = 'layouts/admin'; next(); });
  router.applyToApp(app);
  app.use((req, res) => res.status(404).render('error', { title: '未找到', message: '请求的页面不存在。' }));
  return app;
}

export async function start(): Promise<void> { const app = await createApp(); const port = Number(process.env.PORT ?? 3000); app.listen(port, () => console.log(`LinearPress running at http://localhost:${port}`)); }
