/*
 * LinearPress Service Contracts
 *
 * Context-provided service interfaces shared by core and plugins.
 *
 * Authors:
 * MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥
 * worryzu <worryzu@gmail.com> @LinearTeam
 *
 * Copyright (C) 2026 Evarentha
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The <code>MaybePromise</code>-based contracts provided through the Cordis
 * context: <code>DatabaseService</code> with transaction helpers,
 * <code>AuthService</code>, <code>UserService</code>, <code>PostService</code>,
 * <code>CommentService</code>, <code>GroupService</code>,
 * <code>PermissionService</code>, <code>PluginService</code>,
 * <code>ConfigService</code> and the session store factory.
 *
 * @since 2.0.1
 */

import type session from 'express-session';
import type { SqliteDatabase, SqliteRunResult } from '../core/database.js';
import type { InstallJob } from '../core/plugin-install-jobs.js';
import type { PluginChangeJob } from '../core/plugin-change-jobs.js';
import type { Block, Comment, CommentStatus, Group, Plugin, Post, PostStatus, SiteConfig, User } from './index.js';

export type MaybePromise<T> = T | Promise<T>;

export interface DatabaseService {
  /** Optional for older providers; set by current SQLite/MySQL drivers. */
  dialect?: 'sqlite' | 'mysql';
  /** SQLite raw/global calls are synchronous: competing transactions throw SQLITE_BUSY.
   * Use the awaitable methods below to queue instead. Never issue raw transaction SQL. */
  raw: SqliteDatabase;
  all<T>(sql: string, ...params: unknown[]): MaybePromise<T[]>;
  get<T>(sql: string, ...params: unknown[]): MaybePromise<T | undefined>;
  run(sql: string, ...params: unknown[]): MaybePromise<SqliteRunResult>;
  exec(sql: string): MaybePromise<void>;
  /** Callback may await. SQLite serializes unrelated service calls and rejects nested transactions. */
  transaction<T>(callback: () => MaybePromise<T>): MaybePromise<T>;
}
export type SessionStoreFactory = () => session.Store;

export interface AuthService {
  isOobeRequired(): MaybePromise<boolean>;
  authenticate(username: string, password: string): MaybePromise<User | undefined>;
  createSuperAdmin(username: string, email: string, password: string, confirmation: string): MaybePromise<User>;
}
export interface UserService {
  findById(id: number): MaybePromise<User | undefined>;
  findByUsername(username: string): MaybePromise<User | undefined>;
  list(): MaybePromise<Array<User & { group_name: string }>>;
  register(username: string, email: string | null, password: string): MaybePromise<User>;
  assignGroup(userId: number, groupId: number): MaybePromise<void>;
  listGroups(): MaybePromise<Group[]>;
  getGroup(id: number): MaybePromise<Group | undefined>;
}
export interface PostService {
  findById(id: number): MaybePromise<Post | undefined>;
  findBySlug(slug: string): MaybePromise<Post | undefined>;
  list(): MaybePromise<Array<Post & { author_name: string }>>;
  listPublished(limit?: number, offset?: number): MaybePromise<Post[]>;
  save(input: { id?: number; title: string; slug?: string; blocks: Block[]; status: PostStatus; authorId: number; postType?: 'post' | 'shuoshuo' }): MaybePromise<Post>;
  remove(id: number): MaybePromise<void>;
  incrementViews(id: number): MaybePromise<void>;
  generateSlug(value: string): string;
  render(blocks: Block[]): MaybePromise<string>;
}
export interface CommentService {
  listForPost(postId: number): MaybePromise<Comment[]>;
  list(): MaybePromise<Array<Comment & { post_title: string; username: string | null }>>;
  find(id: number): MaybePromise<Comment | undefined>;
  create(input: { postId: number; userId?: number; guestName?: string; guestEmail?: string; content: string; ip?: string }): MaybePromise<Comment>;
  setStatus(id: number, status: CommentStatus): MaybePromise<void>;
  remove(id: number): MaybePromise<void>;
}
export interface GroupService {
  find(id: number): MaybePromise<Group | undefined>;
  list(): MaybePromise<Group[]>;
  permissions(): MaybePromise<string[]>;
  create(name: string, permissions: string[]): MaybePromise<Group>;
  update(id: number, name: string, permissions: string[]): MaybePromise<Group>;
  remove(id: number): MaybePromise<void>;
}
export interface PermissionService {
  has(userId: number, permission: string): MaybePromise<boolean>;
  register(permission: string, label?: string): MaybePromise<void>;
  list(): MaybePromise<Array<{ id: string; label: string }>>;
}
export interface PluginService {
  list(): MaybePromise<Plugin[]>;
  setEnabled(id: string, enabled: boolean): MaybePromise<void>;
  setLoadOrder(id: string, order: number): MaybePromise<void>;
  getConfig<T = unknown>(id: string): MaybePromise<T | null>;
  setConfig(id: string, config: unknown): MaybePromise<void>;
  uninstall(id: string): MaybePromise<void>;
  applyChange(change: {id:string;enabled:boolean}|{ids:string[]}): MaybePromise<{job:PluginChangeJob;statusUrl:string}>;
  installNpm(spec: string): MaybePromise<{ job: InstallJob; statusUrl: string }>;
  installZip(buffer: Buffer): MaybePromise<{ job: InstallJob; statusUrl: string }>;
  installLpp(buffer: Buffer): MaybePromise<{ job: InstallJob; statusUrl: string }>;
}
export interface ConfigService {
  get(): MaybePromise<SiteConfig>;
  set(patch: Partial<SiteConfig>): MaybePromise<void>;
  isOobeCompleted(): MaybePromise<boolean>;
  completeOobe(): MaybePromise<void>;
}
