/*
 * Author: MoyuZJ
 * Team: LinearTeam
 * Contact: linearteam@foxmail.com
 * Made by MoyuZJ in China with ♥
 */

import fs from 'fs-extra';
import path from 'node:path';
import type { SqliteDatabase } from './database.js';
import { LINEARPRESS_VERSION } from './version.js';

export type MaintenanceReason = 'update' | 'plugin' | 'fatal' | 'manual';

export interface MaintenanceTask {
  id: string;
  label: string;
  /** 0-100 的完成进度。 */
  progress: number;
  status: 'running' | 'done' | 'failed';
}

export interface MaintenanceSnapshot {
  reason: MaintenanceReason;
  startedAt: string;
  tasks: MaintenanceTask[];
}

/** 核心插件白名单：进入维护模式时这些基础插件保持启用。 */
export const CORE_PLUGIN_WHITELIST = new Set(['seo', 'minimal-theme']);

const LOGS_DIR = path.join(process.cwd(), '.logs');
const STATIC_PAGE = path.join(process.cwd(), 'data', 'maintenance.html');
const esc = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]!));

/**
 * 维护模式管理器。
 * 维护页是即时生成的静态 HTML，脱离框架动态渲染引擎，防止服务端二次崩溃。
 */
export class MaintenanceManager {
  private snapshot: MaintenanceSnapshot | undefined;
  private disabledPlugins: Array<{ id: string }> = [];
  private siteNameProvider: () => string = () => 'LINEARPRESS';

  isEnabled(): boolean { return this.snapshot !== undefined; }
  reason(): MaintenanceReason | undefined { return this.snapshot?.reason; }
  tasks(): MaintenanceTask[] { return this.snapshot?.tasks ?? []; }

  setSiteNameProvider(provider: () => string): void { this.siteNameProvider = provider; }

  enter(reason: MaintenanceReason, database?: SqliteDatabase): MaintenanceSnapshot {
    if (this.snapshot) return this.snapshot;
    this.snapshot = { reason, startedAt: new Date().toISOString(), tasks: [] };
    this.writeStaticPage();
    return this.snapshot;
  }

  exit(database?: SqliteDatabase): void {
    if (!this.snapshot) return;
    this.disabledPlugins = [];
    this.snapshot = undefined;
    fs.remove(STATIC_PAGE).catch(() => undefined);
  }

  addTask(id: string, label: string): MaintenanceTask {
    if (!this.snapshot) this.snapshot = { reason: 'manual', startedAt: new Date().toISOString(), tasks: [] };
    const task: MaintenanceTask = { id, label, progress: 0, status: 'running' };
    this.snapshot.tasks.push(task);
    this.writeStaticPage();
    return task;
  }

  updateTask(id: string, patch: Partial<Pick<MaintenanceTask, 'label' | 'progress' | 'status'>>): void {
    const task = this.tasks().find((item) => item.id === id);
    if (!task) return;
    Object.assign(task, patch);
    this.writeStaticPage();
  }

  /** 进入维护模式时临时禁用非白名单插件（供更新流程显式调用）。 */
  suspendNonWhitelistedPlugins(database: SqliteDatabase): void {
    const rows = database.prepare('SELECT id FROM plugins WHERE enabled=1').all() as Array<{ id: string }>;
    const update = database.prepare('UPDATE plugins SET enabled=0 WHERE id=?');
    this.disabledPlugins = [];
    for (const row of rows) {
      if (CORE_PLUGIN_WHITELIST.has(row.id)) continue;
      update.run(row.id);
      this.disabledPlugins.push({ id: row.id });
    }
  }

  /** 恢复被 suspendNonWhitelistedPlugins 禁用的插件。 */
  restoreSuspendedPlugins(database: SqliteDatabase): void {
    const update = database.prepare('UPDATE plugins SET enabled=1 WHERE id=?');
    for (const item of this.disabledPlugins) update.run(item.id);
    this.disabledPlugins = [];
  }

  /** 致命错误 dump 到本地 .logs 目录。 */
  dumpError(error: unknown): string {
    fs.ensureDirSync(LOGS_DIR);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(LOGS_DIR, `fatal-${stamp}.log`);
    const content = `LinearPress fatal error dump\nVersion: ${LINEARPRESS_VERSION}\nTime: ${new Date().toISOString()}\n\n${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`;
    fs.writeFileSync(file, content);
    return file;
  }

  siteName(): string {
    try { return this.siteNameProvider(); }
    catch { return 'LINEARPRESS'; }
  }

