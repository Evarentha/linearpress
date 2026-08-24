/*
 * Author: MoyuZJ
 * Team: LinearTeam
 * Contact: linearteam@foxmail.com
 * Made by MoyuZJ in China with ♥
 */

import type { Context } from 'cordis';
import type { Request, Response } from 'express';
import express from 'express';
import type { HookSystem } from '../core/hook-system.js';
import type { RouterCollector } from '../core/router-collector.js';
import { requestRestart } from '../core/restart.js';
import { checkPermission, requireAuth } from '../services/permission.service.js';
import type { Block, CommentStatus, PostStatus } from '../types/index.js';
import type { DatabaseService, PluginService } from '../types/services.js';

const BUILTIN_PLUGINS = ['seo', 'minimal-theme'];
function parseBlocks(value: unknown): Block[] { try { const parsed = JSON.parse(String(value ?? '[]')) as Block[]; return Array.isArray(parsed) ? parsed : []; } catch { return []; } }
function routeParam(value: string | string[]): string { return Array.isArray(value) ? value[0] ?? '' : value; }
function messageOf(error: unknown): string { return error instanceof Error ? error.message : '操作失败'; }
const wrap = (fn: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response) => { fn(req, res).catch((error) => res.status(500).render('error', { title: '服务器错误', message: messageOf(error) })); };

