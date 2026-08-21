import type { Express } from 'express';
import fs from 'fs-extra';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { SqliteDatabase } from './database.js';
import type { ActivateContext, PluginEntry, PluginManifest } from '../types/plugin.js';
import type { HookSystem } from './hook-system.js';
import type { RouterCollector } from './router-collector.js';

interface PluginRow { id: string; enabled: number; load_order: number; }

export class PluginManager {
  private loaded: Array<{ manifest: PluginManifest; entry: PluginEntry; context: ActivateContext }> = [];
  readonly viewPaths: string[] = [];
  readonly staticPaths: string[] = [];

  constructor(private app: Express, private db: SqliteDatabase, private hooks: HookSystem, private router: RouterCollector) {}

  scan(): PluginManifest[] {
    const root = path.join(process.cwd(), 'src', 'plugins');
    fs.ensureDirSync(root);
    const manifests: PluginManifest[] = [];
    for (const dir of fs.readdirSync(root)) {
      const manifestPath = path.join(root, dir, 'plugin.json');
      if (!fs.existsSync(manifestPath)) continue;
      const manifest = fs.readJsonSync(manifestPath) as PluginManifest;
      manifests.push(manifest);
      this.db.prepare(`INSERT INTO plugins(id,name,version,enabled,load_order) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, version=excluded.version`).run(manifest.id, manifest.name, manifest.version, 1, manifests.length * 10);
    }
    return manifests;
  }

  async loadAll(): Promise<void> {
    const manifests = new Map(this.scan().map((manifest) => [manifest.id, manifest]));
    const rows = this.db.prepare('SELECT id, enabled, load_order FROM plugins WHERE enabled = 1 ORDER BY load_order ASC, id ASC').all() as PluginRow[];
    for (const row of rows) {
      const manifest = manifests.get(row.id);
      if (manifest) await this.loadPlugin(manifest);
    }
  }

  private async loadPlugin(manifest: PluginManifest): Promise<void> {
    const pluginDir = path.join(process.cwd(), 'src', 'plugins', manifest.id);
    const entryPath = path.resolve(pluginDir, manifest.main);
    try {
      const entry = await import(pathToFileURL(entryPath).href) as PluginEntry;
      if (typeof entry.activate !== 'function') throw new Error('Plugin must export activate(context)');
      this.router.setCurrentPluginId(manifest.id);
      this.hooks.setCurrentPluginId(manifest.id);
      const context: ActivateContext = {
        app: this.app,
        db: this.db,
        hooks: this.hooks,
        router: this.router,
        staticDir: (dir) => this.staticPaths.push(path.resolve(pluginDir, dir)),
        viewDir: (dir) => this.viewPaths.push(path.resolve(pluginDir, dir)),
        logger: {
          info: (message) => console.log(`[${manifest.id}] ${message}`),
          error: (message) => console.error(`[${manifest.id}] ${message}`)
        }
      };
      if (manifest.views) context.viewDir(manifest.views);
      if (manifest.public) context.staticDir(manifest.public);
      await entry.activate(context);
      this.loaded.push({ manifest, entry, context });
    } catch (error) {
      console.error(`[${manifest.id}] Failed to activate`, error);
    } finally {
      this.router.setCurrentPluginId('core');
      this.hooks.setCurrentPluginId('core');
    }
  }

  getLoadedIds(): string[] { return this.loaded.map((item) => item.manifest.id); }

  setEnabled(id: string, enabled: boolean): void {
    this.db.prepare('UPDATE plugins SET enabled=? WHERE id=?').run(enabled ? 1 : 0, id);
  }

  async uninstall(id: string): Promise<void> {
    const item = this.loaded.find((entry) => entry.manifest.id === id);
    if (item) {
      await item.entry.deactivate?.(item.context);
      this.hooks.offPlugin(id);
      this.loaded = this.loaded.filter((entry) => entry.manifest.id !== id);
    }
    const pluginDir = path.join(process.cwd(), 'src', 'plugins', id);
    if (!path.resolve(pluginDir).startsWith(path.resolve(process.cwd(), 'src', 'plugins') + path.sep)) throw new Error('非法插件路径');
    await fs.remove(pluginDir);
    this.db.prepare('DELETE FROM plugins WHERE id=?').run(id);
  }

  async deactivateAll(): Promise<void> {
    for (const item of [...this.loaded].reverse()) {
      await item.entry.deactivate?.(item.context);
      this.hooks.offPlugin(item.manifest.id);
    }
  }
}
