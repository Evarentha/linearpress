import type { Express, RequestHandler } from 'express';
import type { SqliteDatabase } from '../core/database.js';

import type { HookSystem } from '../core/hook-system.js';
import type { RouterCollector } from '../core/router-collector.js';

export interface PluginManifest { id: string; name: string; version: string; description?: string; author?: string; type: 'backend' | 'frontend' | 'both' | 'theme'; main: string; permissions?: string[]; hooks?: Record<string, boolean>; views?: string; public?: string; }
export interface ActivateContext { app: Express; db: SqliteDatabase; hooks: HookSystem; router: RouterCollector; staticDir: (dir: string) => void; viewDir: (dir: string) => void; logger: { info: (msg: string) => void; error: (msg: string) => void } }
export interface PluginEntry { activate: (context: ActivateContext) => Promise<void> | void; deactivate?: (context: ActivateContext) => Promise<void> | void; }
export type RegisteredRoute = { method: string; path: string; handler: RequestHandler[]; pluginId: string };
