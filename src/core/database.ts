import { DatabaseSync } from 'node:sqlite';
import fs from 'fs-extra';
import path from 'node:path';

const dbPath = process.env.DB_PATH ?? path.join(process.cwd(), 'data', 'blog.db');
fs.ensureDirSync(path.dirname(dbPath));

export interface SqliteRunResult { lastInsertRowid?: number | bigint; changes?: number | bigint; }
export interface SqliteStatement { run(...params: unknown[]): SqliteRunResult; get(...params: unknown[]): unknown; all(...params: unknown[]): unknown[]; }
export interface SqliteDatabase { exec(sql: string): void; prepare(sql: string): SqliteStatement; close(): void; name: string; }
export const db: SqliteDatabase = new DatabaseSync(dbPath) as unknown as SqliteDatabase;
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

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
      enabled INTEGER DEFAULT 1,
      load_order INTEGER DEFAULT 0,
      config TEXT,
      installed_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_posts_status_created ON posts(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_comments_post_status ON comments(post_id, status);
  `);

  const insertGroup = db.prepare('INSERT OR IGNORE INTO groups(name,permissions,is_system) VALUES(?,?,1)');
  insertGroup.run('admin', JSON.stringify(['*']));
  insertGroup.run('editor', JSON.stringify(['admin:access','post:create','post:edit','post:delete','comment:moderate']));
  insertGroup.run('subscriber', JSON.stringify(['comment:create']));

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
}
