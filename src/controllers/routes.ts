/*
 * LinearPress Core Route Table
 *
 * Registers every core HTTP route of LinearPress onto the Express router.
 *
 * Authors:
 * MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥
 * worryzu <worryzu@gmail.com> @LinearTeam
 *
 * Copyright (C) 2026 Evarentha
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * <p>Registers all built-in routes: the out-of-box experience (OOBE) wizard,
 * the domain-rescue flow, public post reading and comment submission with
 * basic IP rate limiting, authentication, and the admin console covering
 * posts, comments, users, groups, site settings, maintenance mode and plugin
 * management.</p>
 * <p>Services are resolved from the Cordis context per request, so plugins
 * can replace them after bootstrap and the changes apply to core routes.</p>
 *
 * @since 2.0.1
 */

import type { Context } from 'cordis';
import type { Request, Response } from 'express';
import express from 'express';
import bcrypt from 'bcryptjs';
import { DATE_FORMAT_OPTIONS, TIME_FORMAT_OPTIONS } from '../core/datetime.js';
import type { HookSystem } from '../core/hook-system.js';
import { maintenance } from '../core/maintenance.js';
import { PERMALINK_OPTIONS, postUrl, registerPermalinkCommentRoutes, registerPermalinkRoutes, resolvePostParams } from '../core/permalinks.js';
import { requestRestart } from '../core/restart.js';
import { getInstallJob } from '../core/plugin-install-jobs.js';
import { getPluginChangeJob } from '../core/plugin-change-jobs.js';
import type { RouterCollector } from '../core/router-collector.js';
import { LINEARPRESS_VERSION } from '../core/version.js';
import { getBaseConfig } from '../services/config.service.js';
import { checkPermission, requireAuth } from '../services/permission.service.js';
import { validateBlocks } from '../services/post.service.js';
import type { Block, CommentStatus, PostStatus, SiteConfig } from '../types/index.js';
import type { DatabaseService, PluginService } from '../types/services.js';

const BUILTIN_PLUGINS = ['seo', 'minimal-theme'];
function parseBlocks(value: unknown): Block[] {
  if (typeof value !== 'string') throw new Error('缺少正文 JSON');
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error('正文 JSON 无法解析'); }
  validateBlocks(parsed);
  return parsed;
}
function routeParam(value: string | string[]): string { return Array.isArray(value) ? value[0] ?? '' : value; }
function messageOf(error: unknown): string { return error instanceof Error ? error.message : '操作失败'; }
const wrap = (fn: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response) => { fn(req, res).catch((error) => res.status(500).render('error', { title: '服务器错误', message: messageOf(error) })); };

