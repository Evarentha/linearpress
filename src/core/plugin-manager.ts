/*
 * Author: MoyuZJ
 * Team: LinearTeam
 * Contact: linearteam@foxmail.com
 * Made by MoyuZJ in China with ♥
 */

import type { Context } from 'cordis';
import type { Express, RequestHandler } from 'express';
import fs from 'fs-extra';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { registerBlock, unregisterPluginBlocks } from './block-registry.js';
import { CordisRuntime } from './cordis-runtime.js';
import type { SqliteDatabase } from './database.js';
import type { HookSystem } from './hook-system.js';
import type { RouterCollector } from './router-collector.js';
import { createExpressWebAdapter, provideLinearPressServices, type LinearPressWeb } from './linearpress-services.js';
import type { CordisPlugin, PluginEntry, PluginLogger, PluginManifest } from '../types/plugin.js';

interface PluginRow { id: string; enabled: number; load_order: number; }
interface Candidate { rootDir: string; manifest: PluginManifest; entry?: PluginEntry; }
interface LoadedPlugin { candidate: Candidate; entry: PluginEntry; }
interface StaticMount { id: string; dir: string; }

export class PluginManager {
  private readonly cordis = new CordisRuntime();
  private candidates: Candidate[] = [];
  private loaded: LoadedPlugin[] = [];
  readonly viewPaths: string[] = [];
  readonly staticMounts: StaticMount[] = [];
  readonly middlewares: RequestHandler[] = [];
  readonly styleUrls: string[] = [];
  readonly scriptUrls: string[] = [];
  private readonly web: LinearPressWeb;

  constructor(private app: Express, private infrastructureDb: SqliteDatabase, private hooks: HookSystem, private router: RouterCollector) {
    this.web = createExpressWebAdapter(this.router, this.middlewares, this.viewPaths, this.staticMounts, () => this.router.getCurrentPluginId());
    provideLinearPressServices(this.context, { hooks: this.hooks, db: this.infrastructureDb, web: this.web });
  }

  get context(): Context { return this.cordis.context; }
  get database(): SqliteDatabase { return this.infrastructureDb; }

  discover(): PluginManifest[] {
    const root = path.join(process.cwd(), 'src', 'plugins');
    fs.ensureDirSync(root);
    this.candidates = [];
    for (const dir of fs.readdirSync(root)) {
      const rootDir = path.join(root, dir);
      const manifestPath = path.join(rootDir, 'plugin.json');
      if (!fs.existsSync(manifestPath)) continue;
      const manifest = fs.readJsonSync(manifestPath) as PluginManifest;
      if (manifest.id !== dir) throw new Error(`Plugin directory must match manifest id: ${dir} != ${manifest.id}`);
      this.candidates.push({ rootDir, manifest });
    }
    return this.candidates.map((item) => item.manifest);
  }

  async prebootAll(): Promise<void> {
    for (const candidate of this.candidates.filter((item) => item.manifest.preboot)) {
      const entry = await this.importEntry(candidate);
      if (!entry.preboot) continue;
      await this.runPhase(candidate.manifest.id, entry.preboot);
    }
  }

  async bootstrapEnabled(): Promise<void> {
    const insert = this.infrastructureDb.prepare(`INSERT INTO plugins(id,name,version,enabled,load_order) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, version=excluded.version`);
    this.candidates.forEach((candidate, index) => insert.run(candidate.manifest.id, candidate.manifest.name, candidate.manifest.version, 1, (index + 1) * 10));
    const rows = this.infrastructureDb.prepare('SELECT id, enabled, load_order FROM plugins WHERE enabled=1 ORDER BY load_order ASC, id ASC').all() as PluginRow[];
    const byId = new Map(this.candidates.map((item) => [item.manifest.id, item]));
    this.loaded = [];

    for (const row of rows) {
      const candidate = byId.get(row.id);
      if (!candidate) continue;
      try {
        const entry = await this.importEntry(candidate);
        await this.runPhase(candidate.manifest.id, async (context) => {
          this.collectManifestResources(candidate.manifest);
          for (const permission of candidate.manifest.permissions ?? []) await context.permissions.register(permission, permission);
          if (entry.bootstrap) await entry.bootstrap(context);
        });
        this.loaded.push({ candidate, entry });
      } catch (error) { console.error(`[${candidate.manifest.id}] Failed to bootstrap`, error); }
    }
  }

