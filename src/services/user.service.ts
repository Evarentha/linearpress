/*
 * Author: MoyuZJ
 * Team: LinearTeam
 * Contact: linearteam@foxmail.com
 * Made by MoyuZJ in China with ♥
 */

import bcrypt from 'bcryptjs';
import { db } from '../core/database.js';
import type { Group, User } from '../types/index.js';

interface GroupRow extends Omit<Group, 'permissions'> { permissions: string; }

export function findUserById(id: number): User | undefined { return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined; }
export function findUserByUsername(username: string): User | undefined { return db.prepare('SELECT * FROM users WHERE username = ?').get(username) as User | undefined; }
export function isOobeRequired(): boolean { return !db.prepare('SELECT id FROM users WHERE is_super_admin=1').get(); }
export async function createSuperAdmin(username: string, email: string, password: string, confirmation: string): Promise<User> {
  if (!isOobeRequired()) throw new Error('OOBE 已完成，不能再次创建超级管理员');
  if (username.trim().length < 3) throw new Error('用户名至少需要 3 个字符');
  if (!email.trim()) throw new Error('必须填写超级管理员邮箱');
  if (password.length < 8) throw new Error('密码至少需要 8 个字符');
  if (password !== confirmation) throw new Error('两次输入的密码不一致');
  const group = db.prepare("SELECT id FROM groups WHERE name='admin'").get() as { id: number } | undefined;
  if (!group) throw new Error('管理员权限组不存在');
  const hash = await bcrypt.hash(password, 12);
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!isOobeRequired()) throw new Error('超级管理员已由其他请求创建');
    const result = db.prepare('INSERT INTO users(username,password_hash,email,group_id,is_super_admin) VALUES(?,?,?,?,1)').run(username.trim(), hash, email.trim(), group.id);
    db.exec('COMMIT');
    return findUserById(Number(result.lastInsertRowid))!;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
export function getGroup(id: number): Group | undefined { const row = db.prepare('SELECT * FROM groups WHERE id = ?').get(id) as GroupRow | undefined; return row ? { ...row, permissions: JSON.parse(row.permissions) as string[] } : undefined; }
export function listUsers(): Array<User & { group_name: string }> { return db.prepare('SELECT users.*, groups.name AS group_name FROM users JOIN groups ON groups.id = users.group_id ORDER BY users.created_at DESC').all() as Array<User & { group_name: string }>; }
export function listGroups(): Group[] { return (db.prepare('SELECT * FROM groups ORDER BY id').all() as GroupRow[]).map((row) => ({ ...row, permissions: JSON.parse(row.permissions) as string[] })); }
export function assignUserGroup(userId: number, groupId: number): void {
  const user = findUserById(userId);
  const group = getGroup(groupId);
  if (!user || !group) throw new Error('用户或权限组不存在');
  if (user.is_super_admin) throw new Error('不能修改超级管理员的权限组');
  if (group.permissions.includes('*')) throw new Error('内置管理员组仅供唯一超级管理员使用');
  db.prepare('UPDATE users SET group_id=? WHERE id=?').run(groupId, userId);
}
export async function registerUser(username: string, email: string | null, password: string): Promise<User> {
  if (username.trim().length < 3 || password.length < 8) throw new Error('用户名至少 3 个字符，密码至少 8 个字符');
  const group = db.prepare("SELECT id FROM groups WHERE name = 'subscriber'").get() as { id: number } | undefined;
  if (!group) throw new Error('默认权限组不存在');
  const hash = await bcrypt.hash(password, 12);
  const result = db.prepare('INSERT INTO users(username,password_hash,email,group_id) VALUES(?,?,?,?)').run(username.trim(), hash, email || null, group.id);
  return findUserById(Number(result.lastInsertRowid))!;
}
export async function authenticate(username: string, password: string): Promise<User | undefined> { const user = findUserByUsername(username); return user && await bcrypt.compare(password, user.password_hash) ? user : undefined; }
