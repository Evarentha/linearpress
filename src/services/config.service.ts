/*
 * LinearPress Site Configuration Service
 *
 * Persisted site configuration with an in-process cache.
 *
 * Authors:
 * MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥
 * worryzu <worryzu@gmail.com> @LinearTeam
 *
 * Copyright (C) 2026 Evarentha
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * <p>Persists site configuration in the <code>settings</code> table: stored
 * values overlay the defaults from <code>config/default.ts</code>, missing
 * fields fall back to the defaults, and corrupt stored values fall back to
 * the defaults rather than crash the site. OOBE completion is tracked the
 * same way.</p>
 * <p>Configuration is read in several stages of every request (domain
 * redirection, the OOBE gate, locals injection), so it is cached in-process
 * and invalidated only on write, avoiding repeated SQLite queries and JSON
 * parsing per request.</p>
 *
 * @since 2.0.1
 */

import { db } from '../core/database.js';
import { siteConfig as defaultConfig } from '../../config/default.js';
import type { SiteConfig } from '../types/index.js';

const SITE_KEY = 'site';
const OOBE_KEY = 'oobeCompleted';

let configCache: SiteConfig | undefined;
let oobeCache: boolean | undefined;
const invalidateConfigCache = (): void => { configCache = undefined; oobeCache = undefined; };

function readSetting(key: string): string | undefined {
  try {
    return (db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined)?.value;
  } catch {
    return undefined;
  }
}

function writeSetting(key: string, value: string): void {
  db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
}

/** 读取站点配置：持久化值覆盖默认值，缺失字段回退到默认。 */
export function getBaseConfig(): SiteConfig {
  if (configCache) return configCache;
  const base: SiteConfig = { ...defaultConfig };
  let resolved = base;
  try {
    const raw = readSetting(SITE_KEY);
    if (raw) {
      const stored = JSON.parse(raw) as Partial<SiteConfig>;
      resolved = {
        ...base,
        ...stored,
        backupDomains: Array.isArray(stored.backupDomains) ? stored.backupDomains : base.backupDomains
      };
    }
  } catch {
    // 配置损坏时回退默认，避免站点崩溃。
  }
  configCache = resolved;
  return resolved;
}

export function setBaseConfig(patch: Partial<SiteConfig>): void {
  const next = { ...getBaseConfig(), ...patch };
  writeSetting(SITE_KEY, JSON.stringify(next));
  invalidateConfigCache();
}

export function isOobeCompleted(): boolean {
  if (oobeCache !== undefined) return oobeCache;
  let value = false;
  try { value = readSetting(OOBE_KEY) === '1'; } catch { value = false; }
  oobeCache = value;
  return value;
}

export function completeOobe(): void {
  writeSetting(OOBE_KEY, '1');
  invalidateConfigCache();
}
