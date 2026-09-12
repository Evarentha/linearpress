/*
 * LinearPress Plugin Service Facade
 *
 * Web, admin, hook and database surfaces exposed to plugins.
 *
 * Authors:
 * MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥
 *
 * Copyright (C) 2026 Evarentha
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Defines the <code>LinearPressWeb</code>, <code>LinearPressAdmin</code> and
 * <code>LinearPressServices</code> contract surfaces handed to plugins.
 * <code>provideLinearPressServices()</code> injects them into the Cordis
 * context without overwriting existing providers, and
 * <code>createExpressWebAdapter()</code> bridges route, middleware, view and
 * static-directory registration onto the <code>RouterCollector</code> while
 * attributing each registration to the current plugin id.
 *
 * @since 2.0.1
 */

import type { Context } from 'cordis';
import type { RequestHandler } from 'express';
import type { HookSystem } from './hook-system.js';
import type { RouterCollector } from './router-collector.js';
import type { SqliteDatabase } from './database.js';
import type { RegisteredRoute } from '../types/plugin.js';

export interface LinearPressWeb {
  register(method: string, path: string, ...handlers: RequestHandler[]): void;
  middleware(handler: RequestHandler): void;
  viewDir(dir: string): void;
  staticDir(dir: string): void;
  /** 只读路由快照（method/path/pluginId）。用于先注册原则下检测路由是否已被占用/保留。 */
  getRoutes(): RegisteredRoute[];
}

export interface LinearPressAdmin {
  registerMenu(entry: { title: string; link: string; icon?: string }): void;
  registerPanel(html: string): void;
  registerCustomSetting(entry: { label: string; link?: string; html?: string }): void;
}

export interface LinearPressServices {
  hooks: HookSystem;
  db: SqliteDatabase;
  web: LinearPressWeb;
  admin: LinearPressAdmin;
}

export function provideLinearPressServices(context: Context, services: LinearPressServices): void {
  const assign = (name: string, value: unknown) => context.reflect.get(name, false) === undefined ? context.reflect.provide(name, value) : context.reflect.set(name, value);
  assign('linearpress', services);
  assign('hooks', services.hooks);
  assign('db', services.db);
  assign('web', services.web);
  assign('admin', services.admin);
}

export function createExpressWebAdapter(router: RouterCollector, middleware: RequestHandler[], viewPaths: string[], staticMounts: Array<{ id: string; dir: string }>, pluginId: () => string): LinearPressWeb {
  return {
    register: (method, path, ...handlers) => {
      router.setCurrentPluginId(pluginId());
      try { router.register(method, path, ...handlers); }
      finally { router.setCurrentPluginId('core'); }
    },
    middleware: (handler) => middleware.push(handler),
    viewDir: (dir) => { if (!viewPaths.includes(dir)) viewPaths.push(dir); },
    staticDir: (dir) => { const id = pluginId(); if (!staticMounts.some((mount) => mount.id === id && mount.dir === dir)) staticMounts.push({ id, dir }); },
    getRoutes: () => router.listRoutes()
  };
}
