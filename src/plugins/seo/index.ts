/*
 * Author: MoyuZJ
 * Team: LinearTeam
 * Contact: linearteam@foxmail.com
 * Made by MoyuZJ in China with ♥
 */

import { Context } from 'cordis';
import { checkPermission } from '../../services/permission.service.js';

export default function seo(context: Context): void {
  const { db, web, hooks } = context.linearpress;
  db.exec('CREATE TABLE IF NOT EXISTS seo_meta (post_id INTEGER PRIMARY KEY, meta_description TEXT)');
  hooks.on('post:beforeSave', (post: any) => ({ ...post, title: post.title.trim(), slug: post.slug.trim().toLowerCase() }), { priority: 10 });
  web.register('get', '/admin/seo', checkPermission('admin:access'), (_req: any, res: any) => res.render('admin/seo', { title: 'SEO 状态' }));
  hooks.on('admin:menu', (menu: any) => [...menu, { title: 'SEO', link: '/admin/seo' }]);
  context.logger.info('activated');
}
