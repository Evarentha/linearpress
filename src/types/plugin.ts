/*
 * Author: MoyuZJ
 * Team: LinearTeam
 * Contact: linearteam@foxmail.com
 * Made by MoyuZJ in China with ♥
 */

import type { Context } from 'cordis';

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  type: 'backend' | 'frontend' | 'both' | 'theme' | 'driver';
  main: string;
  runtime?: 'legacy' | 'cordis';
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

export type CordisPlugin = (context: Context) => Promise<void> | void;

export interface PluginEntry {
  preboot?: CordisPlugin;
  bootstrap?: CordisPlugin;
  activate?: CordisPlugin;
  default?: CordisPlugin;
}

export type RegisteredRoute = { method: string; path: string; handler: import('express').RequestHandler[]; pluginId: string };
