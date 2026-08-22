/*
 * Author: MoyuZJ
 * Team: LinearTeam
 * Contact: linearteam@foxmail.com
 * Made by MoyuZJ in China with ♥
 */

import type { Comment, CommentStatus, Group, Post, SiteConfig, User } from './index.js';

export interface CommentDraft { postId: number; userId?: number; guestName?: string; guestEmail?: string; content: string; ip?: string; }
export interface UserDraft { username: string; email: string | null; password: string; isSuperAdmin?: boolean; }
export interface GroupDraft { id?: number; name: string; permissions: string[]; }

export interface HookPayloadMap {
  'auth:beforeLogin': { username: string; password: string };
  'auth:afterLogin': User;
  'auth:beforeLogout': { userId?: number };
  'post:beforeSave': Post;
  'post:afterSave': Post;
  'post:beforeDelete': { post: Post };
  'post:afterDelete': { post: Post };
  'post:beforeRender': { post: Post; html: string };
  'post:beforeView': { post: Post };
  'post:afterView': { post: Post };
  'comment:beforeCreate': CommentDraft;
  'comment:afterCreate': Comment;
  'comment:beforeModerate': { comment: Comment; status: CommentStatus };
  'comment:beforeDelete': { comment: Comment };
  'comment:afterDelete': { comment: Comment };
  'user:beforeCreate': UserDraft;
  'user:afterCreate': User;
  'user:beforeAssignGroup': { user: User; group: Group };
  'user:afterAssignGroup': { user: User; group: Group };
  'group:beforeSave': GroupDraft;
  'group:beforeDelete': { group: Group };
  'plugin:afterLoad': { id: string; name: string; version: string };
  'plugin:beforeEnable': { id: string; enabled: boolean };
  'plugin:afterEnable': { id: string; enabled: boolean };
  'plugin:beforeReorder': { id: string; order: number };
  'plugin:afterReorder': { id: string; order: number };
  'plugin:beforeUninstall': { id: string };
  'plugin:afterUninstall': { id: string };
  'admin:menu': Array<{ title: string; link: string }>;
  'site:config': SiteConfig;
  'site:locals': Record<string, unknown>;
}
export type HookName = keyof HookPayloadMap;
