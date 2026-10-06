/*
 * LinearPress Route Collector
 *
 * Plugin-attributed route collection deferred until app assembly.
 *
 * Authors:
 * MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥
 * worryzu <worryzu@gmail.com> @LinearTeam
 *
 * Copyright (C) 2026 Evarentha
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** Revocable routes retain the existing last-registered-first precedence. */
import { Router, type Express, type RequestHandler } from 'express';
import type { RegisteredRoute } from '../types/plugin.js';
import { assertRegistrationActive, bindLifecycle, currentPluginId, ownResource } from './lifecycle-scope.js';

export class RouterCollector {
  private routes: RegisteredRoute[] = [];
  private currentPluginId = 'core';
  private dispatcher = Router();

  setCurrentPluginId(id: string): void { this.currentPluginId = id; }
  register(method: string, path: string, ...handlers: RequestHandler[]): void {
    assertRegistrationActive();
    const route = { method: method.toLowerCase(), path, handler: handlers.map(bindLifecycle), pluginId: this.getCurrentPluginId() };
    this.routes.push(route);
    try { this.rebuild(); }
    catch (error) { this.routes.pop(); throw error; }
    ownResource(() => { this.routes = this.routes.filter((item) => item !== route); this.rebuild(); });
  }
  getCurrentPluginId(): string { return currentPluginId(this.currentPluginId); }
  removePlugin(id: string): void { this.routes = this.routes.filter((item) => item.pluginId !== id); this.rebuild(); }
  listRoutes(): RegisteredRoute[] { return this.routes.map((route) => ({ ...route, handler: [...route.handler] })); }

  private rebuild(): void {
    const dispatcher = Router();
    for (const route of [...this.routes].reverse()) {
      const registrar = dispatcher[route.method as keyof typeof dispatcher];
      if (typeof registrar !== 'function') throw new Error(`Unsupported HTTP method: ${route.method}`);
      (registrar as (path: string, ...handlers: RequestHandler[]) => unknown).call(dispatcher, route.path, ...route.handler);
    }
    this.dispatcher = dispatcher;
  }
  applyToApp(app: Express): void { app.use((req, res, next) => this.dispatcher(req, res, next)); }
}
