/*
 * LinearPress SQLite Infrastructure Database
 *
 * Synchronous SQLite infrastructure database for LinearPress.
 *
 * Authors:
 * MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥
 * worryzu <worryzu@gmail.com> @LinearTeam
 *
 * Copyright (C) 2026 Evarentha
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Opens the SQLite database (WAL journal mode, foreign keys on) from
 * <code>DB_PATH</code> or <code>data/blog.db</code>, exports typed statement
 * and database interfaces plus the shared <code>db</code> handle, purges
 * expired sessions, and runs idempotent schema migrations — including the
 * system groups seed, plugin column backfills and single-super-admin
 * enforcement.
 *
 * @since 2.0.1
 */

import { DatabaseSync } from 'node:sqlite';
import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'fs-extra';
import path from 'node:path';

const dbPath = process.env.DB_PATH ?? path.join(process.cwd(), 'data', 'blog.db');
fs.ensureDirSync(path.dirname(dbPath));

export interface SqliteRunResult { lastInsertRowid?: number | bigint; changes?: number | bigint; }
export interface SqliteStatement { run(...params: unknown[]): SqliteRunResult; get(...params: unknown[]): unknown; all(...params: unknown[]): unknown[]; }
export interface SqliteDatabase { exec(sql: string): void; prepare(sql: string): SqliteStatement; close(): void; name: string; }
interface TransactionOwner { active: boolean; }
interface DatabaseGuard {
  native: SqliteDatabase;
  owner?: TransactionOwner;
  scope: AsyncLocalStorage<TransactionOwner | undefined>;
  queue: Array<() => void>;
}
const guards = new WeakMap<SqliteDatabase, DatabaseGuard>();
function busy(message: string): Error { return Object.assign(new Error(message), { code: 'SQLITE_BUSY' }); }
function assertAccess(guard: DatabaseGuard): void {
  const owner = guard.scope.getStore();
  if (owner && !owner.active) throw busy('事务已结束，不能从遗留异步任务访问数据库');
  if (guard.owner && owner !== guard.owner) throw busy('数据库正由另一异步事务使用，请 await databaseService 方法或稍后重试');
}
function assertManagedSql(sql: string): void {
  // Strip quoted values and comments before checking every statement, including prepared SQL.
  const plain = sql.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|`[^`]*`|\[[^\]]*\]|--[^\n]*|\/\*[\s\S]*?\*\//g, ' ');
  const words = plain.match(/[a-z_][a-z0-9_]*|;/gi) ?? [];
  let start = true; let prefix: string[] = []; let trigger = false; let triggerBody = false; let cases = 0;
  for (const raw of words) {
    const word = raw.toUpperCase();
    if (trigger) {
      if (word === 'BEGIN' && !triggerBody) triggerBody = true;
      else if (triggerBody && word === 'CASE') cases++;
      else if (triggerBody && word === 'END') {
        if (cases) cases--; else { trigger = false; triggerBody = false; }
      }
      continue;
    }
    if (word === ';') { start = true; prefix = []; continue; }
    if (start) {
      if (['BEGIN', 'COMMIT', 'END', 'ROLLBACK', 'SAVEPOINT', 'RELEASE'].includes(word)) throw new Error('请使用 databaseService.transaction()，不能直接执行事务控制 SQL');
      start = false;
    }
    if (prefix.length < 3) prefix.push(word);
    // Trigger BEGIN/END delimit a program, not an application transaction.
    if (prefix[0] === 'CREATE' && (prefix[1] === 'TRIGGER' || (['TEMP', 'TEMPORARY'].includes(prefix[1]) && prefix[2] === 'TRIGGER'))) trigger = true;
  }
}
/** Never expose native DatabaseSync/StatementSync: even pre-created statements check ownership. */
export function guardSqliteDatabase(native: SqliteDatabase): SqliteDatabase {
  if (guards.has(native)) return native;
  const guard: DatabaseGuard = { native, scope: new AsyncLocalStorage(), queue: [] };
  const facade: SqliteDatabase = Object.freeze({
    name: native.name,
    exec(sql: string) { assertAccess(guard); assertManagedSql(sql); native.exec(sql); },
    prepare(sql: string): SqliteStatement {
      assertAccess(guard); assertManagedSql(sql);
      const statement = native.prepare(sql);
      return Object.freeze({
        run(...params: unknown[]) { assertAccess(guard); return statement.run(...params); },
        get(...params: unknown[]) { assertAccess(guard); return statement.get(...params); },
        all(...params: unknown[]) { assertAccess(guard); return statement.all(...params); }
      });
    },
    close() {
      assertAccess(guard);
      if (guard.owner || guard.queue.length) throw busy('不能在事务或排队操作期间关闭数据库');
      native.close();
    }
  });
  guards.set(facade, guard);
  return facade;
}
function drain(guard: DatabaseGuard): void {
  if (!guard.owner) guard.scope.run(undefined, () => guard.queue.shift()?.());
}
/** Ordinary awaitable service calls queue; synchronous raw/global access fails rather than joining. */
export function sqliteOperation<T>(database: SqliteDatabase, callback: () => T): T | Promise<T> {
  const guard = guards.get(database);
  if (!guard) throw new Error('SQLite database must be guarded');
  const owner = guard.scope.getStore();
  if (owner) { assertAccess(guard); return callback(); }
  if (!guard.owner && !guard.queue.length) return callback();
  return new Promise<T>((resolve, reject) => {
    guard.queue.push(() => { try { resolve(callback()); } catch (error) { reject(error); } finally { drain(guard); } });
  });
}
/** Async callbacks remain supported, with strict ownership across all awaits. */
export function sqliteTransaction<T>(database: SqliteDatabase, callback: () => T | Promise<T>): Promise<T> {
  const guard = guards.get(database);
  if (!guard) return Promise.reject(new Error('SQLite database must be guarded'));
  if (guard.scope.getStore()) return Promise.reject(new Error('不支持嵌套或遗留任务事务'));
  return new Promise<T>((resolve, reject) => {
    const start = () => {
      const owner: TransactionOwner = { active: true };
      guard.owner = owner;
      guard.scope.run(owner, async () => {
        let began = false;
        try {
          guard.native.exec('BEGIN IMMEDIATE'); began = true;
          const result = await callback();
          guard.native.exec('COMMIT'); resolve(result);
        } catch (error) {
          if (began) { try { guard.native.exec('ROLLBACK'); } catch { /* preserve original error */ } }
          reject(error);
        } finally { owner.active = false; guard.owner = undefined; drain(guard); }
      });
    };
    if (guard.owner || guard.queue.length) guard.queue.push(start);
    else start();
  });
}
export const db: SqliteDatabase = guardSqliteDatabase(new DatabaseSync(dbPath) as unknown as SqliteDatabase);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

/** 清理已过期的会话记录（启动时执行一次，并由 app 层定时调用）。 */
export function purgeExpiredSessions(): void {
  try { db.prepare('DELETE FROM sessions WHERE expired<?').run(Date.now()); } catch { /* 表尚未创建时忽略 */ }
}

export function runMigrations(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, sess TEXT NOT NULL, expired INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      permissions TEXT NOT NULL,
      is_system INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      email TEXT UNIQUE,
      group_id INTEGER NOT NULL REFERENCES groups(id),
      is_super_admin INTEGER NOT NULL DEFAULT 0 CHECK(is_super_admin IN (0,1)),
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      content_json TEXT NOT NULL DEFAULT '[]',
      html_cache TEXT,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived')),
      author_id INTEGER NOT NULL REFERENCES users(id),
      views INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      guest_name TEXT,
      guest_email TEXT,
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','spam')),
      ip TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS plugins (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      version TEXT NOT NULL,
      type TEXT DEFAULT 'both',
      icon TEXT,
      description TEXT,
      enabled INTEGER DEFAULT 1,
      load_order INTEGER DEFAULT 0,
      config TEXT,
      installed_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_posts_status_created ON posts(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_comments_post_status ON comments(post_id, status);
  `);

  const insertGroup = db.prepare('INSERT OR IGNORE INTO groups(name,permissions,is_system) VALUES(?,?,1)');
  insertGroup.run('admin', JSON.stringify(['*']));
  insertGroup.run('editor', JSON.stringify(['admin:access','post:create','post:edit','post:delete','comment:moderate']));
  insertGroup.run('subscriber', JSON.stringify(['comment:create']));

  const pluginColumns = db.prepare("PRAGMA table_info('plugins')").all() as Array<{ name: string }>;
  if (!pluginColumns.some((column) => column.name === 'type')) db.exec("ALTER TABLE plugins ADD COLUMN type TEXT DEFAULT 'both';");
  if (!pluginColumns.some((column) => column.name === 'icon')) db.exec('ALTER TABLE plugins ADD COLUMN icon TEXT;');
  if (!pluginColumns.some((column) => column.name === 'description')) db.exec('ALTER TABLE plugins ADD COLUMN description TEXT;');

  const columns = db.prepare("PRAGMA table_info('users')").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === 'is_super_admin')) {
    db.exec('ALTER TABLE users ADD COLUMN is_super_admin INTEGER NOT NULL DEFAULT 0 CHECK(is_super_admin IN (0,1));');
  }
  const superAdmin = db.prepare('SELECT id FROM users WHERE is_super_admin=1').get();
  if (!superAdmin) {
    const legacyAdmin = db.prepare("SELECT users.id FROM users JOIN groups ON groups.id=users.group_id WHERE groups.name='admin' ORDER BY users.id LIMIT 1").get() as { id: number } | undefined;
    if (legacyAdmin) db.prepare('UPDATE users SET is_super_admin=1 WHERE id=?').run(legacyAdmin.id);
  }
  const editorGroup = db.prepare("SELECT id FROM groups WHERE name='editor'").get() as { id: number };
  const systemAdmin = db.prepare("SELECT users.id, users.group_id FROM users JOIN groups ON groups.id=users.group_id WHERE users.is_super_admin=1 AND groups.name='admin'").get() as { id: number; group_id: number } | undefined;
  if (systemAdmin) db.prepare('UPDATE users SET group_id=? WHERE group_id=? AND id<>?').run(editorGroup.id, systemAdmin.group_id, systemAdmin.id);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_single_super_admin ON users(is_super_admin) WHERE is_super_admin = 1;');

  // Account creation is only OOBE step 1. Only the explicit completion marker
  // may skip the remaining wizard; an admin record is not proof of completion.
}
