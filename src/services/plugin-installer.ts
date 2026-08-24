/*
 * Author: MoyuZJ
 * Team: LinearTeam
 * Contact: linearteam@foxmail.com
 * Made by MoyuZJ in China with ♥
 */

import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import * as tar from 'tar';
import type { PluginManager } from '../core/plugin-manager.js';
import type { PluginManifest } from '../types/plugin.js';

export interface PluginInstallResult { id: string; name: string; version: string; }

const PLUGIN_TYPES = new Set(['backend', 'frontend', 'both', 'theme', 'driver']);
const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
// 入口文件必须导出至少一个生命周期函数（与 plugin-manager importEntry 的约束一致）
const LIFECYCLE_EXPORT = /\bexport\s+(?:default|const|function|async\s+function)\s+(?:preboot|bootstrap|activate|deactivate)?\b/;

function messageOf(error: unknown): string { return error instanceof Error ? error.message : '未知错误'; }

/** 解析 npm 包名/版本，支持 name、name@version、@scope/name、@scope/name@version */
function parseNpmSpec(spec: string): { name: string; version?: string } {
  const trimmed = spec.trim();
  if (!trimmed) throw new Error('请输入 npm 包名');
  if (trimmed.startsWith('@')) {
    const at = trimmed.lastIndexOf('@');
    if (at > 0) return { name: trimmed.slice(0, at), version: trimmed.slice(at + 1) || undefined };
    return { name: trimmed };
  }
  const at = trimmed.indexOf('@');
  if (at === -1) return { name: trimmed };
  return { name: trimmed.slice(0, at), version: trimmed.slice(at + 1) || undefined };
}

/** 从 npm registry 获取目标版本及其 tarball 内容 */
async function fetchNpmTarball(name: string, version?: string): Promise<{ version: string; buffer: Buffer }> {
  const base = `https://registry.npmjs.org/${encodeURIComponent(name)}`;
  const url = version ? `${base}/${encodeURIComponent(version)}` : base;
  const response = await fetch(url, { headers: { accept: 'application/vnd.npm.install-v1+json' }, signal: AbortSignal.timeout(30_000) });
  if (response.status === 404) throw new Error(`npm 包 ${name}${version ? '@' + version : ''} 不存在`);
  if (!response.ok) throw new Error(`获取 npm 包信息失败（HTTP ${response.status}）`);
  const meta = await response.json() as {
    'dist-tags'?: Record<string, string>;
    versions?: Record<string, { dist?: { tarball?: string } }>;
    dist?: { tarball?: string };
    version?: string;
  } as { 'dist-tags'?: Record<string, string>; versions?: Record<string, { dist?: { tarball?: string } }>; dist?: { tarball?: string }; version?: string };

  let chosenVersion = version;
  let manifest: { dist?: { tarball?: string } } | undefined;
  if (chosenVersion) {
    manifest = meta;
  } else {
    chosenVersion = meta['dist-tags']?.latest;
    manifest = chosenVersion ? meta.versions?.[chosenVersion] : undefined;
  }
  if (!chosenVersion || !manifest) throw new Error(`npm 包 ${name} 未找到可用版本`);
  const tarballUrl = manifest.dist?.tarball;
  if (!tarballUrl) throw new Error(`npm 包 ${name} 缺少下载地址`);
  const tarball = await fetch(tarballUrl, { signal: AbortSignal.timeout(60_000) });
  if (!tarball.ok) throw new Error('下载 npm 包失败');
  return { version: chosenVersion, buffer: Buffer.from(await tarball.arrayBuffer()) };
}

/** 解压 .tgz 到目标目录 */
async function extractTgz(buffer: Buffer, target: string): Promise<void> {
  const file = path.join(target, 'payload.tgz');
  await fs.writeFile(file, buffer);
  await tar.x({ file, cwd: target });
  await fs.remove(file).catch(() => undefined);
}

/** 解压 zip 到目标目录（含 zip-slip 防护） */
function extractZip(buffer: Buffer, target: string): void {
  let zip: AdmZip;
  try { zip = new AdmZip(buffer); }
  catch { throw new Error('不是有效的 ZIP 压缩包：文件已损坏或格式不受支持'); }
  const entries = zip.getEntries();
  if (!entries.length) throw new Error('压缩包为空');
  for (const entry of entries) {
    const name = entry.entryName.replace(/\\/g, '/');
    if (name.startsWith('/') || name.split('/').includes('..')) throw new Error('压缩包中包含非法路径');
  }
  zip.extractAllTo(target, true);
}

/** 在解压根目录（或其直接子目录）中找到插件主目录（包含 plugin.json） */
function findPluginRoot(staging: string): string {
  if (fs.existsSync(path.join(staging, 'plugin.json'))) return staging;
  const children = fs.readdirSync(staging, { withFileTypes: true });
  for (const child of children) {
    if (child.isDirectory() && fs.existsSync(path.join(staging, child.name, 'plugin.json'))) return path.join(staging, child.name);
  }
  throw new Error('不是有效的 LinearPress 插件：未找到 plugin.json');
}