export function registerCoreRoutes(router: RouterCollector, hooks: HookSystem, context: Context): void {
  // 服务在请求时从 Context 解析（与 architecture.md 的契约一致）：
  // 插件在 bootstrap 之后的 activate 阶段或运行期替换服务，对核心路由同样生效。
  // 解析本身是 Cordis reflect 读取，开销可忽略。
  const auth = () => context.auth;
  const posts = () => context.posts;
  const comments = () => context.comments;
  const users = () => context.users;
  const groups = () => context.groups;
  const plugins = () => context.plugins as PluginService;
  const databaseService = () => context.databaseService as DatabaseService;
  const config = () => context.config;

  // ------------------------------------------------------------------ OOBE
  const renderOobe = (res: Response, step: number, error: unknown, site: SiteConfig): void => {
    res.render('auth/oobe', { title: '初始化', step, config: site, error: error ? messageOf(error) : null });
  };

  router.register('get', '/oobe', wrap(async (_req, res) => {
    if (await config().isOobeCompleted()) return void res.redirect('/');
    const adminExists = !(await auth().isOobeRequired());
    const currentUser = _req.session.userId ? await users().findById(_req.session.userId) : undefined;
    let step = Math.min(4, Math.max(1, Number(_req.session.oobeStep) || 1));
    if (adminExists) step = currentUser?.is_super_admin ? Math.max(3, step) : 2;
    _req.session.oobeStep = step;
    renderOobe(res, step, adminExists && !currentUser?.is_super_admin ? new Error('超级管理员已存在，请填写其用户名和密码以继续初始化（不会重新创建账号）。') : null, await config().get());
  }));

  // ------------------------------------------------------------------ 域名急救
  // 该模块用于自动配置关闭且主/备用域名填错时自救：
  // 只验证超级管理员密码（不暴露用户名），成功后仅允许修改域名相关配置。
  const getSuperAdmin = async (): Promise<{ id: number; password_hash: string } | undefined> => {
    return await databaseService().get<{ id: number; password_hash: string }>('SELECT id, password_hash FROM users WHERE is_super_admin=1 LIMIT 1');
  };

  router.register('get', '/rescue', wrap(async (_req, res) => {
    if (_req.session.rescueVerified) return void res.redirect('/rescue/domain');
    res.render('auth/rescue', { title: '域名急救', layout: false, error: null });
  }));

  const verifyRescue = wrap(async (req: Request, res: Response) => {
    const admin = await getSuperAdmin();
    const password = String(req.body.password ?? '');
    const ok = admin ? await bcrypt.compare(password, admin.password_hash) : false;
    if (!ok) {
      res.status(401).render('auth/rescue', { title: '域名急救', layout: false, error: '超级管理员密码错误。' });
      return;
    }
    req.session.rescueVerified = true;
    res.redirect('/rescue/domain');
  });

  router.register('post', '/rescue', verifyRescue);
  router.register('post', '/rescue/verify', verifyRescue);

  const renderRescueDomain = wrap(async (req: Request, res: Response) => {
    if (!req.session.rescueVerified) return void res.redirect('/rescue');
    res.render('auth/rescue-domain', { title: '域名急救 · 域名配置', layout: false, config: await config().get(), notice: req.query.notice ?? '' });
  });

  router.register('get', '/rescue/domain', renderRescueDomain);
  router.register('post', '/rescue/domain', wrap(async (req, res) => {
    if (!req.session.rescueVerified) return void res.redirect('/rescue');
    const raw = req.body.backupDomains;
    const backups = (Array.isArray(raw) ? raw : raw ? [raw] : []).flatMap((value: string) => String(value).split(/\r?\n/)).map((value: string) => String(value).trim()).filter(Boolean);
    await config().set({
      autoDetect: String(req.body.autoDetect) === 'on',
      primaryDomain: String(req.body.primaryDomain ?? '').trim(),
      backupDomains: backups
    });
    res.redirect('/rescue/domain?notice=saved');
  }));

  router.register('post', '/oobe', wrap(async (req, res) => {
    if (await config().isOobeCompleted()) return void res.redirect('/');
    const submitted = Math.min(4, Math.max(1, Number(req.body.step) || 1));
    const site = await config().get();
    try {
      if (submitted === 1) {
        req.session.oobeStep = 2;
        return void res.redirect('/oobe');
      }
      if (submitted === 2) {
        const adminExists = !(await auth().isOobeRequired());
        const user = adminExists
          ? await auth().authenticate(String(req.body.username ?? ''), String(req.body.password ?? ''))
          : await auth().createSuperAdmin(String(req.body.username ?? ''), String(req.body.email ?? ''), String(req.body.password ?? ''), String(req.body.password_confirmation ?? ''));
        if (!user?.is_super_admin) return void res.status(403).render('error', { title: '无法继续初始化', message: '请使用已有超级管理员账号验证' });
        req.session.userId = user.id;
        req.session.oobeStep = 3;
        return void res.redirect('/oobe');
      }
      const currentUser = req.session.userId ? await users().findById(req.session.userId) : undefined;
      if (!currentUser?.is_super_admin) return void res.status(403).render('error', { title: '无法继续初始化', message: '请先验证超级管理员账号' });
      if (submitted > (Number(req.session.oobeStep) || 3)) return void res.status(400).render('error', { title: '初始化步骤无效', message: '请先完成站点设置' });
      if (submitted === 3) {
        await config().set({
          siteName: String(req.body.siteName ?? '').trim() || 'LinearPress',
          siteTitle: String(req.body.siteTitle ?? '').trim(),
          siteSubtitle: String(req.body.siteSubtitle ?? '').trim(),
          siteDescription: String(req.body.siteDescription ?? '').trim()
        });
        req.session.oobeStep = 4;
        return void res.redirect('/oobe');
      }
      if (submitted === 4) {
        await config().completeOobe();
        req.session.oobeStep = undefined;
        return void res.redirect('/admin');
      }
      res.redirect('/oobe');
    } catch (error) {
      renderOobe(res, submitted, error, site);
    }
  }));

  // ------------------------------------------------------- 文章阅读（Permalink）
  const renderPost = wrap(async (req, res) => {
    const { slug, id } = resolvePostParams(req.params as Record<string, string | undefined>, getBaseConfig().permalink);
    const post = id ? await posts().findById(id) : await posts().findBySlug(slug ?? '');
    if (!post || post.status !== 'published') return void res.status(404).render('error', { title: '未找到', message: '文章不存在或尚未发布。' });
    const viewPayload = await hooks.trigger('post:beforeView', { post });
    await posts().incrementViews(viewPayload.post.id);
    await hooks.trigger('post:afterView', viewPayload);
    const rendered = await hooks.trigger('post:beforeRender', { post, html: post.html_cache ?? await posts().render(post.content_json) });
    const postComments = await comments().listForPost(post.id);
    res.render('web/post', { title: post.title, post, html: rendered.html, comments: postComments, notice: req.query.notice });
  });
  registerPermalinkRoutes(router, renderPost);

  // 基础评论限频：同一 IP 每 10 分钟最多 20 条（插件可叠加更严格的策略）。
  const commentHits = new Map<string, number[]>();
  const COMMENT_WINDOW_MS = 10 * 60 * 1000;
  const COMMENT_WINDOW_LIMIT = 20;
  const isCommentRateLimited = (ip: string): boolean => {
    const now = Date.now();
    const hits = (commentHits.get(ip) ?? []).filter((t) => now - t < COMMENT_WINDOW_MS);
    if (hits.length >= COMMENT_WINDOW_LIMIT) { commentHits.set(ip, hits); return true; }
    hits.push(now); commentHits.set(ip, hits);
    if (commentHits.size > 10_000) for (const [key, times] of commentHits) if (!times.some((t) => now - t < COMMENT_WINDOW_MS)) commentHits.delete(key);
    return false;
  };

  const createComment = wrap(async (req, res) => {
    const { slug, id } = resolvePostParams(req.params as Record<string, string | undefined>, getBaseConfig().permalink);
    const post = id ? await posts().findById(id) : await posts().findBySlug(slug ?? '');
    if (!post || post.status !== 'published') return void res.status(404).end();
    if (isCommentRateLimited(String(req.ip ?? 'unknown'))) return void res.status(429).render('error', { title: '操作过于频繁', message: '评论提交过于频繁，请稍后再试。' });
    try {
      await comments().create({ postId: post.id, userId: req.session.userId, guestName: req.body.guest_name, guestEmail: req.body.guest_email, content: String(req.body.content ?? ''), ip: req.ip });
      const site = await config().get();
      res.redirect(`${postUrl(post, site.permalink)}?notice=comment-pending`);
    } catch (error) {
      res.status(400).render('error', { title: '评论未提交', message: messageOf(error) });
    }
  });
  registerPermalinkCommentRoutes(router, createComment);

  const renderArchive = wrap(async (req, res) => {
    const rawPage = req.query.page;
    if (rawPage !== undefined && (typeof rawPage !== 'string' || !/^[1-9]\d*$/.test(rawPage) || !Number.isSafeInteger(Number(rawPage)))) {
      return void res.status(400).render('error', { title: '页码无效', message: 'page 必须是正整数' });
    }
    const pageSize = 20;
    const total = Number((await databaseService().get<{ n: number }>("SELECT COUNT(*) n FROM posts WHERE status='published'"))?.n ?? 0);
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(Number(rawPage ?? 1), pages);
    res.render('web/index', { title: '文章', posts: await posts().listPublished(pageSize, (page - 1) * pageSize), page, pages, total, pageSize });
  });
  router.register('get', '/', renderArchive);
  router.register('get', '/archive', renderArchive);

  // ------------------------------------------------------------------ 认证
  router.register('get', '/login', (_req, res) => res.render('auth/login', { title: '登录', error: null }));
  router.register('post', '/login', wrap(async (req, res) => { const user = await auth().authenticate(req.body.username, req.body.password); if (!user) return void res.status(401).render('auth/login', { title: '登录', error: '用户名或密码错误' }); // 重建会话防止 Session Fixation
  await new Promise<void>((resolve) => req.session.regenerate(() => resolve())); req.session.userId = user.id; res.redirect('/admin'); }));
  router.register('get', '/register', (_req, res) => res.render('auth/register', { title: '注册', error: null }));
  router.register('post', '/register', wrap(async (req, res) => {
    try {
      const user = await users().register(String(req.body.username ?? ''), req.body.email ? String(req.body.email) : null, String(req.body.password ?? ''));
      await new Promise<void>((resolve) => req.session.regenerate(() => resolve()));
      req.session.userId = user.id; res.redirect('/');
    } catch (error) {
      // 数据库唯一约束错误转为友好提示，避免泄露内部实现细节。
      const raw = messageOf(error);
      const friendly = /users\.username/.test(raw) ? '用户名已被占用，请换一个试试。' : /users\.email/.test(raw) ? '该邮箱已被注册。' : raw;
      res.status(400).render('auth/register', { title: '注册', error: friendly });
    }
  }));
  router.register('post', '/logout', wrap(async (req, res) => { await hooks.trigger('auth:beforeLogout', { userId: req.session.userId }); req.session.destroy(() => res.redirect('/')); }));

  // ------------------------------------------------------------------ 控制台
  router.register('get', '/admin', requireAuth, checkPermission('admin:access'), wrap(async (_req, res) => {
    const counts = { posts: (await databaseService().get<{ n: number }>('SELECT COUNT(*) n FROM posts'))!.n, comments: (await databaseService().get<{ n: number }>('SELECT COUNT(*) n FROM comments'))!.n, pending: (await databaseService().get<{ n: number }>("SELECT COUNT(*) n FROM comments WHERE status='pending'"))!.n, users: (await databaseService().get<{ n: number }>('SELECT COUNT(*) n FROM users'))!.n };
    res.render('admin/dashboard', { title: '控制台', counts });
  }));
  router.register('get', '/admin/about', requireAuth, checkPermission('admin:access'), (_req, res) => res.render('admin/about', { title: '关于', version: LINEARPRESS_VERSION }));
  router.register('get', '/admin/posts', requireAuth, checkPermission('post:edit'), wrap(async (_req, res) => res.render('admin/posts', { title: '文章管理', posts: await posts().list() })));
  router.register('get', '/admin/posts/new', requireAuth, checkPermission('post:create'), (_req, res) => res.render('admin/post-edit', { title: '新建文章', post: null }));
  router.register('get', '/admin/posts/:id/edit', requireAuth, checkPermission('post:edit'), wrap(async (req, res) => res.render('admin/post-edit', { title: '编辑文章', post: await posts().findById(Number(req.params.id)) })));
  router.register('post', '/admin/posts/save', requireAuth, wrap(async (req, res) => {
    const rawId = req.body.id;
    const id = rawId === undefined || rawId === '' || rawId === '0' || rawId === 0 ? undefined : Number(rawId);
    if (id !== undefined && (!Number.isSafeInteger(id) || id <= 0)) return void res.status(400).render('error', { title: '保存失败', message: '文章 ID 无效' });
    if (!await context.permissions.has(req.session.userId!, id ? 'post:edit' : 'post:create')) return void res.status(403).render('error', { title: '无权限', message: '没有执行此操作的权限' });
    const existing = id ? await posts().findById(id) : undefined;
    if (id && !existing) return void res.status(404).render('error', { title: '未找到', message: '文章不存在' });
    try {
      const authorId = req.body.author_id === undefined ? existing?.author_id ?? req.session.userId! : Number(req.body.author_id);
      if (!Number.isSafeInteger(authorId) || authorId <= 0 || !await users().findById(authorId)) throw new Error('作者不存在');
      const status = String(req.body.status ?? 'draft');
      if (!['draft', 'published', 'archived'].includes(status)) throw new Error('文章状态无效');
      await posts().save({ id, title: String(req.body.title ?? ''), slug: String(req.body.slug ?? ''), blocks: parseBlocks(req.body.content_json), status: status as PostStatus, authorId });
      res.redirect('/admin/posts');
    } catch (error) { res.status(400).render('error', { title: '保存失败', message: messageOf(error) }); }
  }));
  router.register('post', '/admin/posts/:id/delete', requireAuth, checkPermission('post:delete'), wrap(async (req, res) => { await posts().remove(Number(req.params.id)); res.redirect('/admin/posts'); }));

  router.register('get', '/admin/comments', requireAuth, checkPermission('comment:moderate'), wrap(async (_req, res) => res.render('admin/comments', { title: '评论审核', comments: await comments().list() })));
  router.register('post', '/admin/comments/:id/status', requireAuth, checkPermission('comment:moderate'), wrap(async (req, res) => { await comments().setStatus(Number(req.params.id), String(req.body.status) as CommentStatus); res.redirect('/admin/comments'); }));
  router.register('post', '/admin/comments/:id/delete', requireAuth, checkPermission('comment:moderate'), wrap(async (req, res) => { await comments().remove(Number(req.params.id)); res.redirect('/admin/comments'); }));

  router.register('get', '/admin/users', requireAuth, checkPermission('user:manage'), wrap(async (_req, res) => res.render('admin/users', { title: '用户管理', users: await users().list(), groups: await users().listGroups() })));
  router.register('post', '/admin/users/:id/group', requireAuth, checkPermission('user:manage'), wrap(async (req, res) => { try { await users().assignGroup(Number(req.params.id), Number(req.body.group_id)); res.redirect('/admin/users'); } catch (error) { res.status(400).render('error', { title: '权限组分配失败', message: messageOf(error) }); } }));
  router.register('get', '/admin/groups', requireAuth, checkPermission('group:manage'), wrap(async (_req, res) => res.render('admin/groups', { title: '权限组', groups: await groups().list(), permissions: await groups().permissions() })));
  router.register('post', '/admin/groups/save', requireAuth, checkPermission('group:manage'), wrap(async (req, res) => { try { const permissions = Array.isArray(req.body.permissions) ? req.body.permissions : req.body.permissions ? [req.body.permissions] : []; if (req.body.id) await groups().update(Number(req.body.id), String(req.body.name ?? ''), permissions); else await groups().create(String(req.body.name ?? ''), permissions); res.redirect('/admin/groups'); } catch (error) { res.status(400).render('error', { title: '权限组保存失败', message: messageOf(error) }); } }));
  router.register('post', '/admin/groups/:id/delete', requireAuth, checkPermission('group:manage'), wrap(async (req, res) => { try { await groups().remove(Number(req.params.id)); res.redirect('/admin/groups'); } catch (error) { res.status(400).render('error', { title: '权限组删除失败', message: messageOf(error) }); } }));

  // ------------------------------------------------------------------ 站点设置
  router.register('get', '/admin/settings', requireAuth, checkPermission('site:manage'), wrap(async (_req, res) => {
    res.render('admin/settings', { title: '站点设置', config: await config().get(), permalinkOptions: PERMALINK_OPTIONS, dateFormatOptions: DATE_FORMAT_OPTIONS, timeFormatOptions: TIME_FORMAT_OPTIONS, notice: _req.query.notice ?? '' });
  }));
  router.register('post', '/admin/settings/site', requireAuth, checkPermission('site:manage'), wrap(async (req, res) => {
    await config().set({ siteName: String(req.body.siteName ?? '').trim() || 'LinearPress', siteTitle: String(req.body.siteTitle ?? '').trim(), siteSubtitle: String(req.body.siteSubtitle ?? '').trim(), siteDescription: String(req.body.siteDescription ?? '').trim() });
    res.redirect('/admin/settings?notice=saved');
  }));
  router.register('post', '/admin/settings/datetime', requireAuth, checkPermission('site:manage'), wrap(async (req, res) => {
    await config().set({ timeSource: String(req.body.timeSource ?? 'SYSTEM').trim() || 'SYSTEM', dateFormat: String(req.body.dateFormat ?? 'zh-full'), timeFormat: (String(req.body.timeFormat) === '12-hour' ? '12-hour' : '24-hour') as SiteConfig['timeFormat'] });
    res.redirect('/admin/settings?notice=saved');
  }));
  router.register('post', '/admin/settings/domain', requireAuth, checkPermission('site:manage'), wrap(async (req, res) => {
    const raw = req.body.backupDomains;
    const backups = (Array.isArray(raw) ? raw : raw ? [raw] : []).map((value: string) => String(value).trim()).filter(Boolean);
    await config().set({ autoDetect: String(req.body.autoDetect) === 'on', primaryDomain: String(req.body.primaryDomain ?? '').trim(), backupDomains: backups });
    res.redirect('/admin/settings?notice=saved');
  }));
  router.register('post', '/admin/settings/permalink', requireAuth, checkPermission('site:manage'), wrap(async (req, res) => {
    const value = String(req.body.permalink ?? '/posts/:slug');
    await config().set({ permalink: PERMALINK_OPTIONS.some((item) => item.value === value) ? value : '/posts/:slug' });
    res.redirect('/admin/settings?notice=saved');
  }));
  router.register('post', '/admin/settings/footer', requireAuth, checkPermission('site:manage'), wrap(async (req, res) => {
    await config().set({
      footerCopyright: (['powered-by', 'running-on', 'none'].includes(String(req.body.footerCopyright)) ? String(req.body.footerCopyright) : 'powered-by') as SiteConfig['footerCopyright'],
      icpProvince: String(req.body.icpProvince ?? '').trim(),
      icpNumber: String(req.body.icpNumber ?? '').trim(),
      policeNumber: String(req.body.policeNumber ?? '').trim(),
      footerHtml: String(req.body.footerHtml ?? '')
    });
    res.redirect('/admin/settings?notice=saved');
  }));

  // ------------------------------------------------------------------ 维护模式
  router.register('post', '/admin/maintenance/toggle', requireAuth, checkPermission('site:manage'), (_req, res) => {
    if (maintenance.isEnabled()) maintenance.exit();
    else maintenance.enter('manual');
    res.redirect('/admin/settings?notice=maintenance');
  });

  // ------------------------------------------------------------------ 插件管理
  router.register('get', '/admin/plugins', requireAuth, checkPermission('plugin:manage'), wrap(async (_req, res) => res.render('admin/plugins', { title: '插件管理', plugins: await plugins().list(), builtinPlugins: BUILTIN_PLUGINS })));
  router.register('get', '/admin/plugins/:id/settings', requireAuth, checkPermission('plugin:manage'), wrap(async (req, res) => {
    const id = routeParam(req.params.id);
    const list = await plugins().list();
    const plugin = list.find((item) => item.id === id);
    if (!plugin) return void res.status(404).render('error', { title: '插件不存在', message: id });
    const value = await plugins().getConfig<Record<string, unknown>>(id);
    res.render('admin/plugin-settings', { title: `${plugin.name} 设置`, plugin, configJson: value ? JSON.stringify(value, null, 2) : '{}', notice: req.query.notice ?? '' });
  }));
  router.register('post', '/admin/plugins/:id/settings', requireAuth, checkPermission('plugin:manage'), wrap(async (req, res) => {
    const id = routeParam(req.params.id);
    let parsed: unknown;
    try { parsed = JSON.parse(String(req.body.config ?? '{}')); }
    catch { return void res.status(400).render('error', { title: '配置无效', message: 'JSON 无法解析' }); }
    await plugins().setConfig(id, parsed);
    res.redirect(`/admin/plugins/${id}/settings?notice=saved`);
  }));
  router.register('post', '/admin/plugins/:id/toggle', requireAuth, checkPermission('plugin:manage'), wrap(async (req, res) => { const id = routeParam(req.params.id); const plugin = (await plugins().list()).find((item) => item.id === id); if (!plugin) return void res.status(404).render('error', { title: '插件不存在', message: id }); try { const result = await plugins().applyChange({id,enabled:!plugin.enabled}); res.status(202).json({ok:true,jobId:result.job.id,statusUrl:result.statusUrl,message:result.job.message}); } catch(error) { res.status((error as {status?:number}).status===409?409:400).json({ok:false,message:messageOf(error)}); } }));
  router.register('post', '/admin/plugins/:id/uninstall', requireAuth, checkPermission('plugin:manage'), wrap(async (req, res) => { try { await plugins().uninstall(routeParam(req.params.id)); res.redirect('/admin/plugins'); } catch (error) { res.status(400).render('error', { title: '插件卸载失败', message: messageOf(error) }); } }));
  router.register('post', '/admin/plugins/reorder', requireAuth, checkPermission('plugin:manage'), wrap(async (req, res) => { const ids = Array.isArray(req.body.ids) ? req.body.ids : []; try { const result = await plugins().applyChange({ids}); res.status(202).json({ok:true,jobId:result.job.id,statusUrl:result.statusUrl,message:result.job.message}); } catch(error) { res.status((error as {status?:number}).status===409?409:400).json({ok:false,message:messageOf(error)}); } }));
  router.register('post', '/admin/plugins/restart', requireAuth, checkPermission('plugin:manage'), (_req, res) => {
    maintenance.enter('update');
    res.status(202).json({ ok: true, restarting: true, message: '项目正在重启，页面将在稍后重新加载。' });
    requestRestart();
  });
  router.register('post', '/admin/plugins/install-npm', requireAuth, checkPermission('plugin:manage'), wrap(async (req, res) => {
    const spec = String((req.body as Record<string, unknown> | undefined)?.package ?? '').trim();
    if (!spec) return void res.status(400).json({ ok: false, message: '请输入 npm 包名' });
    if (!/^(@[a-zA-Z0-9._-]+\/)?[a-zA-Z0-9._-]+(@[a-zA-Z0-9._-]+)?$/.test(spec)) return void res.status(400).json({ ok: false, message: '包名格式应为 @scope/plugin-name（可选 @version）' });
    try { const result = await plugins().installNpm(spec); res.status(202).json({ ok: true, jobId: result.job.id, statusUrl: result.statusUrl, message: result.job.message }); }
    catch (error) { res.status((error as { status?: number }).status === 409 ? 409 : 400).json({ ok: false, message: messageOf(error) }); }
  }));
  router.register('get', '/admin/plugins/change-jobs/:id', requireAuth, checkPermission('plugin:manage'), (req,res) => {
    res.setHeader('Cache-Control','no-store'); const job=getPluginChangeJob(routeParam(req.params.id));
    if(!job)return void res.status(404).json({ok:false,message:'插件变更任务不存在'});
    res.json({ok:true,job});
  });
  router.register('get', '/admin/plugins/install-jobs/:id', requireAuth, checkPermission('plugin:manage'), (req, res) => {
    const job = getInstallJob(routeParam(req.params.id));
    res.setHeader('Cache-Control', 'no-store');
    if (!job) return void res.status(404).json({ ok: false, message: '安装任务不存在或已过期' });
    res.json({ ok: true, job });
  });
  router.register('post', '/admin/plugins/install-lpp', requireAuth, checkPermission('plugin:manage'), express.raw({ type: ['application/vnd.linearpress.plugin+zip', 'application/zip', 'application/octet-stream'], limit: '64mb' }), wrap(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) return void res.status(400).json({ ok: false, message: '请上传 .lpp 插件包' });
    try { const result = await plugins().installLpp(req.body); res.status(202).json({ ok: true, jobId: result.job.id, statusUrl: result.statusUrl, message: result.job.message }); }
    catch (error) { res.status((error as { status?: number }).status === 409 ? 409 : 400).json({ ok: false, message: messageOf(error) }); }
  }));
  router.register('post', '/admin/plugins/install-zip', requireAuth, checkPermission('plugin:manage'), express.raw({ type: ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'], limit: '64mb' }), wrap(async (req, res) => {
    const buffer = req.body as Buffer;
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) return void res.status(400).json({ ok: false, message: '请上传 .zip 压缩包' });
    try { const result = await plugins().installZip(buffer); res.status(202).json({ ok: true, jobId: result.job.id, statusUrl: result.statusUrl, message: result.job.message }); }
    catch (error) { res.status((error as { status?: number }).status === 409 ? 409 : 400).json({ ok: false, message: messageOf(error) }); }
  }));
}
