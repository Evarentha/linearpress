import type { Express, RequestHandler } from 'express';
import type { SqliteDatabase } from '../core/database.js';
import type { HookSystem } from '../core/hook-system.js';
import type { RouterCollector } from '../core/router-collector.js';
import type { ServiceContainer } from '../core/service-container.js';

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  type: 'backend' | 'frontend' | 'both' | 'theme' | 'driver';
  main: string;
  preboot?: boolean;
  permissions?: string[];
  hooks?: Record<string, boolean>;
  views?: string;
  public?: string;
  styles?: string[];
  scripts?: string[];
}

export type GenericBlock = { type: string; [key: string]: unknown };
export type BlockRenderer = (block: GenericBlock) => string;
export interface PluginLogger { info(msg: string): void; error(msg: string): void; }

export interface PrebootContext {
  app: Express;
  container: ServiceContainer;
  hooks: HookSystem;
  router: RouterCollector;
  manifest: PluginManifest;
  rootDir: string;
  logger: PluginLogger;
}

export interface ActivateContext extends PrebootContext {
  db: SqliteDatabase;
  registerBlock(type: string, renderer: BlockRenderer): void;
  middleware(handler: RequestHandler): void;
  staticDir(dir: string): void;
  viewDir(dir: string): void;
}

export interface PluginEntry {
  preboot?: (context: PrebootContext) => Promise<void> | void;
  bootstrap?: (context: ActivateContext) => Promise<void> | void;
  activate?: (context: ActivateContext) => Promise<void> | void;
  deactivate?: (context: ActivateContext) => Promise<void> | void;
}
export type RegisteredRoute = { method: string; path: string; handler: RequestHandler[]; pluginId: string };
