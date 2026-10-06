/*
 * LinearPress Plugin Manager
 *
 * Discovery, lifecycle and registry management for LinearPress plugins.
 *
 * Authors:
 * MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥
 * worryzu <worryzu@gmail.com> @LinearTeam
 *
 * Copyright (C) 2026 Evarentha
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * <p><code>PluginManager</code> discovers plugins under <code>src/plugins</code>
 * (manifest id must match the directory), imports and validates their entries,
 * and runs the preboot, bootstrap and activate phases inside per-plugin Cordis
 * fibers with plugin-scoped router, hook and admin registries.</p>
 * <p>It syncs the plugin registry into the infrastructure database, collects
 * manifest-declared views, static directories, styles and scripts, and
 * implements enable/load-order updates, uninstall with full teardown, and
 * reverse-order deactivation.</p>
 *
 * @since 2.0.1
 */

import type { Context } from 'cordis';
import express, { type Express, type RequestHandler } from 'express';
import fs from 'fs-extra';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { AdminExtensionRegistry, type AdminMenuEntry, type CustomSettingEntry, type PanelEntry } from './admin-extensions.js';
import { unregisterPluginBlocks } from './block-registry.js';
import { appendOwned } from './lifecycle-scope.js';
import { candidateRoot, pluginPath, validateManifest, validatePluginEntry, validatePluginId, validateRuntimeEntry } from './plugin-validation.js';
import { CordisRuntime } from './cordis-runtime.js';
import { guardSqliteDatabase, sqliteTransaction, type SqliteDatabase } from './database.js';
import type { HookSystem } from './hook-system.js';
import type { RouterCollector } from './router-collector.js';
import { createExpressWebAdapter, provideLinearPressServices, type LinearPressAdmin, type LinearPressWeb } from './linearpress-services.js';
import type { CordisPlugin, PluginEntry, PluginLogger, PluginManifest } from '../types/plugin.js';

interface PluginRow { id: string; enabled: number; load_order: number; }
interface Candidate { rootDir: string; realRoot: string; manifest: PluginManifest; entry?: PluginEntry; }
interface LoadedPlugin { candidate: Candidate; entry: PluginEntry; }
interface StaticMount { id: string; dir: string; }

export class PluginManager {
  private readonly cordis = new CordisRuntime();
  private candidates: Candidate[] = [];
  private loaded: LoadedPlugin[] = [];
  private failed = new Set<string>();
  private viewsMounted = false;
  readonly viewPaths: string[] = [];
  readonly staticMounts: StaticMount[] = [];
  readonly middlewares: RequestHandler[] = [];
  readonly styleUrls: string[] = [];
  readonly scriptUrls: string[] = [];
  private readonly web: LinearPressWeb;
  private readonly admin: LinearPressAdmin;
  private readonly adminRegistry = new AdminExtensionRegistry();

  constructor(private app: Express, private infrastructureDb: SqliteDatabase, private hooks: HookSystem, private router: RouterCollector) {
    this.infrastructureDb = guardSqliteDatabase(infrastructureDb);
    this.web = createExpressWebAdapter(this.router, this.middlewares, this.viewPaths, this.staticMounts, () => this.router.getCurrentPluginId(), () => this.refreshViews());
    this.admin = {
      registerMenu: (entry) => this.adminRegistry.registerMenu(entry),
      registerPanel: (html) => this.adminRegistry.registerPanel(html),
      registerCustomSetting: (entry) => this.adminRegistry.registerCustomSetting(entry)
    };
    provideLinearPressServices(this.context, { hooks: this.hooks, db: this.infrastructureDb, web: this.web, admin: this.admin });
  }

  get context(): Context { return this.cordis.context; }
  get database(): SqliteDatabase { return this.infrastructureDb; }
  get adminMenus(): AdminMenuEntry[] { return this.adminRegistry.listMenus(); }
  get adminPanels(): PanelEntry[] { return this.adminRegistry.listPanels(); }
  get customSettings(): CustomSettingEntry[] { return this.adminRegistry.listCustomSettings(); }
  customSettingsFor(id: string): CustomSettingEntry[] { return this.adminRegistry.customSettingsFor(id); }

  discover(): PluginManifest[] {
    const root = path.join(process.cwd(), 'src', 'plugins');
    fs.ensureDirSync(root);
    if (fs.lstatSync(root).isSymbolicLink()) throw new Error('Plugin root must not be a symlink');
    const discovered: Candidate[] = [];
    for (const dir of fs.readdirSync(root)) {
      const stat = fs.lstatSync(path.join(root, dir));
      if (stat.isSymbolicLink()) throw new Error(`Invalid plugin symlink: ${dir}`);
      if (!stat.isDirectory()) continue;
      const manifestPath = path.join(root, dir, 'plugin.json');
      if (!fs.existsSync(manifestPath)) continue;
      const rootDir = candidateRoot(root, dir);
      const manifest = validateManifest(fs.readJsonSync(pluginPath(rootDir, 'plugin.json')));
      pluginPath(rootDir, manifest.main);
      if (manifest.views) pluginPath(rootDir, manifest.views);
      if (manifest.public) pluginPath(rootDir, manifest.public);
      if (manifest.id !== dir) throw new Error(`Plugin directory must match manifest id: ${dir} != ${manifest.id}`);
      discovered.push({ rootDir, realRoot: fs.realpathSync(rootDir), manifest });
    }
    this.candidates = discovered;
    return this.candidates.map((item) => item.manifest);
  }

