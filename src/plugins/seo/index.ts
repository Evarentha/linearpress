import { checkPermission } from '../../services/permission.service.js';
import type { PluginEntry } from '../../types/plugin.js';

export const activate: PluginEntry['activate'] = async ({ db, hooks, router, logger }) => {
  db.exec('CREATE TABLE IF NOT EXISTS seo_meta (post_id INTEGER PRIMARY KEY, meta_description TEXT)');
  hooks.on('post:beforeSave', (post) => ({ ...post, title: post.title.trim(), slug: post.slug.trim().toLowerCase() }), { priority: 10 });
  router.register('get', '/admin/seo', checkPermission('admin:access'), (_req, res) => res.render('admin/seo', { title: 'SEO 状态' }));
  hooks.on('admin:menu', (menu) => [...menu, { title: 'SEO', link: '/admin/seo' }]);
  logger.info('activated');
};
