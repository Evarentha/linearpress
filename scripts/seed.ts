/*
 * Author: MoyuZJ
 * Team: LinearTeam
 * Contact: linearteam@foxmail.com
 * Made by MoyuZJ in China with ♥
 */

import { db, runMigrations } from '../src/core/database.js';
import { renderBlocks } from '../src/services/post.service.js';

runMigrations();
const superAdmin = db.prepare('SELECT id FROM users WHERE is_super_admin=1').get() as { id: number } | undefined;
if (!superAdmin) {
  console.log('Seed skipped: complete OOBE before adding sample content.');
  db.close();
  process.exit(0);
}
const exists = db.prepare("SELECT id FROM posts WHERE slug='welcome'").get();
if (!exists) {
  const blocks = [{ type: 'heading', level: 2, content: '开始写作' }, { type: 'paragraph', content: 'LinearPress 已经准备就绪。登录后台编辑或发布你的第一篇文章。' }] as const;
  db.prepare('INSERT INTO posts(title,slug,content_json,html_cache,status,author_id) VALUES(?,?,?,?,?,?)').run('LinearPress 已上线', 'welcome', JSON.stringify(blocks), renderBlocks([...blocks]), 'published', superAdmin.id);
}
console.log('Sample content seeded. No accounts were created.');
db.close();
