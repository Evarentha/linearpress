/*
 * LinearPress SQLite Session Store
 *
 * express-session store backed by the infrastructure SQLite database.
 *
 * Authors:
 * MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥
 * worryzu <worryzu@gmail.com> @LinearTeam
 *
 * Copyright (C) 2026 Evarentha
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * <code>SQLiteSessionStore</code> persists session data in the
 * <code>sessions</code> table, implementing <code>get</code>,
 * <code>set</code>, <code>destroy</code> and <code>touch</code> with expiry
 * timestamps taken from the session cookie (defaulting to one day) and
 * expired rows simply reported as missing.
 *
 * @since 2.0.1
 */

import session from 'express-session';
import { guardSqliteDatabase, sqliteOperation, type SqliteDatabase } from './database.js';

type SessionCallback = (error?: Error | null, value?: session.SessionData | null) => void;
export class SQLiteSessionStore extends session.Store {
  constructor(private database: SqliteDatabase) { super(); this.database = guardSqliteDatabase(database); }
  /** Session IO must queue behind another request's async transaction, not return SQLITE_BUSY. */
  private perform<T>(operation: () => T, callback: (error: Error | null, value?: T) => void): void {
    let pending: T | Promise<T>;
    try { pending = sqliteOperation(this.database, operation); }
    catch (error) { callback(error as Error); return; }
    void Promise.resolve(pending).then(value => callback(null, value), error => callback(error as Error));
  }
  get(sid: string, callback: SessionCallback): void {
    this.perform(() => {
      const row = this.database.prepare('SELECT sess, expired FROM sessions WHERE sid=?').get(sid) as { sess: string; expired: number } | undefined;
      return !row || row.expired <= Date.now() ? null : JSON.parse(row.sess) as session.SessionData;
    }, callback);
  }
  set(sid: string, sess: session.SessionData, callback: (error?: Error | null) => void): void {
    this.perform(() => {
      const expires = sess.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 86400000;
      this.database.prepare('INSERT INTO sessions(sid,sess,expired) VALUES(?,?,?) ON CONFLICT(sid) DO UPDATE SET sess=excluded.sess, expired=excluded.expired').run(sid, JSON.stringify(sess), expires);
    }, callback);
  }
  destroy(sid: string, callback: (error?: Error | null) => void): void {
    this.perform(() => { this.database.prepare('DELETE FROM sessions WHERE sid=?').run(sid); }, callback);
  }
  touch(sid: string, sess: session.SessionData, callback: (error?: Error | null) => void): void { this.set(sid, sess, callback); }
}