/** 读取并校验插件 Manifest */
function readManifest(rootDir: string): PluginManifest {
  const manifestPath = path.join(rootDir, 'plugin.json');
  if (!fs.existsSync(manifestPath)) throw new Error('不是有效的 LinearPress 插件：缺少 plugin.json');
  let raw: unknown;
  try { raw = fs.readJsonSync(manifestPath); } catch { throw new Error('不是有效的 LinearPress 插件：plugin.json 无法解析'); }
  const m = raw as Partial<PluginManifest>;
  for (const field of ['id', 'name', 'version', 'type', 'main'] as const) {
    if (typeof m[field] !== 'string' || !m[field]!.trim()) throw new Error(`不是有效的 LinearPress 插件：缺少必填字段 ${field}`);
  }
  if (!PLUGIN_TYPES.has(m.type!)) throw new Error(`不是有效的 LinearPress 插件：type 必须是 ${[...PLUGIN_TYPES].join('/')} 之一`);
  const id = m.id!.trim();
  if (!ID_PATTERN.test(id) || id === '.' || id === '..') throw new Error(`不是有效的 LinearPress 插件：id「${id}」不合法`);
  return { ...m, id, name: m.name!.trim(), version: m.version!.trim(), type: m.type as PluginManifest['type'], main: m.main!.trim() } as PluginManifest;
}

/** 校验入口文件存在且导出生命周期函数（静态检查，不执行插件代码） */
function validateEntry(rootDir: string, main: string): void {
  const entryPath = path.resolve(rootDir, main);
  if (!entryPath.startsWith(rootDir + path.sep) || !fs.existsSync(entryPath)) throw new Error(`不是有效的 LinearPress 插件：入口文件 ${main} 不存在`);
  const source = fs.readFileSync(entryPath, 'utf8');
  if (!LIFECYCLE_EXPORT.test(source)) throw new Error('不是有效的 LinearPress 插件：入口文件未导出 preboot/bootstrap/activate 生命周期函数');
}

/** 把已校验通过的插件目录复制到 src/plugins/<id> 并写入基础设施数据库 */
function installFromDir(manager: PluginManager, rootDir: string): PluginInstallResult {
  const manifest = readManifest(rootDir);
  validateEntry(rootDir, manifest.main);
  const pluginsRoot = path.join(process.cwd(), 'src', 'plugins');
  const dest = path.join(pluginsRoot, manifest.id);
  if (fs.existsSync(dest)) throw new Error(`插件 ${manifest.id} 已存在于 plugins 目录`);
  const existing = manager.database.prepare('SELECT id FROM plugins WHERE id=?').get(manifest.id) as { id: string } | undefined;
  if (existing) throw new Error(`插件 ${manifest.id} 已安装`);
  fs.ensureDirSync(pluginsRoot);
  fs.copySync(rootDir, dest);
  const maxOrder = (manager.database.prepare('SELECT COALESCE(MAX(load_order),0) AS m FROM plugins').get() as { m: number }).m;
  manager.database.prepare('INSERT INTO plugins(id,name,version,type,icon,description,enabled,load_order) VALUES(?,?,?,?,?,?,1,?)').run(manifest.id, manifest.name, manifest.version, manifest.type, manifest.icon ?? null, manifest.description ?? null, maxOrder + 10);
  return { id: manifest.id, name: manifest.name, version: manifest.version };
}

async function withStaging<T>(work: (staging: string) => T): Promise<T> {
  const staging = await fs.mkdtemp(path.join(os.tmpdir(), 'lp-install-'));
  try { return await work(staging); }
  finally { await fs.remove(staging).catch(() => undefined); }
}

/** 从 npm registry 下载并安装插件（校验失败抛错，不安装） */
export async function installFromNpm(manager: PluginManager, spec: string): Promise<PluginInstallResult> {
  const { name, version } = parseNpmSpec(spec);
  const { buffer } = await fetchNpmTarball(name, version);
  return withStaging(async (staging) => {
    await extractTgz(buffer, staging);
    const rootDir = findPluginRoot(staging);
    try { return installFromDir(manager, rootDir); }
    catch (error) { throw new Error(`${messageOf(error)}（来源：npm 包 ${name}${version ? '@' + version : ''}）`); }
  });
}

/** 从上传的 zip 压缩包安装插件（校验失败抛错，不安装） */
export async function installFromZip(manager: PluginManager, buffer: Buffer): Promise<PluginInstallResult> {
  if (!buffer || !buffer.length) throw new Error('上传的压缩包为空');
  return withStaging(async (staging) => {
    extractZip(buffer, staging);
    const rootDir = findPluginRoot(staging);
    try { return installFromDir(manager, rootDir); }
    catch (error) { throw new Error(`${messageOf(error)}（来源：上传的 ZIP 压缩包）`); }
  });
}