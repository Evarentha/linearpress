/*
 * LinearPress Plugin Contracts
 *
 * Plugin manifest, entry and runtime support types.
 *
 * Authors:
 * MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥
 *
 * Copyright (C) 2026 Evarentha
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Defines <code>PluginManifest</code> (metadata, lifecycle flags and
 * resource declarations), the generic block and renderer types, the plugin
 * logger, the <code>CordisPlugin</code> phase functions and
 * <code>PluginEntry</code> export shape, and <code>RegisteredRoute</code>.
 *
 * @since 2.0.1
 */

import type { Context } from 'cordis';

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  icon?: string;
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
