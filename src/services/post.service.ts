/*
 * Author: MoyuZJ
 * Team: LinearTeam
 * Contact: linearteam@foxmail.com
 * Made by MoyuZJ in China with ♥
 */

import { renderBlocks } from '../core/block-registry.js';
import { db } from '../core/database.js';
import type { Block, Post, PostStatus } from '../types/index.js';

export { renderBlocks };
interface PostRow extends Omit<Post, 'content_json'> { content_json: string; }
function hydrate(row: PostRow | undefined): Post | undefined { return row ? { ...row, content_json: JSON.parse(row.content_json) as Block[] } : undefined; }
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
export function listPublished(limit = 20, offset = 0): Post[] { return (db.prepare("SELECT * FROM posts WHERE status='published' ORDER BY created_at DESC LIMIT ? OFFSET ?").all(limit, offset) as PostRow[]).map((row) => hydrate(row)!); }
export function listAll(): Array<Post & { author_name: string }> { return (db.prepare('SELECT posts.*, users.username AS author_name FROM posts JOIN users ON users.id=posts.author_id ORDER BY posts.created_at DESC').all() as Array<PostRow & { author_name: string }>).map((row) => ({ ...hydrate(row)!, author_name: row.author_name })); }
export function findPostBySlug(slug: string): Post | undefined { return hydrate(db.prepare('SELECT * FROM posts WHERE slug=?').get(slug) as PostRow | undefined); }
export function findPostById(id: number): Post | undefined { return hydrate(db.prepare('SELECT * FROM posts WHERE id=?').get(id) as PostRow | undefined); }
export function savePost(input: { id?: number; title: string; slug: string; blocks: Block[]; status: PostStatus; authorId: number }): Post {
  const title = input.title.trim();
  if (!title) throw new Error('文章标题不能为空');
  const slug = uniquePostSlug(input.slug, title, input.id);
  const html = renderBlocks(input.blocks); const json = JSON.stringify(input.blocks);
  if (input.id) db.prepare('UPDATE posts SET title=?,slug=?,content_json=?,html_cache=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(title, slug, json, html, input.status, input.id);
  else input.id = Number(db.prepare('INSERT INTO posts(title,slug,content_json,html_cache,status,author_id) VALUES(?,?,?,?,?,?)').run(title, slug, json, html, input.status, input.authorId).lastInsertRowid);
  return findPostById(input.id)!;
}
export function deletePost(id: number): void { db.prepare('DELETE FROM posts WHERE id=?').run(id); }
export function incrementViews(id: number): void { db.prepare('UPDATE posts SET views=views+1 WHERE id=?').run(id); }
