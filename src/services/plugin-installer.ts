/*
 * LinearPress Plugin Installer
 *
 * Validated, staged installation; never executes plugin code or npm scripts.
 *
 * Authors:
 * MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥
 * worryzu <worryzu@gmail.com> @LinearTeam
 *
 * Copyright (C) 2026 Evarentha
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import fs from 'fs-extra';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import * as tar from 'tar';
import type { PluginManager } from '../core/plugin-manager.js';
import { bindInstallOwnership, ensureInstallOwnership } from './plugin-install-ownership.js';
import { createPluginInstallStage, reapPluginInstallStaging, STAGE_MARKER } from './plugin-install-staging.js';
export { reapPluginInstallStaging } from './plugin-install-staging.js';
import type { PluginManifest } from '../types/plugin.js';
import { pluginPath, rejectSymlinks, validatePluginEntry } from '../core/plugin-validation.js';
import { ArchivePaths, PACKAGE_LIMITS, validateLegacyFiles, validateLpp, validateZip, type ValidatedPackage } from './lpp-package.js';

export interface PluginInstallResult { id: string; name: string; version: string; }
export type PluginInstallSource = { kind: 'lpp' | 'zip'; buffer: Buffer } | { kind: 'npm'; spec: string };
export interface PreparedPluginInstall {
  manifest: PluginManifest;
  commit(manager: PluginManager, options?: { installationId?: string }): Promise<PluginInstallResult>;
  cleanup(): Promise<void>;
}
export const INSTALL_MARKER = '.linearpress-install.json';

function parseNpmSpec(spec: string): { name: string; version?: string } {
  if (typeof spec !== 'string' || spec.length > 256) throw new Error('Invalid npm package spec');
  const match = /^((?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*)(?:@([a-zA-Z0-9.+_-]+))?$/.exec(spec.trim());
  if (!match) throw new Error('Use an npm package name, optionally @version or @tag; URLs and local paths are forbidden');
  return { name: match[1], version: match[2] };
}
async function boundedBody(response: Response, limit: number): Promise<Buffer> {
  if (!response.ok) throw new Error(`npm registry HTTP ${response.status}`);
  if (Number(response.headers.get('content-length') ?? 0) > limit) { await response.body?.cancel(); throw new Error('npm response size quota exceeded'); }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty npm registry response');
  const chunks: Buffer[] = []; let size = 0;
  try {
    while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > limit) throw new Error('npm response size quota exceeded'); chunks.push(Buffer.from(value)); }
  } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  finally { reader.releaseLock(); }
  return Buffer.concat(chunks, size);
}
async function fetchNpmTarball(spec: string): Promise<Buffer> {
  const { name, version = 'latest' } = parseNpmSpec(spec);
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(30000), redirect: 'error' });
  const meta = JSON.parse((await boundedBody(response, PACKAGE_LIMITS.metadataBytes)).toString('utf8')) as { dist?: { tarball?: string; integrity?: string; shasum?: string } };
  const dist = meta.dist;
  if (!dist?.tarball) throw new Error('npm metadata has no tarball');
  const url = new URL(dist.tarball);
  if (url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org' || url.port || url.username || url.password) throw new Error('npm tarball must use the public HTTPS npm registry');
  const buffer = await boundedBody(await fetch(url, { signal: AbortSignal.timeout(60000), redirect: 'error' }), PACKAGE_LIMITS.archiveBytes);
  if (dist.integrity) {
    const tokens = dist.integrity.split(/\s+/).map((token) => /^(sha512|sha256)-([A-Za-z0-9+/]+={0,2})$/.exec(token)).filter((token) => token !== null);
    if (!tokens.length || !tokens.some((token) => createHash(token[1]).update(buffer).digest('base64') === token[2])) throw new Error('npm tarball integrity failure');
  } else if (dist.shasum) {
    if (!/^[a-f0-9]{40}$/.test(dist.shasum) || createHash('sha1').update(buffer).digest('hex') !== dist.shasum) throw new Error('npm tarball SHA-1 integrity failure');
  } else throw new Error('npm tarball lacks integrity metadata');
  return buffer;
}
/** TAR is also read into a bounded file map, never extracted by library path/link handling. */
async function readTgz(buffer: Buffer): Promise<ValidatedPackage> {
  if (!buffer.length || buffer.length > PACKAGE_LIMITS.archiveBytes) throw new Error('Empty/oversized npm archive');
  let expanded: Buffer;
  try { expanded = gunzipSync(buffer, { maxOutputLength: PACKAGE_LIMITS.totalBytes + PACKAGE_LIMITS.entries * 1024 }); }
  catch { throw new Error('Invalid/oversized npm gzip stream'); }
  if (expanded.length > 1024 * 1024 && expanded.length > buffer.length * PACKAGE_LIMITS.ratio) throw new Error('npm expansion ratio quota exceeded');
  const files = new Map<string, Buffer>(), paths = new ArchivePaths(); let count = 0, total = 0;
  await new Promise<void>((resolve, reject) => {
    const parser = new tar.Parser({ strict: true, maxMetaEntrySize: PACKAGE_LIMITS.metadataBytes });
    parser.on('error', reject);
    parser.on('ignoredEntry', () => parser.abort(new Error('npm archive contains an unsupported/oversized entry')));
    parser.on('meta', () => { if (++count > PACKAGE_LIMITS.entries) parser.abort(new Error('npm archive metadata count quota exceeded')); });
    parser.on('end', resolve);
    parser.on('entry', (entry: tar.ReadEntry) => {
      try {
        if (++count > PACKAGE_LIMITS.entries || !['File', 'OldFile', 'Directory'].includes(entry.type)) throw new Error('npm archive has links/special files or too many entries');
        const directory = entry.type === 'Directory';
        const name = directory && entry.path.endsWith('/') ? entry.path.slice(0, -1) : entry.path;
        paths.add(name, directory); total += entry.size;
        if (entry.size > PACKAGE_LIMITS.fileBytes || total > PACKAGE_LIMITS.totalBytes || (directory && entry.size)) throw new Error('npm archive size quota exceeded');
        const chunks: Buffer[] = []; let size = 0;
        entry.on('data', (chunk: Buffer) => { size += chunk.length; if (size > entry.size || size > PACKAGE_LIMITS.fileBytes) parser.abort(new Error('npm entry exceeds declared size')); else chunks.push(chunk); });
        entry.on('end', () => { if (size !== entry.size) parser.abort(new Error('Truncated npm archive entry')); else if (!directory) files.set(name, Buffer.concat(chunks, size)); });
        entry.resume();
      } catch (error) { parser.abort(error instanceof Error ? error : new Error('Invalid npm archive')); }
    });
    parser.end(expanded);
  });
  return validateLegacyFiles(files);
}
function controlledDirectory(parent: string, name: string): string {
  const target = path.join(parent, name);
  fs.ensureDirSync(target);
  const stat = fs.lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Installation directory must not be a symlink');
  return target;
}
function assertUninstalled(manager: PluginManager, pluginsRoot: string, id: string): string {
  const destination = pluginPath(pluginsRoot, id);
  if (fs.readdirSync(pluginsRoot).some((name) => name.toLowerCase() === id.toLowerCase())) throw new Error(`插件 ${id} 已存在于 plugins 目录`);
  if (manager.database.prepare('SELECT id FROM plugins WHERE LOWER(id)=LOWER(?)').get(id)) throw new Error(`插件 ${id} 已安装`);
  return destination;
}
/** Static inspection only. Use preparePluginInstall for journal -> commit without re-downloading. */
export async function inspectPluginArchive(buffer: Buffer, format: 'lpp' | 'zip'): Promise<{ manifest: PluginManifest }> {
  const prepared = await preparePluginInstall({ kind: format, buffer });
  try { return { manifest: prepared.manifest }; } finally { await prepared.cleanup(); }
}
/**
 * No deployment/DB mutation until commit. The caller must persist its durable job first.
 * The stage is a sibling of plugins on the same filesystem, permitting atomic rename.
 */
