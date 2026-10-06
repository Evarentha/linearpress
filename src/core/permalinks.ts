/*
 * LinearPress Permalink Engine
 *
 * SEO-friendly permalink patterns and route registration.
 *
 * Authors:
 * MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥
 * worryzu <worryzu@gmail.com> @LinearTeam
 *
 * Copyright (C) 2026 Evarentha
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * <code>postUrl()</code> builds reading-page URLs in the configured format,
 * <code>resolvePostParams()</code> maps generic route parameters back to a
 * post id or slug, and the two registration helpers register segment-count
 * generic read/comment patterns (plus the legacy <code>/post/:slug</code>
 * alias), so switching the permalink format takes effect without a restart.
 *
 * @since 2.0.1
 */

import type { RequestHandler } from 'express';
import type { RouterCollector } from './router-collector.js';

export interface PermalinkOption { value: string; label: string; }

/** 路由格式枚举（SEO 友好的 Permalink 结构）。 */
export const PERMALINK_OPTIONS: PermalinkOption[] = [
  { value: '/posts/:slug', label: '/posts/:slug' },
  { value: '/posts/:yyyy/:MM/:dd/:slug', label: '/posts/:yyyy/:MM/:dd/:slug' },
  { value: '/posts/:MM/:dd/:slug', label: '/posts/:MM/:dd/:slug' },
  { value: '/posts/:yyyy/:slug', label: '/posts/:yyyy/:slug' },
  { value: '/posts/:id', label: '/posts/:id' },
  { value: '/posts/:id/:slug', label: '/posts/:id/:slug' },
  { value: '/post-:slug-page.html', label: '/post-:slug-page.html' }
];

const pad = (value: number): string => String(value).padStart(2, '0');

interface PermalinkPost { id: number; slug: string; created_at: string; }

/** 依据站点配置的路由格式生成文章阅读页 URL。 */
export function postUrl(post: PermalinkPost, format: string): string {
  const date = new Date(post.created_at);
  const valid = Number.isNaN(date.getTime());
  const yyyy = String(valid ? new Date().getFullYear() : date.getFullYear());
  const MM = pad(valid ? new Date().getMonth() + 1 : date.getMonth() + 1);
  const dd = pad(valid ? new Date().getDate() : date.getDate());
  switch (format) {
    case '/posts/:yyyy/:MM/:dd/:slug': return `/posts/${yyyy}/${MM}/${dd}/${post.slug}`;
    case '/posts/:MM/:dd/:slug': return `/posts/${MM}/${dd}/${post.slug}`;
    case '/posts/:yyyy/:slug': return `/posts/${yyyy}/${post.slug}`;
    case '/posts/:id': return `/posts/${post.id}`;
    case '/posts/:id/:slug': return `/posts/${post.id}/${post.slug}`;
    case '/post-:slug-page.html': return `/post-${post.slug}-page.html`;
    case '/posts/:slug':
    default: return `/posts/${post.slug}`;
  }
}

/**
 * 从请求参数 + 当前配置解析文章定位信息。
 * 路由只按段数注册通用 pattern，具体是 :id 还是 :yyyy/:MM/:dd 由配置决定，
 * 因此修改 Permalink 格式无需重启即可生效。
 */
export function resolvePostParams(params: Record<string, string | undefined>, format: string): { slug?: string; id?: number } {
  const slug = params.slug;
  const first = params.first;
  const hasDateParts = params.MM !== undefined || params.dd !== undefined || params.yyyy !== undefined;
  if (hasDateParts) return { slug };
  if (first !== undefined) {
    const n = Number(first);
    if (format === '/posts/:id/:slug' && Number.isInteger(n) && n > 0) return { id: n, slug };
    return { slug };
  }
  if (format === '/posts/:id' && slug && /^\d+$/.test(slug)) return { id: Number(slug) };
  return { slug };
}

/**
 * 注册全部通用文章读取路由（按段数区分，不绑定单一格式），
 * 并保留旧版 /post/:slug 兼容别名。
 */
export function registerPermalinkRoutes(router: RouterCollector, handler: RequestHandler): void {
  const patterns = [
    '/posts/:slug',
    '/posts/:first/:slug',
    '/posts/:MM/:dd/:slug',
    '/posts/:yyyy/:MM/:dd/:slug',
    '/post-:slug-page.html',
    '/post/:slug'
  ];
  for (const pattern of patterns) router.register('get', pattern, handler);
}

/** 注册与读取路由对应的评论提交路由。 */
export function registerPermalinkCommentRoutes(router: RouterCollector, handler: RequestHandler): void {
  const patterns = [
    '/posts/:slug/comments',
    '/posts/:first/:slug/comments',
    '/posts/:MM/:dd/:slug/comments',
    '/posts/:yyyy/:MM/:dd/:slug/comments',
    '/post-:slug-page.html/comments',
    '/post/:slug/comments'
  ];
  for (const pattern of patterns) router.register('post', pattern, handler);
}
