import type { Request, Response } from 'express';
import { db } from '../core/database.js';
import type { HookSystem } from '../core/hook-system.js';
import type { RouterCollector } from '../core/router-collector.js';
import type { Block, PostStatus } from '../types/index.js';
import { approvedForPost, createComment, deleteComment, listComments, setCommentStatus } from '../services/comment.service.js';
import { checkPermission, requireAuth } from '../services/permission.service.js';
import { deletePost, findPostById, findPostBySlug, incrementViews, listAll, listPublished, savePost } from '../services/post.service.js';
import { assignUserGroup, authenticate, createSuperAdmin, findUserById, isOobeRequired, listGroups, listUsers, registerUser } from '../services/user.service.js';
import { createGroup, deleteGroup, PERMISSIONS, updateGroup } from '../services/group.service.js';
import type { PluginManager } from '../core/plugin-manager.js';

function parseBlocks(value: unknown): Block[] { try { const parsed = JSON.parse(String(value ?? '[]')) as Block[]; return Array.isArray(parsed) ? parsed : []; } catch { return []; } }
function routeParam(value: string | string[]): string { return Array.isArray(value) ? value[0] ?? '' : value; }
function messageOf(error: unknown): string { return error instanceof Error ? error.message : '操作失败'; }
const wrap = (fn: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response) => { fn(req, res).catch((error) => res.status(500).render('error', { title: '服务器错误', message: messageOf(error) })); };

