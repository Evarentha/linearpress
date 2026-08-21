import type { RequestHandler } from 'express';
import { findUserById, getGroup } from './user.service.js';

export function hasPermission(userId: number, permission: string): boolean {
  const user = findUserById(userId);
  if (user?.is_super_admin) return true;
  const group = user ? getGroup(user.group_id) : undefined;
  return Boolean(group && (group.permissions.includes('*') || group.permissions.includes(permission)));
}
export const requireAuth: RequestHandler = (req, res, next) => { if (!req.session.userId) return res.redirect('/login'); next(); };
export function checkPermission(permission: string): RequestHandler { return (req, res, next) => { if (!req.session.userId) return res.redirect('/login'); if (!hasPermission(req.session.userId, permission)) return res.status(403).render('error', { title: '权限不足', message: '你没有执行此操作的权限。' }); next(); }; }
