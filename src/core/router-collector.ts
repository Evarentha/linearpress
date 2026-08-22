/*
 * Author: MoyuZJ
 * Team: LinearTeam
 * Contact: linearteam@foxmail.com
 * Made by MoyuZJ in China with ♥
 */

import type { Express, RequestHandler } from 'express';
import type { RegisteredRoute } from '../types/plugin.js';

export class RouterCollector {
  private routes: RegisteredRoute[] = [];
  private currentPluginId = 'core';

  setCurrentPluginId(id: string): void { this.currentPluginId = id; }
  register(method: string, path: string, ...handlers: RequestHandler[]): void { this.routes.push({ method: method.toLowerCase(), path, handler: handlers, pluginId: this.currentPluginId }); }
  getRoutes(): readonly RegisteredRoute[] { return this.routes; }

  applyToApp(app: Express): void {
    for (const route of [...this.routes].reverse()) {
      const registrar = app[route.method as keyof Express];
      if (typeof registrar !== 'function') throw new Error(`Unsupported HTTP method: ${route.method}`);
      (registrar as (path: string, ...handlers: RequestHandler[]) => Express).call(app, route.path, ...route.handler);
    }
  }
}