export function registerCoreRoutes(router: RouterCollector, hooks: HookSystem, plugins?: PluginManager): void {
  router.register('get', '/oobe', (req, res) => { if (!isOobeRequired()) return res.redirect('/'); res.render('auth/oobe', { title: '初始化', error: null }); });
  router.register('post', '/oobe', wrap(async (req, res) => { if (!isOobeRequired()) return void res.redirect('/'); try { const user = await createSuperAdmin(String(req.body.username ?? ''), String(req.body.email ?? ''), String(req.body.password ?? ''), String(req.body.password_confirmation ?? '')); req.session.userId = user.id; res.redirect('/admin'); } catch (error) { res.status(400).render('auth/oobe', { title: '初始化', error: messageOf(error) }); } }));

  router.register('get', '/', (req, res) => res.render('web/index', { title: '文章', posts: listPublished() }));
  router.register('get', '/post/:slug', wrap(async (req, res) => { const post = findPostBySlug(routeParam(req.params.slug)); if (!post || post.status !== 'published') return void res.status(404).render('error', { title: '未找到', message: '文章不存在或尚未发布。' }); incrementViews(post.id); const rendered = await hooks.trigger('post:beforeRender', { post, html: post.html_cache ?? '' }); res.render('web/post', { title: post.title, post, html: rendered.html, comments: approvedForPost(post.id), notice: req.query.notice }); }));
  router.register('post', '/post/:slug/comments', (req, res) => { const post = findPostBySlug(routeParam(req.params.slug)); if (!post) return res.status(404).end(); try { createComment({ postId: post.id, userId: req.session.userId, guestName: req.body.guest_name, guestEmail: req.body.guest_email, content: req.body.content, ip: req.ip }); res.redirect(`/post/${post.slug}?notice=comment-pending`); } catch (error) { res.status(400).render('error', { title: '评论未提交', message: messageOf(error) }); } });

  router.register('get', '/login', (req, res) => res.render('auth/login', { title: '登录', error: null }));
  router.register('post', '/login', wrap(async (req, res) => { const user = await authenticate(req.body.username, req.body.password); if (!user) return void res.status(401).render('auth/login', { title: '登录', error: '用户名或密码错误' }); req.session.userId = user.id; res.redirect('/admin'); }));
  router.register('get', '/register', (req, res) => res.render('auth/register', { title: '注册', error: null }));
  router.register('post', '/register', wrap(async (req, res) => { try { const user = await registerUser(req.body.username, req.body.email, req.body.password); req.session.userId = user.id; res.redirect('/'); } catch (error) { res.status(400).render('auth/register', { title: '注册', error: messageOf(error) }); } }));
  router.register('post', '/logout', (req, res) => req.session.destroy(() => res.redirect('/')));

  router.register('get', '/admin', requireAuth, checkPermission('admin:access'), (req, res) => { const counts = { posts: Number((db.prepare('SELECT COUNT(*) n FROM posts').get() as { n: number }).n), comments: Number((db.prepare('SELECT COUNT(*) n FROM comments').get() as { n: number }).n), pending: Number((db.prepare("SELECT COUNT(*) n FROM comments WHERE status='pending'").get() as { n: number }).n), users: Number((db.prepare('SELECT COUNT(*) n FROM users').get() as { n: number }).n) }; res.render('admin/dashboard', { title: '控制台', counts }); });
  router.register('get', '/admin/posts', requireAuth, checkPermission('post:edit'), (req, res) => res.render('admin/posts', { title: '文章管理', posts: listAll() }));
  router.register('get', '/admin/posts/new', requireAuth, checkPermission('post:create'), (req, res) => res.render('admin/post-edit', { title: '新建文章', post: null }));
  router.register('get', '/admin/posts/:id/edit', requireAuth, checkPermission('post:edit'), (req, res) => res.render('admin/post-edit', { title: '编辑文章', post: findPostById(Number(req.params.id)) }));
  router.register('post', '/admin/posts/save', requireAuth, checkPermission('post:edit'), wrap(async (req, res) => { const draft = { id: Number(req.body.id) || 0, title: String(req.body.title ?? '').trim(), slug: String(req.body.slug ?? '').trim(), content_json: parseBlocks(req.body.content_json), html_cache: null, status: String(req.body.status ?? 'draft') as PostStatus, author_id: req.session.userId!, views: 0, created_at: '', updated_at: null }; const post = await hooks.trigger('post:beforeSave', draft); const saved = savePost({ id: post.id || undefined, title: post.title, slug: post.slug, blocks: post.content_json, status: post.status, authorId: post.author_id }); await hooks.trigger('post:afterSave', saved); res.redirect('/admin/posts'); }));
  router.register('post', '/admin/posts/:id/delete', requireAuth, checkPermission('post:delete'), (req, res) => { deletePost(Number(req.params.id)); res.redirect('/admin/posts'); });

  router.register('get', '/admin/comments', requireAuth, checkPermission('comment:moderate'), (req, res) => res.render('admin/comments', { title: '评论审核', comments: listComments() }));
  router.register('post', '/admin/comments/:id/status', requireAuth, checkPermission('comment:moderate'), (req, res) => { setCommentStatus(Number(req.params.id), req.body.status); res.redirect('/admin/comments'); });
  router.register('post', '/admin/comments/:id/delete', requireAuth, checkPermission('comment:moderate'), (req, res) => { deleteComment(Number(req.params.id)); res.redirect('/admin/comments'); });
  router.register('get', '/admin/users', requireAuth, checkPermission('user:manage'), (req, res) => res.render('admin/users', { title: '用户管理', users: listUsers(), groups: listGroups() }));
  router.register('post', '/admin/users/:id/group', requireAuth, checkPermission('user:manage'), (req, res) => { try { assignUserGroup(Number(req.params.id), Number(req.body.group_id)); res.redirect('/admin/users'); } catch (error) { res.status(400).render('error', { title: '权限组分配失败', message: messageOf(error) }); } });
  router.register('get', '/admin/groups', requireAuth, checkPermission('group:manage'), (req, res) => res.render('admin/groups', { title: '权限组', groups: listGroups(), permissions: PERMISSIONS }));
  router.register('post', '/admin/groups/save', requireAuth, checkPermission('group:manage'), (req, res) => { try { const permissions = Array.isArray(req.body.permissions) ? req.body.permissions : req.body.permissions ? [req.body.permissions] : []; if (req.body.id) updateGroup(Number(req.body.id), String(req.body.name), permissions); else createGroup(String(req.body.name), permissions); res.redirect('/admin/groups'); } catch (error) { res.status(400).render('error', { title: '权限组保存失败', message: messageOf(error) }); } });
  router.register('post', '/admin/groups/:id/delete', requireAuth, checkPermission('group:manage'), (req, res) => { try { deleteGroup(Number(req.params.id)); res.redirect('/admin/groups'); } catch (error) { res.status(400).render('error', { title: '权限组删除失败', message: messageOf(error) }); } });

  router.register('get', '/admin/plugins', requireAuth, checkPermission('plugin:manage'), (req, res) => res.render('admin/plugins', { title: '插件管理', plugins: db.prepare('SELECT * FROM plugins ORDER BY load_order').all() }));
  router.register('post', '/admin/plugins/:id/toggle', requireAuth, checkPermission('plugin:manage'), (req, res) => { db.prepare('UPDATE plugins SET enabled=CASE enabled WHEN 1 THEN 0 ELSE 1 END WHERE id=?').run(routeParam(req.params.id)); res.redirect('/admin/plugins'); });
  router.register('post', '/admin/plugins/:id/uninstall', requireAuth, checkPermission('plugin:manage'), wrap(async (req, res) => { if (!plugins) return void res.status(500).render('error', { title: '插件管理不可用', message: '插件管理器尚未初始化。' }); try { await plugins.uninstall(routeParam(req.params.id)); res.redirect('/admin/plugins'); } catch (error) { res.status(400).render('error', { title: '插件卸载失败', message: messageOf(error) }); } }));
  router.register('post', '/admin/plugins/reorder', requireAuth, checkPermission('plugin:manage'), (req, res) => { const ids = Array.isArray(req.body.ids) ? req.body.ids : []; const update = db.prepare('UPDATE plugins SET load_order=? WHERE id=?'); ids.forEach((id: string, index: number) => update.run(index * 10, id)); res.json({ ok: true }); });
}
