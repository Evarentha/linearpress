/*
 * Durable managed plugin installation and boot verification.
 *
 * Implements the plugin install jobs module for LinearPress.
 *
 * Authors:
 * MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥
 * worryzu <worryzu@gmail.com> @LinearTeam
 *
 * Copyright (C) 2026 Evarentha
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PluginManager } from './plugin-manager.js';
import { validatePluginId } from './plugin-validation.js';
import { maintenance } from './maintenance.js';
import { requestRestart } from './restart.js';
import { preparePluginInstall, reapPluginInstallStaging, type PluginInstallResult } from '../services/plugin-installer.js';
import { releaseInstallOwnership, removeOwnedInstallRow } from '../services/plugin-install-ownership.js';

export type InstallPhase = 'validating' | 'installing' | 'restarting' | 'verifying' | 'recovering' | 'completed' | 'failed';
export interface InstallJob {
  id: string; phase: InstallPhase; message: string; plugins: PluginInstallResult[];
  createdAt: string; updatedAt: string; restartRequested: boolean; errors?: string[];
}
interface InstallJournal extends InstallJob { schema: 1; expectedIds: string[]; recoveryCount: number; }
export type InstallSource = { kind: 'lpp' | 'zip'; buffer: Buffer } | { kind: 'npm'; spec: string };
const DATA = path.resolve(process.cwd(), 'data');
const JOURNAL = path.join(DATA, 'plugin-install-job.json');
const HISTORY = path.join(DATA, 'plugin-install-jobs');
const QUARANTINE = path.join(DATA, 'plugin-install-quarantine');
const MARKER = '.linearpress-install.json';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const phases: InstallPhase[] = ['validating', 'installing', 'restarting', 'verifying', 'recovering', 'completed', 'failed'];
let busy = false;
export class InstallConflict extends Error { readonly status = 409; }
function ensureDirectory(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  if (fs.lstatSync(dir).isSymbolicLink() || !fs.lstatSync(dir).isDirectory()) throw new Error('Installation state directory must be a real directory');
}
function atomicJson(file: string, value: unknown): void {
  ensureDirectory(path.dirname(file));
  const temp = `${file}.${randomUUID()}.tmp`;
  let fd: number | undefined;
  try {
    fd = fs.openSync(temp, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify(value, null, 2)); fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    fs.renameSync(temp, file);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.rmSync(temp, { force: true }); }
    catch (error) { console.error('[plugin-install] temporary state cleanup deferred', error); }
  }
}
function validateJournal(value: unknown): InstallJournal {
  if (!value || typeof value !== 'object') throw new Error('Invalid installation journal');
  const j = value as InstallJournal;
  if (j.schema !== 1 || !UUID.test(j.id) || !phases.includes(j.phase) || !Array.isArray(j.plugins) || j.plugins.length !== 1 || !Array.isArray(j.expectedIds) || !Number.isInteger(j.recoveryCount) || j.recoveryCount < 0 || j.recoveryCount > 2) throw new Error('Invalid installation journal');
  if (typeof j.message !== 'string' || typeof j.createdAt !== 'string' || typeof j.updatedAt !== 'string' || typeof j.restartRequested !== 'boolean' || (j.errors !== undefined && (!Array.isArray(j.errors) || j.errors.some(error => typeof error !== 'string')))) throw new Error('Invalid journal fields');
  for (const p of j.plugins) { validatePluginId(p.id); if (typeof p.name !== 'string' || typeof p.version !== 'string') throw new Error('Invalid journal plugin'); }
  for (const id of j.expectedIds) validatePluginId(id);
  return j;
}
function readJournal(): InstallJournal | undefined {
  if (!fs.existsSync(JOURNAL)) return undefined;
  if (fs.lstatSync(JOURNAL).isSymbolicLink()) throw new Error('Installation journal cannot be a symlink');
  return validateJournal(JSON.parse(fs.readFileSync(JOURNAL, 'utf8')));
}
function terminal(job: InstallJournal): boolean { return job.phase === 'completed' || job.phase === 'failed'; }
/** A retained terminal journal is an archival obligation, not an unfinished deployment. */
export function hasPendingInstall(): boolean { const job = readJournal(); return busy || (!!job && !terminal(job)); }
function save(job: InstallJournal, phase: InstallPhase, message: string): void {
  const current = readJournal();
  if ((current?.id === job.id && terminal(current)) || terminal(job)) throw new Error('Installation terminal state cannot change');
  const next = { ...job, phase, message, updatedAt: new Date().toISOString() };
  atomicJson(JOURNAL, next);
  Object.assign(job, next); // Do not advance in memory until the authoritative write succeeds.
  if (!terminal(job)) atomicJson(path.join(HISTORY, `${job.id}.json`), job);
}
/** Never discard the authoritative terminal journal until history AND marker cleanup succeed. */
function archiveTerminal(job: InstallJournal): boolean {
  if (!terminal(job)) return false;
  try {
    atomicJson(path.join(HISTORY, `${job.id}.json`), job);
    if (job.phase === 'completed') {
      for (const plugin of job.plugins) {
        const dest = pluginLocation(plugin.id);
        if (ownedBy(dest, job.id, true)) fs.rmSync(path.join(dest, MARKER), { force: true });
      }
    }
    fs.rmSync(JOURNAL, { force: true });
  } catch (error) { console.error('[plugin-install] terminal archival deferred', error); return false; }
  // History retention is housekeeping, never a reason to turn successful verification into failure.
  try {
    const files = fs.readdirSync(HISTORY).filter(name => UUID.test(name.replace(/\.json$/, '')) && name.endsWith('.json') && !fs.lstatSync(path.join(HISTORY, name)).isSymbolicLink());
    files.sort((a, b) => fs.statSync(path.join(HISTORY, b)).mtimeMs - fs.statSync(path.join(HISTORY, a)).mtimeMs);
    for (const file of files.slice(100)) fs.rmSync(path.join(HISTORY, file));
  } catch (error) { console.error('[plugin-install] history pruning deferred', error); }
  return true;
}
function finish(job: InstallJournal, phase: 'completed' | 'failed', message: string): void {
  save(job, phase, message);
  archiveTerminal(job);
}
/** App calls before discovery; recovery and prepare also reap stages without importing plugin code. */
export function runPluginInstallHousekeeping(): void {
  reapPluginInstallStaging();
  const job = readJournal();
  if (job && terminal(job)) archiveTerminal(job);
}
function desiredExpectedIds(manager: PluginManager, ids: string[], snapshot = false): string[] {
  return [...new Set(ids)].filter(id => {
    const row = manager.database.prepare('SELECT enabled FROM plugins WHERE id=?').get(id) as { enabled: number } | undefined;
    // Old journals may include deliberately disabled plugins; a missing registry row is not a disable.
    return snapshot ? row?.enabled === 1 : row?.enabled !== 0;
  });
}
function publicJob(job: InstallJournal): InstallJob {
  const { id, phase, message, plugins, createdAt, updatedAt, restartRequested, errors } = job;
  return { id, phase, message, plugins, createdAt, updatedAt, restartRequested, ...(errors ? { errors } : {}) };
}
export function getInstallJob(id: string): InstallJob | undefined {
  if (!UUID.test(id)) return undefined;
  const current = readJournal();
  if (current?.id === id) { if (terminal(current)) archiveTerminal(current); return publicJob(current); }
  const file = path.join(HISTORY, `${id}.json`);
  if (!fs.existsSync(file) || fs.lstatSync(file).isSymbolicLink()) return undefined;
  return publicJob(validateJournal(JSON.parse(fs.readFileSync(file, 'utf8'))));
}
function pluginLocation(id: string): string {
  validatePluginId(id);
  const root = path.resolve(process.cwd(), 'src', 'plugins');
  if (fs.lstatSync(root).isSymbolicLink()) throw new Error('Plugin root cannot be a symlink');
  const dest = path.resolve(root, id);
  if (path.dirname(dest) !== root) throw new Error('Invalid plugin installation path');
  if (fs.existsSync(dest) && (fs.lstatSync(dest).isSymbolicLink() || !fs.lstatSync(dest).isDirectory())) throw new Error('Plugin destination is not an owned directory');
  return dest;
}
function ownedBy(dest: string, jobId: string, strict = false): boolean {
  const file = path.join(dest, MARKER);
  if (!fs.existsSync(file) || fs.lstatSync(file).isSymbolicLink()) return false;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')).installationId === jobId; }
  catch (error) { if (strict) throw error; return false; }
}
export async function beginManagedInstall(manager: PluginManager, source: InstallSource): Promise<{ job: InstallJob; statusUrl: string }> {
  if (process.env.LINEARPRESS_SUPERVISOR !== '1' || typeof process.send !== 'function') throw new InstallConflict('自动安装需要受管启动：请使用 npm start 启动站点后重试。本次未安装任何文件。');
  if (busy || hasPendingInstall() || maintenance.isEnabled()) throw new InstallConflict('已有安装或维护任务，请等待完成后再试。');
  const previous = readJournal();
  if (previous && !archiveTerminal(previous)) throw new InstallConflict('上次安装已结束，但诊断记录暂时无法归档；请恢复文件写权限后重试。站点写入不受影响。');
  busy = true;
  let prepared: Awaited<ReturnType<typeof preparePluginInstall>> | undefined;
  let journal: InstallJournal | undefined;
  try {
    // Static validation and staging happen without executing plugin code or interrupting the live site.
    prepared = await preparePluginInstall(source);
    // A configuration operation could have acquired maintenance while validation awaited I/O.
    if (maintenance.isEnabled()) throw new InstallConflict('已有安装或维护任务，请等待完成后再试。');
    const m = prepared.manifest;
    const dest = pluginLocation(m.id);
    if (fs.existsSync(dest) || manager.database.prepare('SELECT id FROM plugins WHERE id=?').get(m.id)) throw new InstallConflict(`插件 ${m.id} 已存在；此流程不覆盖升级。`);
    const now = new Date().toISOString();
    journal = { schema: 1, id: randomUUID(), phase: 'installing', message: '正在安装并准备自动重启', plugins: [{ id: m.id, name: m.name, version: m.version }], expectedIds: desiredExpectedIds(manager, manager.getLoadedIds(), true), recoveryCount: 0, createdAt: now, updatedAt: now, restartRequested: true };
    save(journal, 'installing', '包校验通过，正在安装插件');
    maintenance.enter('plugin');
    const task = maintenance.addTask(journal.id, `安装 ${m.name}`);
    await prepared.commit(manager, { installationId: journal.id });
    maintenance.updateTask(task.id, { progress: 65, label: '即将自动重启并验证插件' });
    save(journal, 'restarting', '安装完成，正在自动重启并验证插件');
    // Backend owns the restart. Disconnecting/closing the browser cannot leave a committed install unapplied.
    setTimeout(() => requestRestart(), 500).unref();
    return { job: publicJob(journal), statusUrl: `/admin/plugins/install-jobs/${journal.id}` };
  } catch (error) {
    if (journal) {
      // Commit failure is not a boot failure: the old process remains usable.
      const dest = pluginLocation(journal.plugins[0].id);
      if (fs.existsSync(dest) && ownedBy(dest, journal.id)) { ensureDirectory(QUARANTINE); fs.renameSync(dest, path.join(QUARANTINE, journal.id)); }
      // commit may already have returned. Delete only its transaction-bound, unchanged registry identity.
      if (ownedBy(path.join(QUARANTINE, journal.id), journal.id)) await removeOwnedInstallRow(manager.database, journal.id, journal.plugins[0]);
      journal.errors = [(error instanceof Error ? error.message : String(error)).slice(0, 2000)];
      finish(journal, 'failed', '安装失败，未启用新插件；已保留诊断');
      maintenance.exit();
    }
    throw error;
  } finally {
    // Staging cleanup failure must not turn an already durable 202 install into an apparent upload failure.
    try { await prepared?.cleanup(); } catch (error) { console.error('[plugin-install] staging cleanup failed', error); }
    finally { busy = false; }
  }
}
/** Runs before discovery in a dedicated recovery worker; never imports candidate code. */
export async function recoverPendingInstall(reason: string): Promise<boolean> {
  reapPluginInstallStaging();
  const job = readJournal();
  if (!job) return false;
  if (terminal(job)) { archiveTerminal(job); return false; }
  maintenance.enter('plugin');
  if (job.recoveryCount === 0) {
    job.recoveryCount = 1;
    job.errors = [...(job.errors ?? []), reason.slice(0, 2000)];
  }
  // Keep phase until quarantine finishes so a crash retries ownership checks safely.
  save(job, job.phase, '新插件启动失败，正在隔离并恢复原站');
  ensureDirectory(QUARANTINE);
  for (const plugin of job.plugins) {
    const dest = pluginLocation(plugin.id);
    if (!fs.existsSync(dest)) continue;
    if (!ownedBy(dest, job.id)) throw new Error('拒绝恢复：插件目录不属于本次安装');
    const quarantine = path.join(QUARANTINE, job.id);
    if (fs.existsSync(quarantine)) throw new Error('恢复隔离目录冲突');
    fs.renameSync(dest, quarantine);
  }
  save(job, 'recovering', '故障插件已隔离，正在恢复原站');
  return true;
}
/** App must call after all plugin phases; a live port alone does not establish success. */
export async function verifyPendingInstall(manager: PluginManager): Promise<void> {
  const job = readJournal();
  if (!job) return;
  if (terminal(job)) {
    archiveTerminal(job);
    if (maintenance.reason() === 'plugin') maintenance.exit();
    return;
  }
  maintenance.enter('plugin');
  if (job.phase === 'recovering') {
    for (const plugin of job.plugins) {
      const quarantine = path.join(QUARANTINE, job.id);
      if (fs.existsSync(quarantine) && !fs.lstatSync(quarantine).isSymbolicLink() && ownedBy(quarantine, job.id)) await removeOwnedInstallRow(manager.database, job.id, plugin);
    }
    const missing = desiredExpectedIds(manager, job.expectedIds).filter(id => !manager.isLoaded(id));
    if (missing.length) throw new Error(`恢复启动未加载原有插件：${missing.join(', ')}`);
    finish(job, 'failed', '新插件启动失败，已隔离插件并恢复原站；插件执行过的数据变更需核查');
    maintenance.exit();
    return;
  }
  save(job, 'verifying', '正在验证新插件及原有插件是否正常加载');
  const missing = [...new Set([...desiredExpectedIds(manager, job.expectedIds), ...job.plugins.map(p => p.id)])].filter(id => !manager.isLoaded(id));
  if (missing.length) {
    await recoverPendingInstall(`启动验证未加载：${missing.join(', ')}`);
    throw new Error('插件安装验证失败，已准备隔离恢复');
  }
  for (const plugin of job.plugins) {
    const dest = pluginLocation(plugin.id);
    if (!ownedBy(dest, job.id)) throw new Error('插件目录安装归属验证失败');
  }
  finish(job, 'completed', '插件安装并启动验证成功，已自动生效');
  try { releaseInstallOwnership(manager.database, job.id); }
  catch (error) { console.error('[plugin-install] registry ownership cleanup deferred', error); }
  maintenance.exit();
}
