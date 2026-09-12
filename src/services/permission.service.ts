/*
 * LinearPress Permission Service
 *
 * Permission checks and Express authentication guards.
 *
 * Authors:
 * MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥
 *
 * Copyright (C) 2026 Evarentha
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * <code>hasPermission()</code> resolves the user's group — super admins
 * always pass and the <code>*</code> wildcard grants everything — while
 * <code>requireAuth</code> redirects anonymous sessions to the login page
 * and <code>checkPermission()</code> builds a guard that renders a 403 page
 * when the active Cordis context denies the permission.
 *
 * @since 2.0.1
 */

import type { RequestHandler } from 'express';
import { getActiveContext } from '../core/context.js';
import { findUserById, getGroup } from './user.service.js';

export function hasPermission(userId: number, permission: string): boolean {
  const user = findUserById(userId);
  if (user?.is_super_admin) return true;
  const group = user ? getGroup(user.group_id) : undefined;
  return Boolean(group && (group.permissions.includes('*') || group.permissions.includes(permission)));
}
export const requireAuth: RequestHandler = (req, res, next) => { if (!req.session.userId) return res.redirect('/login'); next(); };
export function checkPermission(permission: string): RequestHandler {
  return async (req, res, next) => {
    if (!req.session.userId) return res.redirect('/login');
    if (!await getActiveContext().permissions.has(req.session.userId, permission)) return res.status(403).render('error', { title: '权限不足', message: '你没有执行此操作的权限。' });
    next();
  };
}
