/*
 * Author: MoyuZJ
 * Team: LinearTeam
 * Contact: linearteam@foxmail.com
 * Made by MoyuZJ in China with ♥
 */

import session from 'express-session';
import type { SqliteDatabase } from './database.js';

type SessionCallback = (error?: Error | null, value?: session.SessionData | null) => void;
export class SQLiteSessionStore extends session.Store {
  constructor(private database: SqliteDatabase) { super(); }
  get(sid: string, callback: SessionCallback): void {
    try {
      const row = this.database.prepare('SELECT sess, expired FROM sessions WHERE sid=?').get(sid) as { sess: string; expired: number } | undefined;
      if (!row || row.expired <= Date.now()) return callback(null, null);
      callback(null, JSON.parse(row.sess) as session.SessionData);
    } catch (error) { callback(error as Error); }
  }
  set(sid: string, sess: session.SessionData, callback: (error?: Error | null) => void): void {
    try {
      const expires = sess.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 86400000;
      this.database.prepare('INSERT INTO sessions(sid,sess,expired) VALUES(?,?,?) ON CONFLICT(sid) DO UPDATE SET sess=excluded.sess, expired=excluded.expired').run(sid, JSON.stringify(sess), expires);
      callback(null);
    } catch (error) { callback(error as Error); }
  }
  destroy(sid: string, callback: (error?: Error | null) => void): void { try { this.database.prepare('DELETE FROM sessions WHERE sid=?').run(sid); callback(null); } catch (error) { callback(error as Error); } }
  touch(sid: string, sess: session.SessionData, callback: (error?: Error | null) => void): void { this.set(sid, sess, callback); }
}