  async prebootAll(): Promise<void> {
    // Preboot precedes migrations on first launch, but existing disabled drivers
    // must not take ownership of root providers before bootstrap filters them.
    const hasRegistry = !!this.infrastructureDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='plugins'").get();
    for (const candidate of this.candidates.filter((item) => item.manifest.preboot)) {
      if (hasRegistry && (this.infrastructureDb.prepare('SELECT enabled FROM plugins WHERE id=?').get(candidate.manifest.id) as { enabled: number } | undefined)?.enabled === 0) continue;
      try {
        const entry = await this.importEntry(candidate);
        if (entry.preboot) await this.runPhase(candidate.manifest.id, entry.preboot);
      } catch (error) {
        for (const item of [...this.candidates].reverse()) await this.rollback(item.manifest.id);
        throw error;
      }
    }
  }

  async bootstrapEnabled(): Promise<void> {
    // 注册表同步：单事务批量写入；内容未变化的插件跳过 UPDATE，减少每次启动的写放大。
    const upsert = this.infrastructureDb.prepare(`INSERT INTO plugins(id,name,version,type,icon,description,enabled,load_order) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, version=excluded.version, type=excluded.type, icon=excluded.icon, description=excluded.description`);
    const selectRow = this.infrastructureDb.prepare('SELECT name,version,type,icon,description FROM plugins WHERE id=?');
    await sqliteTransaction(this.infrastructureDb, () => {
      this.candidates.forEach((candidate, index) => {
        const m = candidate.manifest;
        const existing = selectRow.get(m.id) as { name: string; version: string; type: string; icon: string | null; description: string | null } | undefined;
        const icon = m.icon ?? null;
        const description = m.description ?? null;
        if (existing && existing.name === m.name && existing.version === m.version && existing.type === m.type && existing.icon === icon && existing.description === description) return;
        upsert.run(m.id, m.name, m.version, m.type, icon, description, 1, (index + 1) * 10);
      });
    });
    const rows = this.infrastructureDb.prepare('SELECT id, enabled, load_order FROM plugins WHERE enabled=1 ORDER BY load_order ASC, id ASC').all() as PluginRow[];
    const byId = new Map(this.candidates.map((item) => [item.manifest.id, item]));
    this.loaded = [];

    for (const row of rows) {
      const candidate = byId.get(row.id);
      if (!candidate || this.failed.has(row.id)) continue;
      try {
        const entry = await this.importEntry(candidate);
        await this.runPhase(candidate.manifest.id, async (context) => {
          this.collectManifestResources(candidate.manifest);
          for (const permission of candidate.manifest.permissions ?? []) await context.permissions.register(permission, permission);
          if (entry.bootstrap) await entry.bootstrap(context);
        });
        this.loaded.push({ candidate, entry });
      } catch (error) { await this.rollback(candidate.manifest.id); console.error(`[${candidate.manifest.id}] Failed to bootstrap`, error); }
    }
  }

  async activateAll(): Promise<void> {
    for (const item of [...this.loaded]) {
      const { manifest } = item.candidate;
      try {
        const activate = item.entry.default ?? item.entry.activate;
        await this.runPhase(manifest.id, async (context) => {
          if (activate) await activate(context);
          await this.hooks.trigger('plugin:afterLoad', { id: manifest.id, name: manifest.name, version: manifest.version });
        });
      } catch (error) { await this.rollback(manifest.id); console.error(`[${manifest.id}] Failed to activate`, error); }
    }
  }

  private runPhase(id: string, phase: CordisPlugin): Promise<void> {
    return this.cordis.run(id, (context) => this.withPlugin(id, () => phase(context)));
  }

  private async importEntry(candidate: Candidate): Promise<PluginEntry> {
    if (candidate.entry) return candidate.entry;
    const entryPath = validatePluginEntry(candidate.rootDir, candidate.manifest.main);
    // Module initialization can itself register renderers/hooks. Give imports a
    // fiber too so validation/activation failure cannot strand those resources.
    const entry = await this.cordis.run(candidate.manifest.id, async () => {
      const imported = await import(pathToFileURL(entryPath).href) as PluginEntry;
      validateRuntimeEntry(imported);
      return imported;
    });
    candidate.entry = entry;
    return entry;
  }

  private logger(id: string): PluginLogger {
    return { info: (message) => console.log(`[${id}] ${message}`), error: (message) => console.error(`[${id}] ${message}`) };
  }

