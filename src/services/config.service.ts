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
  const base: SiteConfig = { ...defaultConfig };
  try {
    const raw = readSetting(SITE_KEY);
    if (raw) {
      const stored = JSON.parse(raw) as Partial<SiteConfig>;
      return {
        ...base,
        ...stored,
        backupDomains: Array.isArray(stored.backupDomains) ? stored.backupDomains : base.backupDomains
      };
    }
  } catch {
    // 配置损坏时回退默认，避免站点崩溃。
  }
  return base;
}

export function setBaseConfig(patch: Partial<SiteConfig>): void {
  const next = { ...getBaseConfig(), ...patch };
  writeSetting(SITE_KEY, JSON.stringify(next));
}

export function isOobeCompleted(): boolean {
  try { return readSetting(OOBE_KEY) === '1'; }
  catch { return false; }
}

export function completeOobe(): void {
  writeSetting(OOBE_KEY, '1');
}
