/*
 * LinearPress Post Data Service
 *
 * Post persistence, slug generation and HTML render caching.
 *
 * Authors:
 * MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥
 * worryzu <worryzu@gmail.com> @LinearTeam
 *
 * Copyright (C) 2026 Evarentha
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * CRUD and listing queries over the <code>posts</code> table with block
 * content hydrated from JSON, Unicode-aware slug generation with
 * uniqueness suffixes, HTML cache rendering through the block registry on
 * save, and per-post view counting.
 *
 * @since 2.0.1
 */

import { renderBlocks } from '../core/block-registry.js';
import { db } from '../core/database.js';
import type { Block, Post, PostStatus } from '../types/index.js';

export { renderBlocks };
interface PostRow extends Omit<Post, 'content_json'> { content_json: string; }
function hydrate(row: PostRow | undefined): Post | undefined {
  if (!row) return undefined;
  const content_json = JSON.parse(row.content_json) as Block[];
  return { ...row, content_json, html_cache: row.html_cache?.includes('LP-MODERN-BLOCK::') ? renderBlocks(content_json) : row.html_cache };
}
export function generateSlug(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{Mark}+/gu, '')
    .toLocaleLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}
export function uniquePostSlug(value: string, title: string, postId?: number): string {
  const base = generateSlug(value) || generateSlug(title) || 'post';
  let candidate = base;
  let suffix = 2;
  const exists = db.prepare('SELECT id FROM posts WHERE slug=? AND id<>?');
  while (exists.get(candidate, postId ?? 0)) candidate = `${base}-${suffix++}`;
  return candidate;
}
export function listPublished(limit = 20, offset = 0): Post[] { return (db.prepare("SELECT * FROM posts WHERE status='published' ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?").all(limit, offset) as PostRow[]).map((row) => hydrate(row)!); }
/** Validate built-in fields while preserving plugin-defined block schemas. */
export function validateBlocks(value: unknown): asserts value is Block[] {
  if (!Array.isArray(value)) throw new Error('正文必须是区块数组');
  for (const block of value) {
    if (!block || typeof block !== 'object' || Array.isArray(block) || typeof block.type !== 'string' || !block.type.trim()) throw new Error('区块必须包含有效 type');
    if (['paragraph', 'heading', 'blockquote', 'custom-html'].includes(block.type) && typeof block.content !== 'string') throw new Error('文本区块必须包含字符串 content');
    if (block.type === 'heading' && ![1, 2, 3].includes(block.level)) throw new Error('标题区块 level 必须是 1、2 或 3');
    if (block.type === 'image' && (typeof block.src !== 'string' || (block.alt !== undefined && typeof block.alt !== 'string'))) throw new Error('图片区块字段无效');
  }
}
export function listAll(): Array<Post & { author_name: string }> { return (db.prepare('SELECT posts.*, users.username AS author_name FROM posts JOIN users ON users.id=posts.author_id ORDER BY posts.created_at DESC').all() as Array<PostRow & { author_name: string }>).map((row) => ({ ...hydrate(row)!, author_name: row.author_name })); }
export function findPostBySlug(slug: string): Post | undefined { return hydrate(db.prepare('SELECT * FROM posts WHERE slug=?').get(slug) as PostRow | undefined); }
export function findPostById(id: number): Post | undefined { return hydrate(db.prepare('SELECT * FROM posts WHERE id=?').get(id) as PostRow | undefined); }
export function savePost(input: { id?: number; title: string; slug: string; blocks: Block[]; status: PostStatus; authorId: number; postType?: 'post' | 'shuoshuo' }): Post {
  validateBlocks(input.blocks);
  if (!['draft', 'published', 'archived'].includes(input.status)) throw new Error('文章状态无效');
  const existing = input.id ? findPostById(input.id) : undefined;
  if (input.id && !existing) throw new Error('文章不存在');
  const isShuoshuo = existing?.slug.startsWith('reserved_shuoshuo_') || input.postType === 'shuoshuo';
  const title = input.title.trim();
  if (!title && !isShuoshuo) throw new Error('文章标题不能为空');
  if (isShuoshuo && !/^reserved_shuoshuo_[a-zA-Z0-9_-]+$/.test(existing?.slug ?? input.slug)) throw new Error('说说标识无效');
  const slug = isShuoshuo ? existing?.slug ?? input.slug : uniquePostSlug(input.slug, title, input.id);
  const html = renderBlocks(input.blocks); const json = JSON.stringify(input.blocks);
  if (input.id) db.prepare('UPDATE posts SET title=?,slug=?,content_json=?,html_cache=?,status=?,author_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(title, slug, json, html, input.status, input.authorId, input.id);
  else input.id = Number(db.prepare('INSERT INTO posts(title,slug,content_json,html_cache,status,author_id) VALUES(?,?,?,?,?,?)').run(title, slug, json, html, input.status, input.authorId).lastInsertRowid);
  return findPostById(input.id)!;
}
export function deletePost(id: number): void { db.prepare('DELETE FROM posts WHERE id=?').run(id); }
export function incrementViews(id: number): void { db.prepare('UPDATE posts SET views=views+1 WHERE id=?').run(id); }