  private collectManifestResources(manifest: PluginManifest): void {
    const rootDir = this.candidates.find((item) => item.manifest.id === manifest.id)?.rootDir;
    if (!rootDir) return;
    if (manifest.views) appendOwned(this.viewPaths, pluginPath(rootDir, manifest.views), () => this.refreshViews());
    if (manifest.public) appendOwned(this.staticMounts, { id: manifest.id, dir: pluginPath(rootDir, manifest.public) });
    for (const style of manifest.styles ?? []) appendOwned(this.styleUrls, `/plugins/${manifest.id}/${style}`);
    for (const script of manifest.scripts ?? []) appendOwned(this.scriptUrls, `/plugins/${manifest.id}/${script}`);
  }

  private async withPlugin<T>(_id: string, callback: () => Promise<T> | T): Promise<T> {
    // CordisRuntime's async-local scope owns all registrations. Never mutate
    // global defaults across awaits (HTTP requests can register concurrently).
    return callback();
  }

  getLoadedIds(): string[] { return this.loaded.map((item) => item.candidate.manifest.id); }
  isLoaded(id: string): boolean { return this.loaded.some((item) => item.candidate.manifest.id === id); }
  setEnabled(id: string, enabled: boolean): void { this.infrastructureDb.prepare('UPDATE plugins SET enabled=? WHERE id=?').run(enabled ? 1 : 0, id); }
  setLoadOrder(id: string, order: number): void { this.infrastructureDb.prepare('UPDATE plugins SET load_order=? WHERE id=?').run(order, id); }

  private async rollback(id: string): Promise<void> {
    this.failed.add(id);
    // Fibers own resources from *all* phases, including preboot/bootstrap.
    try { await this.cordis.dispose(id); }
    finally {
      this.router.removePlugin(id);
      this.hooks.offPlugin(id);
      unregisterPluginBlocks(id);
      this.adminRegistry.removePlugin(id);
      this.loaded = this.loaded.filter((item) => item.candidate.manifest.id !== id);
      this.refreshViews();
    }
  }

  mountStaticResources(): void {
    this.viewsMounted = true;
    this.refreshViews();
    let snapshot: StaticMount[] = [];
    let dispatcher = express.Router();
    this.app.use((req, res, next) => {
      if (snapshot.length !== this.staticMounts.length || snapshot.some((mount, index) => mount !== this.staticMounts[index])) {
        snapshot = [...this.staticMounts];
        dispatcher = express.Router();
        const groups = new Map<string, string[]>();
        for (const mount of snapshot) groups.set(mount.id, [...(groups.get(mount.id) ?? []), mount.dir]);
        for (const [id, dirs] of [...groups].reverse()) dispatcher.use(`/plugins/${id}`, ...dirs.map((dir) => express.static(dir)));
      }
      dispatcher(req, res, next);
    });
  }
  mountMiddlewares(): void {
    let snapshot: RequestHandler[] = [];
    let dispatcher = express.Router();
    this.app.use((req, res, next) => {
      if (snapshot.length !== this.middlewares.length || snapshot.some((handler, index) => handler !== this.middlewares[index])) {
        snapshot = [...this.middlewares];
        dispatcher = express.Router();
        for (const middleware of snapshot) dispatcher.use(middleware);
      }
      dispatcher(req, res, next);
    });
  }
  private refreshViews(): void {
    if (!this.viewsMounted) return;
    this.app.set('views', [...this.viewPaths].reverse().concat(path.join(process.cwd(), 'src', 'views')));
    // Express production caches resolved view paths, not just template bytes.
    (this.app as Express & { cache: Record<string, unknown> }).cache = {};
  }

  async uninstall(id: string): Promise<void> {
    validatePluginId(id);
    const candidate = this.candidates.find((entry) => entry.manifest.id === id);
    if (!candidate) throw new Error(`Unknown plugin: ${id}`);
    const root = candidateRoot(path.join(process.cwd(), 'src', 'plugins'), id);
    if (root !== candidate.rootDir || fs.realpathSync(root) !== candidate.realRoot) throw new Error('Plugin directory changed since discovery');
    await this.rollback(id);
    // Recheck immediately before deletion; never synthesize an unknown path.
    if (fs.realpathSync(candidateRoot(path.join(process.cwd(), 'src', 'plugins'), id)) !== candidate.realRoot) throw new Error('Plugin directory changed during teardown');
    await fs.remove(root);
    this.candidates = this.candidates.filter((entry) => entry !== candidate);
    this.infrastructureDb.prepare('DELETE FROM plugins WHERE id=?').run(id);
  }

  async deactivateAll(): Promise<void> {
    const ids = [...new Set([...this.loaded.map((item) => item.candidate.manifest.id).reverse(), ...this.candidates.map((item) => item.manifest.id).reverse()])];
    const errors: unknown[] = [];
    for (const id of ids) { try { await this.rollback(id); } catch (error) { errors.push(error); } }
    try { await this.cordis.disposeAll(); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, 'Plugin teardown failed');
  }
}
