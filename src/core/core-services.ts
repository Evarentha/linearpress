/*
 * Author: MoyuZJ
 * Team: LinearTeam
 * Contact: linearteam@foxmail.com
 * Made by MoyuZJ in China with ♥
 */

import { db } from './database.js';
import type { HookSystem } from './hook-system.js';
import type { PluginManager } from './plugin-manager.js';
import type { ServiceContainer } from './service-container.js';
import { TOKENS } from './tokens.js';
import * as commentData from '../services/comment.service.js';
import { getBaseConfig, setBaseConfig } from '../services/config.service.js';
import * as groupData from '../services/group.service.js';
import { hasPermission } from '../services/permission.service.js';
import { installFromNpm, installFromZip } from '../services/plugin-installer.js';
import * as postData from '../services/post.service.js';
import * as userData from '../services/user.service.js';
import type { Plugin } from '../types/index.js';
import type { AuthService, CommentService, ConfigService, DatabaseService, GroupService, PermissionService, PluginService, PostService, UserService } from '../types/services.js';

export function registerCoreServices(container: ServiceContainer, hooks: HookSystem, manager: PluginManager): void {
  container.provide(TOKENS.database, db);

  const primaryDatabase = container.resolve(TOKENS.database);
  const databaseService: DatabaseService = {
    raw: primaryDatabase,
    all: <T>(sql: string, ...params: unknown[]) => primaryDatabase.prepare(sql).all(...params) as T[],
    get: <T>(sql: string, ...params: unknown[]) => primaryDatabase.prepare(sql).get(...params) as T | undefined,
    run: (sql, ...params) => primaryDatabase.prepare(sql).run(...params),
    exec: (sql) => primaryDatabase.exec(sql),
    transaction: async <T>(callback: () => T | Promise<T>): Promise<T> => {
      primaryDatabase.exec('BEGIN IMMEDIATE');
      try { const result = await callback(); primaryDatabase.exec('COMMIT'); return result; }
      catch (error) { primaryDatabase.exec('ROLLBACK'); throw error; }
    }
  };
  container.provide(TOKENS.databaseService, databaseService);

  const auth: AuthService = {
    isOobeRequired: userData.isOobeRequired,
    authenticate: async (username, password) => {
      const draft = await hooks.trigger('auth:beforeLogin', { username, password });
      const user = await userData.authenticate(draft.username, draft.password);
      return user ? hooks.trigger('auth:afterLogin', user) : undefined;
    },
    createSuperAdmin: async (username, email, password, confirmation) => {
      if (password !== confirmation) throw new Error('两次输入的密码不一致');
      const draft = await hooks.trigger('user:beforeCreate', { username, email, password, isSuperAdmin: true });
      const user = await userData.createSuperAdmin(draft.username, draft.email ?? '', draft.password, draft.password);
      return hooks.trigger('user:afterCreate', user);
    }
  };
  container.provide(TOKENS.auth, auth);

  const users: UserService = {
    findById: userData.findUserById,
    findByUsername: userData.findUserByUsername,
    list: userData.listUsers,
    register: async (username, email, password) => {
      const draft = await hooks.trigger('user:beforeCreate', { username, email, password, isSuperAdmin: false });
      const user = await userData.registerUser(draft.username, draft.email, draft.password);
      return hooks.trigger('user:afterCreate', user);
    },
    assignGroup: async (userId, groupId) => {
      const user = userData.findUserById(userId);
      const group = userData.getGroup(groupId);
      if (!user || !group) throw new Error('用户或权限组不存在');
      const payload = await hooks.trigger('user:beforeAssignGroup', { user, group });
      userData.assignUserGroup(payload.user.id, payload.group.id);
      await hooks.trigger('user:afterAssignGroup', payload);
    },
    listGroups: userData.listGroups,
    getGroup: userData.getGroup
  };
  container.provide(TOKENS.users, users);

  const posts: PostService = {
    findById: postData.findPostById,
    findBySlug: postData.findPostBySlug,
    list: postData.listAll,
    listPublished: postData.listPublished,
    save: async (input) => {
      const existing = input.id ? postData.findPostById(input.id) : undefined;
      const draft = await hooks.trigger('post:beforeSave', { id: input.id ?? 0, title: input.title, slug: input.slug ?? '', content_json: input.blocks, html_cache: existing?.html_cache ?? null, status: input.status, author_id: input.authorId, views: existing?.views ?? 0, created_at: existing?.created_at ?? '', updated_at: existing?.updated_at ?? null });
      const saved = postData.savePost({ id: draft.id || undefined, title: draft.title, slug: draft.slug, blocks: draft.content_json, status: draft.status, authorId: draft.author_id });
      return hooks.trigger('post:afterSave', saved);
    },
    remove: async (id) => {
      const post = postData.findPostById(id);
      if (!post) throw new Error('文章不存在');
      const payload = await hooks.trigger('post:beforeDelete', { post });
      postData.deletePost(payload.post.id);
      await hooks.trigger('post:afterDelete', payload);
    },
    incrementViews: postData.incrementViews,
    generateSlug: postData.generateSlug,
    render: postData.renderBlocks
  };
  container.provide(TOKENS.posts, posts);

  const comments: CommentService = {
    listForPost: commentData.approvedForPost,
    list: commentData.listComments,
    find: commentData.findComment,
    create: async (input) => { const draft = await hooks.trigger('comment:beforeCreate', input); const comment = commentData.createComment(draft); return hooks.trigger('comment:afterCreate', comment); },
    setStatus: async (id, status) => { const comment = commentData.findComment(id); if (!comment) throw new Error('评论不存在'); const payload = await hooks.trigger('comment:beforeModerate', { comment, status }); commentData.setCommentStatus(payload.comment.id, payload.status); },
    remove: async (id) => { const comment = commentData.findComment(id); if (!comment) throw new Error('评论不存在'); const payload = await hooks.trigger('comment:beforeDelete', { comment }); commentData.deleteComment(payload.comment.id); await hooks.trigger('comment:afterDelete', payload); }
  };
  container.provide(TOKENS.comments, comments);

  const groups: GroupService = {
    find: groupData.findGroup,
    list: userData.listGroups,
    permissions: () => groupData.listPermissionDefinitions().map((item) => item.id),
    create: async (name, permissions) => { const draft = await hooks.trigger('group:beforeSave', { name, permissions }); return groupData.createGroup(draft.name, draft.permissions); },
    update: async (id, name, permissions) => { const draft = await hooks.trigger('group:beforeSave', { id, name, permissions }); return groupData.updateGroup(draft.id!, draft.name, draft.permissions); },
    remove: async (id) => { const group = groupData.findGroup(id); if (!group) throw new Error('权限组不存在'); const payload = await hooks.trigger('group:beforeDelete', { group }); groupData.deleteGroup(payload.group.id); }
  };
  container.provide(TOKENS.groups, groups);

  const permissions: PermissionService = {
    has: hasPermission,
    register: (permission, label) => groupData.registerPermission(permission, label),
    list: groupData.listPermissionDefinitions
  };
  container.provide(TOKENS.permissions, permissions);

  const pluginService: PluginService = {
    list: () => manager.database.prepare('SELECT * FROM plugins ORDER BY load_order').all() as Plugin[],
    setEnabled: async (id, enabled) => { const payload = await hooks.trigger('plugin:beforeEnable', { id, enabled }); manager.setEnabled(payload.id, payload.enabled); await hooks.trigger('plugin:afterEnable', payload); },
    setLoadOrder: async (id, order) => { const payload = await hooks.trigger('plugin:beforeReorder', { id, order }); manager.setLoadOrder(payload.id, payload.order); await hooks.trigger('plugin:afterReorder', payload); },
    getConfig: <T>(id: string): T | null => { const row = manager.database.prepare('SELECT config FROM plugins WHERE id=?').get(id) as { config: string | null } | undefined; return row?.config ? JSON.parse(row.config) as T : null; },
    setConfig: (id, config) => { manager.database.prepare('UPDATE plugins SET config=? WHERE id=?').run(JSON.stringify(config), id); },
    uninstall: async (id) => { const payload = await hooks.trigger('plugin:beforeUninstall', { id }); await manager.uninstall(payload.id); await hooks.trigger('plugin:afterUninstall', payload); },
    installNpm: (spec) => installFromNpm(manager, spec),
    installZip: (buffer) => installFromZip(manager, buffer)
  };
  container.provide(TOKENS.plugins, pluginService);

  const config: ConfigService = { get: () => hooks.trigger('site:config', getBaseConfig()), set: setBaseConfig };
  container.provide(TOKENS.config, config);
}