export async function preparePluginInstall(source: PluginInstallSource): Promise<PreparedPluginInstall> {
  reapPluginInstallStaging();
  let validated: ValidatedPackage;
  if (source.kind === 'npm') validated = await readTgz(await fetchNpmTarball(source.spec));
  else if (source.kind === 'lpp') validated = await validateLpp(source.buffer);
  else if (source.kind === 'zip') validated = await validateZip(source.buffer);
  else throw new Error('Unsupported plugin package source');
  const { manifest, files } = validated;
  if ([...files.keys()].some((name) => name.split('/').some((part) => [INSTALL_MARKER, STAGE_MARKER].includes(part.toLowerCase())))) throw new Error('Package contains reserved installation marker');
  const src = controlledDirectory(process.cwd(), 'src');
  const stage = createPluginInstallStage();
  const staging = stage.directory;
  let state: 'prepared' | 'committed' | 'closed' = 'prepared';
  const cleanup = async (): Promise<void> => { if (state === 'prepared') state = 'closed'; stage.cleanup(); };
  try {
    for (const [name, data] of files) { const file = pluginPath(staging, name); fs.ensureDirSync(path.dirname(file)); fs.writeFileSync(file, data, { flag: 'wx', mode: 0o644 }); }
    validatePluginEntry(staging, manifest.main);
    for (const resource of [manifest.views, manifest.public]) if (resource) pluginPath(staging, resource);
  } catch (error) { await cleanup(); throw error; }
  return {
    manifest: structuredClone(manifest), cleanup,
    async commit(manager, options = {}) {
      if (state !== 'prepared') throw new Error('Prepared install was already committed or cleaned up');
      if (options.installationId !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(options.installationId)) throw new Error('Invalid installation job UUID');
      const { guardSqliteDatabase, sqliteTransaction } = await import('../core/database.js');
      const database = guardSqliteDatabase(manager.database);
      rejectSymlinks(staging);
      const pluginsRoot = controlledDirectory(src, 'plugins');
      const destination = assertUninstalled(manager, pluginsRoot, manifest.id);
      let deployed = false;
      try {
        if (options.installationId) fs.writeJsonSync(path.join(staging, INSTALL_MARKER), { installationId: options.installationId }, { flag: 'wx', mode: 0o600 });
        // The managed flow serializes jobs; synchronous recheck+rename also avoids local API races.
        assertUninstalled(manager, pluginsRoot, manifest.id);
        fs.rmSync(path.join(staging, STAGE_MARKER));
        fs.renameSync(staging, destination); deployed = true; state = 'committed'; stage.detach();
        await sqliteTransaction(database, () => {
          if (options.installationId) ensureInstallOwnership(database);
          const maxOrder = (database.prepare('SELECT COALESCE(MAX(load_order),0) AS m FROM plugins').get() as { m: number }).m;
          database.prepare('INSERT INTO plugins(id,name,version,type,icon,description,enabled,load_order) VALUES(?,?,?,?,?,?,1,?)').run(manifest.id, manifest.name, manifest.version, manifest.type, manifest.icon ?? null, manifest.description ?? null, maxOrder + 10);
          if (options.installationId) bindInstallOwnership(database, options.installationId, manifest);
        });
      } catch (error) {
        if (deployed) fs.removeSync(destination);
        state = 'closed'; stage.cleanup();
        throw error;
      }
      return { id: manifest.id, name: manifest.name, version: manifest.version };
    },
  };
}
async function install(manager: PluginManager, source: PluginInstallSource): Promise<PluginInstallResult> {
  const prepared = await preparePluginInstall(source);
  try { return await prepared.commit(manager); } finally { await prepared.cleanup(); }
}
export async function installFromLpp(manager: PluginManager, buffer: Buffer): Promise<PluginInstallResult> { return install(manager, { kind: 'lpp', buffer }); }
export async function installFromZip(manager: PluginManager, buffer: Buffer): Promise<PluginInstallResult> { return install(manager, { kind: 'zip', buffer }); }
export async function installFromNpm(manager: PluginManager, spec: string): Promise<PluginInstallResult> { return install(manager, { kind: 'npm', spec }); }
