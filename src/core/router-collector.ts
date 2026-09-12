/*
 * LinearPress Route Collector
 *
 * Plugin-attributed route collection deferred until app assembly.
 *
 * Authors:
 * MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥
 *
 * Copyright (C) 2026 Evarentha
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * <code>RouterCollector</code> gathers (method, path, handler, pluginId)
 * registrations instead of binding them to Express immediately, exposes a
 * read-only snapshot so plugins can apply the first-registered-wins rule,
 * and applies the collected routes to the app in reverse registration order.
 *
 * @since 2.0.1
 */

import type { Express, RequestHandler } from 'express';
import type { RegisteredRoute } from '../types/plugin.js';

export class RouterCollector {
  private routes: RegisteredRoute[] = [];
  private currentPluginId = 'core';

  setCurrentPluginId(id: string): void { this.currentPluginId = id; }
  register(method: string, path: string, ...handlers: RequestHandler[]): void { this.routes.push({ method: method.toLowerCase(), path, handler: handlers, pluginId: this.currentPluginId }); }
  getCurrentPluginId(): string { return this.currentPluginId; }

  /** 只读快照：供插件在运行时检查某个路径是否已被系统/其他插件注册（先注册原则需要）。 */
  listRoutes(): RegisteredRoute[] { return this.routes.map((route) => ({ method: route.method, path: route.path, handler: route.handler, pluginId: route.pluginId })); }

  applyToApp(app: Express): void {
    for (const route of [...this.routes].reverse()) {
      const registrar = app[route.method as keyof Express];
      if (typeof registrar !== 'function') throw new Error(`Unsupported HTTP method: ${route.method}`);
      (registrar as (path: string, ...handlers: RequestHandler[]) => Express).call(app, route.path, ...route.handler);
    }
  }
}