  async activateAll(): Promise<void> {
    for (const item of this.loaded) {
      const { manifest } = item.candidate;
      try {
        const activate = item.entry.default ?? item.entry.activate;
        await this.runPhase(manifest.id, async (context) => {
          if (activate) await activate(context);
          await this.hooks.trigger('plugin:afterLoad', { id: manifest.id, name: manifest.name, version: manifest.version });
        });
      } catch (error) { console.error(`[${manifest.id}] Failed to activate`, error); }
    }
  }

  private runPhase(id: string, phase: CordisPlugin): Promise<void> {
    return this.cordis.run(id, (context) => this.withPlugin(id, () => phase(context)));
  }

  private async importEntry(candidate: Candidate): Promise<PluginEntry> {
    if (candidate.entry) return candidate.entry;
    const entryPath = path.resolve(candidate.rootDir, candidate.manifest.main);
    candidate.entry = await import(pathToFileURL(entryPath).href) as PluginEntry;
    if (!candidate.entry.preboot && !candidate.entry.bootstrap && !candidate.entry.activate && !candidate.entry.default) throw new Error('Plugin must export a Cordis default plugin or preboot/bootstrap/activate function');
    return candidate.entry;
  }

  private logger(id: string): PluginLogger {
    return { info: (message) => console.log(`[${id}] ${message}`), error: (message) => console.error(`[${id}] ${message}`) };
  }

  private collectManifestResources(manifest: PluginManifest): void {
    const rootDir = this.candidates.find((item) => item.manifest.id === manifest.id)?.rootDir;
    if (!rootDir) return;
    if (manifest.views) { const dir = path.resolve(rootDir, manifest.views); if (!this.viewPaths.includes(dir)) this.viewPaths.push(dir); }
    if (manifest.public) { const dir = path.resolve(rootDir, manifest.public); if (!this.staticMounts.some((mount) => mount.id === manifest.id && mount.dir === dir)) this.staticMounts.push({ id: manifest.id, dir }); }
    for (const style of manifest.styles ?? []) this.styleUrls.push(`/plugins/${manifest.id}/${style}`);
    for (const script of manifest.scripts ?? []) this.scriptUrls.push(`/plugins/${manifest.id}/${script}`);
  }

  private async withPlugin<T>(id: string, callback: () => Promise<T> | T): Promise<T> {
    this.router.setCurrentPluginId(id);
    this.hooks.setCurrentPluginId(id);
    try { return await callback(); }
    finally { this.router.setCurrentPluginId('core'); this.hooks.setCurrentPluginId('core'); }
  }

  getLoadedIds(): string[] { return this.loaded.map((item) => item.candidate.manifest.id); }
  isLoaded(id: string): boolean { return this.loaded.some((item) => item.candidate.manifest.id === id); }
  setEnabled(id: string, enabled: boolean): void { this.infrastructureDb.prepare('UPDATE plugins SET enabled=? WHERE id=?').run(enabled ? 1 : 0, id); }
  setLoadOrder(id: string, order: number): void { this.infrastructureDb.prepare('UPDATE plugins SET load_order=? WHERE id=?').run(order, id); }

  async uninstall(id: string): Promise<void> {
    const item = this.loaded.find((entry) => entry.candidate.manifest.id === id);
    if (item) {
      await this.cordis.dispose(id);
      this.hooks.offPlugin(id);
      unregisterPluginBlocks(id);
      this.loaded = this.loaded.filter((entry) => entry.candidate.manifest.id !== id);
    }
    for (let i = this.staticMounts.length - 1; i >= 0; i--) if (this.staticMounts[i].id === id) this.staticMounts.splice(i, 1);
    for (let i = this.styleUrls.length - 1; i >= 0; i--) if (this.styleUrls[i].startsWith(`/plugins/${id}/`)) this.styleUrls.splice(i, 1);
    for (let i = this.scriptUrls.length - 1; i >= 0; i--) if (this.scriptUrls[i].startsWith(`/plugins/${id}/`)) this.scriptUrls.splice(i, 1);
    const candidate = this.candidates.find((entry) => entry.manifest.id === id);
    if (candidate) await fs.remove(candidate.rootDir);
    if (!candidate) await fs.remove(path.join(process.cwd(), 'src', 'plugins', id)).catch(() => undefined);
    this.infrastructureDb.prepare('DELETE FROM plugins WHERE id=?').run(id);
  }

  async deactivateAll(): Promise<void> {
    for (const item of [...this.loaded].reverse()) {
      await this.cordis.dispose(item.candidate.manifest.id);
      this.hooks.offPlugin(item.candidate.manifest.id);
      unregisterPluginBlocks(item.candidate.manifest.id);
    }
    await this.cordis.disposeAll();
  }
}
