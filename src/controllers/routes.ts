import type { Request, Response } from 'express';
import type { HookSystem } from '../core/hook-system.js';
import type { RouterCollector } from '../core/router-collector.js';
import type { ServiceContainer } from '../core/service-container.js';
import { TOKENS } from '../core/tokens.js';
import { checkPermission, requireAuth } from '../services/permission.service.js';
import type { Block, CommentStatus, PostStatus } from '../types/index.js';

const BUILTIN_PLUGINS = ['seo', 'minimal-theme'];
function parseBlocks(value: unknown): Block[] { try { const parsed = JSON.parse(String(value ?? '[]')) as Block[]; return Array.isArray(parsed) ? parsed : []; } catch { return []; } }
function routeParam(value: string | string[]): string { return Array.isArray(value) ? value[0] ?? '' : value; }
function messageOf(error: unknown): string { return error instanceof Error ? error.message : '操作失败'; }
const wrap = (fn: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response) => { fn(req, res).catch((error) => res.status(500).render('error', { title: '服务器错误', message: messageOf(error) })); };

export function registerCoreRoutes(router: RouterCollector, hooks: HookSystem, container: ServiceContainer): void {
  router.register('get', '/oobe', wrap(async (_req, res) => { if (!await container.resolve(TOKENS.auth).isOobeRequired()) return void res.redirect('/'); res.render('auth/oobe', { title: '初始化', error: null }); }));
  router.register('post', '/oobe', wrap(async (req, res) => {
    const auth = container.resolve(TOKENS.auth);
    if (!await auth.isOobeRequired()) return void res.redirect('/');
    try { const user = await auth.createSuperAdmin(String(req.body.username ?? ''), String(req.body.email ?? ''), String(req.body.password ?? ''), String(req.body.password_confirmation ?? '')); req.session.userId = user.id; res.redirect('/admin'); }
    catch (error) { res.status(400).render('auth/oobe', { title: '初始化', error: messageOf(error) }); }
  }));

  router.register('get', '/', wrap(async (_req, res) => res.render('web/index', { title: '文章', posts: await container.resolve(TOKENS.posts).listPublished() })));
  router.register('get', '/post/:slug', wrap(async (req, res) => {
    const posts = container.resolve(TOKENS.posts);
    const post = await posts.findBySlug(routeParam(req.params.slug));
    if (!post || post.status !== 'published') return void res.status(404).render('error', { title: '未找到', message: '文章不存在或尚未发布。' });
    const viewPayload = await hooks.trigger('post:beforeView', { post });
    await posts.incrementViews(viewPayload.post.id);
    await hooks.trigger('post:afterView', viewPayload);
    const rendered = await hooks.trigger('post:beforeRender', { post, html: post.html_cache ?? await posts.render(post.content_json) });
    const comments = await container.resolve(TOKENS.comments).listForPost(post.id);
    res.render('web/post', { title: post.title, post, html: rendered.html, comments, notice: req.query.notice });
  }));
  router.register('post', '/post/:slug/comments', wrap(async (req, res) => {
    const post = await container.resolve(TOKENS.posts).findBySlug(routeParam(req.params.slug));
    if (!post) return void res.status(404).end();
    try { await container.resolve(TOKENS.comments).create({ postId: post.id, userId: req.session.userId, guestName: req.body.guest_name, guestEmail: req.body.guest_email, content: String(req.body.content ?? ''), ip: req.ip }); res.redirect(`/post/${post.slug}?notice=comment-pending`); }
    catch (error) { res.status(400).render('error', { title: '评论未提交', message: messageOf(error) }); }
  }));

  router.register('get', '/login', (_req, res) => res.render('auth/login', { title: '登录', error: null }));
  router.register('post', '/login', wrap(async (req, res) => { const user = await container.resolve(TOKENS.auth).authenticate(req.body.username, req.body.password); if (!user) return void res.status(401).render('auth/login', { title: '登录', error: '用户名或密码错误' }); req.session.userId = user.id; res.redirect('/admin'); }));
  router.register('get', '/register', (_req, res) => res.render('auth/register', { title: '注册', error: null }));
  router.register('post', '/register', wrap(async (req, res) => { try { const user = await container.resolve(TOKENS.users).register(String(req.body.username ?? ''), req.body.email ? String(req.body.email) : null, String(req.body.password ?? '')); req.session.userId = user.id; res.redirect('/'); } catch (error) { res.status(400).render('auth/register', { title: '注册', error: messageOf(error) }); } }));
  router.register('post', '/logout', wrap(async (req, res) => { await hooks.trigger('auth:beforeLogout', { userId: req.session.userId }); req.session.destroy(() => res.redirect('/')); }));

  router.register('get', '/admin', requireAuth, checkPermission('admin:access'), wrap(async (_req, res) => {
    const database = container.resolve(TOKENS.databaseService);
    const counts = { posts: (await database.get<{ n: number }>('SELECT COUNT(*) n FROM posts'))!.n, comments: (await database.get<{ n: number }>('SELECT COUNT(*) n FROM comments'))!.n, pending: (await database.get<{ n: number }>("SELECT COUNT(*) n FROM comments WHERE status='pending'"))!.n, users: (await database.get<{ n: number }>('SELECT COUNT(*) n FROM users'))!.n };
    res.render('admin/dashboard', { title: '控制台', counts });
  }));
  router.register('get', '/admin/posts', requireAuth, checkPermission('post:edit'), wrap(async (_req, res) => res.render('admin/posts', { title: '文章管理', posts: await container.resolve(TOKENS.posts).list() })));
  router.register('get', '/admin/posts/new', requireAuth, checkPermission('post:create'), (_req, res) => res.render('admin/post-edit', { title: '新建文章', post: null }));
  router.register('get', '/admin/posts/:id/edit', requireAuth, checkPermission('post:edit'), wrap(async (req, res) => res.render('admin/post-edit', { title: '编辑文章', post: await container.resolve(TOKENS.posts).findById(Number(req.params.id)) })));
  router.register('post', '/admin/posts/save', requireAuth, checkPermission('post:edit'), wrap(async (req, res) => { await container.resolve(TOKENS.posts).save({ id: Number(req.body.id) || undefined, title: String(req.body.title ?? ''), slug: String(req.body.slug ?? ''), blocks: parseBlocks(req.body.content_json), status: String(req.body.status ?? 'draft') as PostStatus, authorId: req.session.userId! }); res.redirect('/admin/posts'); }));
  router.register('post', '/admin/posts/:id/delete', requireAuth, checkPermission('post:delete'), wrap(async (req, res) => { await container.resolve(TOKENS.posts).remove(Number(req.params.id)); res.redirect('/admin/posts'); }));

  router.register('get', '/admin/comments', requireAuth, checkPermission('comment:moderate'), wrap(async (_req, res) => res.render('admin/comments', { title: '评论审核', comments: await container.resolve(TOKENS.comments).list() })));
  router.register('post', '/admin/comments/:id/status', requireAuth, checkPermission('comment:moderate'), wrap(async (req, res) => { await container.resolve(TOKENS.comments).setStatus(Number(req.params.id), String(req.body.status) as CommentStatus); res.redirect('/admin/comments'); }));
  router.register('post', '/admin/comments/:id/delete', requireAuth, checkPermission('comment:moderate'), wrap(async (req, res) => { await container.resolve(TOKENS.comments).remove(Number(req.params.id)); res.redirect('/admin/comments'); }));

  router.register('get', '/admin/users', requireAuth, checkPermission('user:manage'), wrap(async (_req, res) => { const users = container.resolve(TOKENS.users); res.render('admin/users', { title: '用户管理', users: await users.list(), groups: await users.listGroups() }); }));
  router.register('post', '/admin/users/:id/group', requireAuth, checkPermission('user:manage'), wrap(async (req, res) => { try { await container.resolve(TOKENS.users).assignGroup(Number(req.params.id), Number(req.body.group_id)); res.redirect('/admin/users'); } catch (error) { res.status(400).render('error', { title: '权限组分配失败', message: messageOf(error) }); } }));
  router.register('get', '/admin/groups', requireAuth, checkPermission('group:manage'), wrap(async (_req, res) => { const groups = container.resolve(TOKENS.groups); res.render('admin/groups', { title: '权限组', groups: await groups.list(), permissions: await groups.permissions() }); }));
  router.register('post', '/admin/groups/save', requireAuth, checkPermission('group:manage'), wrap(async (req, res) => { try { const service = container.resolve(TOKENS.groups); const permissions = Array.isArray(req.body.permissions) ? req.body.permissions : req.body.permissions ? [req.body.permissions] : []; if (req.body.id) await service.update(Number(req.body.id), String(req.body.name ?? ''), permissions); else await service.create(String(req.body.name ?? ''), permissions); res.redirect('/admin/groups'); } catch (error) { res.status(400).render('error', { title: '权限组保存失败', message: messageOf(error) }); } }));
  router.register('post', '/admin/groups/:id/delete', requireAuth, checkPermission('group:manage'), wrap(async (req, res) => { try { await container.resolve(TOKENS.groups).remove(Number(req.params.id)); res.redirect('/admin/groups'); } catch (error) { res.status(400).render('error', { title: '权限组删除失败', message: messageOf(error) }); } }));

  router.register('get', '/admin/plugins', requireAuth, checkPermission('plugin:manage'), wrap(async (_req, res) => res.render('admin/plugins', { title: '插件管理', plugins: await container.resolve(TOKENS.plugins).list(), builtinPlugins: BUILTIN_PLUGINS })));
  router.register('post', '/admin/plugins/:id/toggle', requireAuth, checkPermission('plugin:manage'), wrap(async (req, res) => { const service = container.resolve(TOKENS.plugins); const id = routeParam(req.params.id); const plugin = (await service.list()).find((item) => item.id === id); if (!plugin) return void res.status(404).render('error', { title: '插件不存在', message: id }); await service.setEnabled(id, !plugin.enabled); res.redirect('/admin/plugins'); }));
  router.register('post', '/admin/plugins/:id/uninstall', requireAuth, checkPermission('plugin:manage'), wrap(async (req, res) => { try { await container.resolve(TOKENS.plugins).uninstall(routeParam(req.params.id)); res.redirect('/admin/plugins'); } catch (error) { res.status(400).render('error', { title: '插件卸载失败', message: messageOf(error) }); } }));
  router.register('post', '/admin/plugins/reorder', requireAuth, checkPermission('plugin:manage'), wrap(async (req, res) => { const service = container.resolve(TOKENS.plugins); const ids = Array.isArray(req.body.ids) ? req.body.ids : []; await Promise.all(ids.map((id: string, index: number) => service.setLoadOrder(id, index * 10))); res.json({ ok: true }); }));
}
