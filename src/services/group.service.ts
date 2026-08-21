import { db } from '../core/database.js';
import type { Group } from '../types/index.js';

interface GroupRow extends Omit<Group, 'permissions'> { permissions: string; }
const hydrate = (row: GroupRow): Group => ({ ...row, permissions: JSON.parse(row.permissions) as string[] });

export const PERMISSIONS = [
  'admin:access', 'post:create', 'post:edit', 'post:delete',
  'comment:create', 'comment:moderate', 'user:manage', 'group:manage', 'plugin:manage'
];

export function findGroup(id: number): Group | undefined {
  const row = db.prepare('SELECT * FROM groups WHERE id=?').get(id) as GroupRow | undefined;
  return row ? hydrate(row) : undefined;
}
export function createGroup(name: string, permissions: string[]): Group {
  const cleanName = name.trim();
  if (cleanName.length < 2) throw new Error('权限组名称至少需要 2 个字符');
  const valid = permissions.filter((permission) => PERMISSIONS.includes(permission));
  const id = Number(db.prepare('INSERT INTO groups(name,permissions,is_system) VALUES(?,?,0)').run(cleanName, JSON.stringify(valid)).lastInsertRowid);
  return findGroup(id)!;
}
export function updateGroup(id: number, name: string, permissions: string[]): Group {
  const group = findGroup(id);
  if (!group) throw new Error('权限组不存在');
  if (group.is_system) throw new Error('系统权限组不可修改');
  const valid = permissions.filter((permission) => PERMISSIONS.includes(permission));
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