  /** 生成静态维护页 HTML（并写入磁盘）。 */
  writeStaticPage(): string {
    const snapshot = this.snapshot ?? { reason: 'manual' as MaintenanceReason, startedAt: new Date().toISOString(), tasks: [] };
    const tasksHtml = snapshot.tasks.length
      ? `<ul class="m-tasks">${snapshot.tasks.map((task) => `<li><span>${esc(task.label)}</span>${task.status === 'done' ? '<em>完成</em>' : `<div class="m-bar"><i style="width:${Math.max(0, Math.min(100, task.progress))}%"></i></div>`}</li>`).join('')}</ul>`
      : `<p class="m-idle">当前没有正在执行的任务。</p>`;
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>维护模式 · ${esc(this.siteName())}</title><style>${MAINTENANCE_CSS}</style></head><body><main class="m-card"><p class="m-eyebrow">MAINTENANCE MODE</p><h1>${esc(this.siteName())} 已进入维护模式</h1><section class="m-panel"><h2>任务队列</h2>${tasksHtml}<p class="m-please">请稍后！</p></section><section class="m-why"><h2>为什么会遇到此页面？</h2><p>本站点正在进行维护，以防破坏程序或功能。在此期间，站点功能将不可用。不过请不要担心，您的个人数据仍然完好，并安全地保存在服务器中。</p><p>请耐心等待几分钟，然后刷新页面。如果问题仍然存在，请联系站点管理员。</p><p class="m-admin">您（或具有权限的用户）启动了更新/安装流程，或者程序持续运行中遇到了罕见技术错误。为保证数据安全，维护模式已启用。请查看 <code>logs</code> 目录下的日志以了解详情。</p></section></main></body></html>`;
    fs.ensureDirSync(path.dirname(STATIC_PAGE));
    fs.writeFileSync(STATIC_PAGE, html);
    return html;
  }

  render(): string {
    try { return fs.readFileSync(STATIC_PAGE, 'utf8'); }
    catch { return this.writeStaticPage(); }
  }

  /** 渲染一次性的 500 错误页：即时生成、不写盘、不改变维护模式状态。 */
  renderFatalPage(): string {
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>服务器错误 · ${esc(this.siteName())}</title><style>${MAINTENANCE_CSS}</style></head><body><main class="m-card"><p class="m-eyebrow">ERROR</p><h1>页面出错了</h1><section class="m-panel"><p class="m-please">服务器处理该请求时遇到异常，已记录日志。站点其余功能不受影响，请稍后重试。</p></section></main></body></html>`;
    return html;
  }

  /** 维护模式下的路径穿透：管理员仍可访问 /login 与 /admin。 */
  isBypassPath(pathname: string): boolean {
    if (pathname === '/login' || pathname.startsWith('/login')) return true;
    if (pathname === '/admin' || pathname.startsWith('/admin')) return true;
    if (pathname === '/oobe' || pathname.startsWith('/oobe')) return true;
    if (pathname.startsWith('/css/') || pathname.startsWith('/js/')) return true;
    if (pathname.startsWith('/plugins/') || pathname.startsWith('/uploads/') || pathname.startsWith('/media-library/')) return true;
    if (pathname === '/favicon.ico') return true;
    return false;
  }
}

export const maintenance = new MaintenanceManager();

const MAINTENANCE_CSS = `*{box-sizing:border-box}body{margin:0;background:#0f0f0f;color:#eee;font-family:Arial,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}.m-card{max-width:760px;width:100%}.m-eyebrow{font-size:11px;letter-spacing:.18em;color:#888}.m-card h1{font:400 clamp(30px,6vw,56px) Georgia,serif;margin:18px 0 30px;line-height:1}.m-panel{border:1px solid #333;background:#161616;padding:24px;margin-bottom:26px}.m-panel h2,.m-why h2{font:400 20px Georgia,serif;margin:0 0 18px;color:#ddd}.m-tasks{list-style:none;margin:0 0 20px;padding:0}.m-tasks li{display:flex;justify-content:space-between;gap:16px;align-items:center;border-bottom:1px solid #262626;padding:13px 0;font-size:14px}.m-tasks li em{font-style:normal;color:#7bc47f}.m-bar{flex:1;max-width:240px;height:8px;background:#2a2a2a;border-radius:99px;overflow:hidden}.m-bar i{display:block;height:100%;background:#eee;transition:width .3s}.m-please{color:#bbb;font-size:15px}.m-why{color:#999;line-height:1.8;font-size:14px}.m-why p{margin:0 0 14px}.m-admin{border-left:3px solid #555;padding-left:14px;color:#bbb}.m-why code{background:#1f1f1f;padding:2px 7px;border-radius:4px;color:#ddd}`;
