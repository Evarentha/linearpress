/*
 * Author: MoyuZJ
 * Team: LinearTeam
 * Contact: linearteam@foxmail.com
 * Made by MoyuZJ in China with ♥
 */

import { db } from '../core/database.js';
import { siteConfig as defaultConfig } from '../../config/default.js';
import type { SiteConfig } from '../types/index.js';

const SITE_KEY = 'site';
const OOBE_KEY = 'oobeCompleted';

/**
 * 站点配置进程内缓存：配置读取发生在每个请求的多个环节（域名重定向/OOBE 门禁/locals 注入），
 * 缓存后仅在写入时失效，避免每次请求重复 SQLite 查询与 JSON.parse。
 */
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