export function registerCoreRoutes(router: RouterCollector, hooks: HookSystem, context: Context): void {
  const auth = context.auth;
  const posts = context.posts;
  const comments = context.comments;
  const users = context.users;
  const groups = context.groups;
  const plugins = context.plugins as PluginService;
  const databaseService = context.databaseService as DatabaseService;

  router.register('get', '/oobe', wrap(async (_req, res) => { if (!await auth.isOobeRequired()) return void res.redirect('/'); res.render('auth/oobe', { title: '初始化', error: null }); }));
  router.register('post', '/oobe', wrap(async (req, res) => {
    if (!await auth.isOobeRequired()) return void res.redirect('/');
    try { const user = await auth.createSuperAdmin(String(req.body.username ?? ''), String(req.body.email ?? ''), String(req.body.password ?? ''), String(req.body.password_confirmation ?? '')); req.session.userId = user.id; res.redirect('/admin'); }
    catch (error) { res.status(400).render('auth/oobe', { title: '初始化', error: messageOf(error) }); }
  }));

  router.register('get', '/', wrap(async (_req, res) => res.render('web/index', { title: '文章', posts: await posts.listPublished() })));
  router.register('get', '/post/:slug', wrap(async (req, res) => {
    const post = await posts.findBySlug(routeParam(req.params.slug));
    if (!post || post.status !== 'published') return void res.status(404).render('error', { title: '未找到', message: '文章不存在或尚未发布。' });
    const viewPayload = await hooks.trigger('post:beforeView', { post });
    await posts.incrementViews(viewPayload.post.id);
    await hooks.trigger('post:afterView', viewPayload);
    const rendered = await hooks.trigger('post:beforeRender', { post, html: post.html_cache ?? await posts.render(post.content_json) });
    const postComments = await comments.listForPost(post.id);
    res.render('web/post', { title: post.title, post, html: rendered.html, comments: postComments, notice: req.query.notice });
  }));
  router.register('post', '/post/:slug/comments', wrap(async (req, res) => {
    const post = await posts.findBySlug(routeParam(req.params.slug));
    if (!post) return void res.status(404).end();
    try { await comments.create({ postId: post.id, userId: req.session.userId, guestName: req.body.guest_name, guestEmail: req.body.guest_email, content: String(req.body.content ?? ''), ip: req.ip }); res.redirect(`/post/${post.slug}?notice=comment-pending`); }
    catch (error) { res.status(400).render('error', { title: '评论未提交', message: messageOf(error) }); }
  }));

  router.register('get', '/login', (_req, res) => res.render('auth/login', { title: '登录', error: null }));
  router.register('post', '/login', wrap(async (req, res) => { const user = await auth.authenticate(req.body.username, req.body.password); if (!user) return void res.status(401).render('auth/login', { title: '登录', error: '用户名或密码错误' }); req.session.userId = user.id; res.redirect('/admin'); }));
  router.register('get', '/register', (_req, res) => res.render('auth/register', { title: '注册', error: null }));
  router.register('post', '/register', wrap(async (req, res) => { try { const user = await users.register(String(req.body.username ?? ''), req.body.email ? String(req.body.email) : null, String(req.body.password ?? '')); req.session.userId = user.id; res.redirect('/'); } catch (error) { res.status(400).render('auth/register', { title: '注册', error: messageOf(error) }); } }));
  router.register('post', '/logout', wrap(async (req, res) => { await hooks.trigger('auth:beforeLogout', { userId: req.session.userId }); req.session.destroy(() => res.redirect('/')); }));

  router.register('get', '/admin', requireAuth, checkPermission('admin:access'), wrap(async (_req, res) => {
    const counts = { posts: (await databaseService.get<{ n: number }>('SELECT COUNT(*) n FROM posts'))!.n, comments: (await databaseService.get<{ n: number }>('SELECT COUNT(*) n FROM comments'))!.n, pending: (await databaseService.get<{ n: number }>("SELECT COUNT(*) n FROM comments WHERE status='pending'"))!.n, users: (await databaseService.get<{ n: number }>('SELECT COUNT(*) n FROM users'))!.n };
    res.render('admin/dashboard', { title: '控制台', counts });
  }));
  router.register('get', '/admin/posts', requireAuth, checkPermission('post:edit'), wrap(async (_req, res) => res.render('admin/posts', { title: '文章管理', posts: await posts.list() })));
  router.register('get', '/admin/posts/new', requireAuth, checkPermission('post:create'), (_req, res) => res.render('admin/post-edit', { title: '新建文章', post: null }));
  router.register('get', '/admin/posts/:id/edit', requireAuth, checkPermission('post:edit'), wrap(async (req, res) => res.render('admin/post-edit', { title: '编辑文章', post: await posts.findById(Number(req.params.id)) })));
  router.register('post', '/admin/posts/save', requireAuth, checkPermission('post:edit'), wrap(async (req, res) => { await posts.save({ id: Number(req.body.id) || undefined, title: String(req.body.title ?? ''), slug: String(req.body.slug ?? ''), blocks: parseBlocks(req.body.content_json), status: String(req.body.status ?? 'draft') as PostStatus, authorId: req.session.userId! }); res.redirect('/admin/posts'); }));
  router.register('post', '/admin/posts/:id/delete', requireAuth, checkPermission('post:delete'), wrap(async (req, res) => { await posts.remove(Number(req.params.id)); res.redirect('/admin/posts'); }));

  router.register('get', '/admin/comments', requireAuth, checkPermission('comment:moderate'), wrap(async (_req, res) => res.render('admin/comments', { title: '评论审核', comments: await comments.list() })));
  router.register('post', '/admin/comments/:id/status', requireAuth, checkPermission('comment:moderate'), wrap(async (req, res) => { await comments.setStatus(Number(req.params.id), String(req.body.status) as CommentStatus); res.redirect('/admin/comments'); }));
  router.register('post', '/admin/comments/:id/delete', requireAuth, checkPermission('comment:moderate'), wrap(async (req, res) => { await comments.remove(Number(req.params.id)); res.redirect('/admin/comments'); }));

  router.register('get', '/admin/users', requireAuth, checkPermission('user:manage'), wrap(async (_req, res) => res.render('admin/users', { title: '用户管理', users: await users.list(), groups: await users.listGroups() })));
  router.register('post', '/admin/users/:id/group', requireAuth, checkPermission('user:manage'), wrap(async (req, res) => { try { await users.assignGroup(Number(req.params.id), Number(req.body.group_id)); res.redirect('/admin/users'); } catch (error) { res.status(400).render('error', { title: '权限组分配失败', message: messageOf(error) }); } }));
  router.register('get', '/admin/groups', requireAuth, checkPermission('group:manage'), wrap(async (_req, res) => res.render('admin/groups', { title: '权限组', groups: await groups.list(), permissions: await groups.permissions() })));
  router.register('post', '/admin/groups/save', requireAuth, checkPermission('group:manage'), wrap(async (req, res) => { try { const permissions = Array.isArray(req.body.permissions) ? req.body.permissions : req.body.permissions ? [req.body.permissions] : []; if (req.body.id) await groups.update(Number(req.body.id), String(req.body.name ?? ''), permissions); else await groups.create(String(req.body.name ?? ''), permissions); res.redirect('/admin/groups'); } catch (error) { res.status(400).render('error', { title: '权限组保存失败', message: messageOf(error) }); } }));
  router.register('post', '/admin/groups/:id/delete', requireAuth, checkPermission('group:manage'), wrap(async (req, res) => { try { await groups.remove(Number(req.params.id)); res.redirect('/admin/groups'); } catch (error) { res.status(400).render('error', { title: '权限组删除失败', message: messageOf(error) }); } }));

  router.register('get', '/admin/plugins', requireAuth, checkPermission('plugin:manage'), wrap(async (_req, res) => res.render('admin/plugins', { title: '插件管理', plugins: await plugins.list(), builtinPlugins: BUILTIN_PLUGINS })));
  router.register('post', '/admin/plugins/:id/toggle', requireAuth, checkPermission('plugin:manage'), wrap(async (req, res) => { const id = routeParam(req.params.id); const plugin = (await plugins.list()).find((item) => item.id === id); if (!plugin) return void res.status(404).render('error', { title: '插件不存在', message: id }); await plugins.setEnabled(id, !plugin.enabled); res.redirect('/admin/plugins'); }));
  router.register('post', '/admin/plugins/:id/uninstall', requireAuth, checkPermission('plugin:manage'), wrap(async (req, res) => { try { await plugins.uninstall(routeParam(req.params.id)); res.redirect('/admin/plugins'); } catch (error) { res.status(400).render('error', { title: '插件卸载失败', message: messageOf(error) }); } }));
  router.register('post', '/admin/plugins/reorder', requireAuth, checkPermission('plugin:manage'), wrap(async (req, res) => { const ids = Array.isArray(req.body.ids) ? req.body.ids : []; await Promise.all(ids.map((id: string, index: number) => plugins.setLoadOrder(id, index * 10))); res.json({ ok: true }); }));
  router.register('post', '/admin/plugins/restart', requireAuth, checkPermission('plugin:manage'), (_req, res) => {
    res.status(202).json({ ok: true, restarting: true, message: '项目正在重启，页面将在稍后重新加载。' });
    requestRestart();
  });
  router.register('post', '/admin/plugins/install-npm', requireAuth, checkPermission('plugin:manage'), wrap(async (req, res) => {
    const spec = String((req.body as Record<string, unknown> | undefined)?.package ?? '').trim();
    if (!spec) return void res.status(400).json({ ok: false, message: '请输入 npm 包名' });
    try { const plugin = await plugins.installNpm(spec); res.json({ ok: true, plugin }); }
    catch (error) { res.status(400).json({ ok: false, message: messageOf(error) }); }
  }));
  router.register('post', '/admin/plugins/install-zip', requireAuth, checkPermission('plugin:manage'), express.raw({ type: ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'], limit: '64mb' }), wrap(async (req, res) => {
    const buffer = req.body as Buffer;
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) return void res.status(400).json({ ok: false, message: '请上传 .zip 压缩包' });
    try { const plugin = await plugins.installZip(buffer); res.json({ ok: true, plugin }); }
    catch (error) { res.status(400).json({ ok: false, message: messageOf(error) }); }
  }));
}
