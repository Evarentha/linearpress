/*
 * Author: MoyuZJ
 * Team: LinearTeam
 * Contact: linearteam@foxmail.com
 * Made by MoyuZJ in China with ♥
 */

import { db } from '../core/database.js';
import type { Group } from '../types/index.js';

interface GroupRow extends Omit<Group, 'permissions'> { permissions: string; }
const hydrate = (row: GroupRow): Group => ({ ...row, permissions: JSON.parse(row.permissions) as string[] });
const registry = new Map<string, string>([
  ['admin:access', '访问后台'], ['post:create', '创建文章'], ['post:edit', '编辑文章'], ['post:delete', '删除文章'],
  ['comment:create', '创建评论'], ['comment:moderate', '审核评论'], ['user:manage', '管理用户'], ['group:manage', '管理权限组'], ['plugin:manage', '管理插件']
]);

export const PERMISSIONS = [...registry.keys()];
export function registerPermission(id: string, label = id): void { if (!id.trim() || id === '*') throw new Error('权限标识无效'); registry.set(id, label); if (!PERMISSIONS.includes(id)) PERMISSIONS.push(id); }
export function listPermissionDefinitions(): Array<{ id: string; label: string }> { return [...registry].map(([id, label]) => ({ id, label })); }

export function findGroup(id: number): Group | undefined {
  const row = db.prepare('SELECT * FROM groups WHERE id=?').get(id) as GroupRow | undefined;
  return row ? hydrate(row) : undefined;
}
export function createGroup(name: string, permissions: string[]): Group {
  const cleanName = name.trim();
  if (cleanName.length < 2) throw new Error('权限组名称至少需要 2 个字符');
  const valid = permissions.filter((permission) => registry.has(permission));
  const id = Number(db.prepare('INSERT INTO groups(name,permissions,is_system) VALUES(?,?,0)').run(cleanName, JSON.stringify(valid)).lastInsertRowid);
  return findGroup(id)!;
}
export function updateGroup(id: number, name: string, permissions: string[]): Group {
  const group = findGroup(id);
  if (!group) throw new Error('权限组不存在');
  if (group.is_system) throw new Error('系统权限组不可修改');
  const valid = permissions.filter((permission) => registry.has(permission));
  db.prepare('UPDATE groups SET name=?, permissions=? WHERE id=?').run(name.trim(), JSON.stringify(valid), id);
  return findGroup(id)!;
}
export function deleteGroup(id: number): void {
  const group = findGroup(id);
  if (!group) throw new Error('权限组不存在');
  if (group.is_system) throw new Error('系统权限组不可删除');
  const fallback = db.prepare("SELECT id FROM groups WHERE name='subscriber'").get() as { id: number };
  db.prepare('UPDATE users SET group_id=? WHERE group_id=?').run(fallback.id, id);
  db.prepare('DELETE FROM groups WHERE id=?').run(id);
}
