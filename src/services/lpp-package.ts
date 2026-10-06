/*
 * LinearPress LPP v1 Package Format
 *
 * Implements the lpp package module for LinearPress.
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
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { builtinModules } from 'node:module';
import { inflateRawSync } from 'node:zlib';
import AdmZip from 'adm-zip';
import ts from 'typescript';
import type { PluginManifest } from '../types/plugin.js';
import { validateManifest, validateRelativePath, validatePluginEntry } from '../core/plugin-validation.js';

export const PACKAGE_LIMITS = Object.freeze({ archiveBytes: 50 * 1024 * 1024, fileBytes: 32 * 1024 * 1024, totalBytes: 150 * 1024 * 1024, entries: 10000, ratio: 200, metadataBytes: 2 * 1024 * 1024 });
export interface LppMetadata {
  format: 'linearpress-plugin'; formatVersion: 1; pluginId: string; pluginVersion: string;
  requires: { linearpress: string; node?: string; host?: Record<string, string> };
  files: { path: string; size: number; sha256: string }[];
}
export interface ValidatedPackage { manifest: PluginManifest; metadata?: LppMetadata; files: Map<string, Buffer>; }
const hostRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const hostPackage = JSON.parse(fs.readFileSync(path.join(hostRoot, 'package.json'), 'utf8')) as { version: string; dependencies: Record<string, string> };
const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
const sha256 = (data: Buffer): string => createHash('sha256').update(data).digest('hex');
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Deliberately restricted, fail-closed semver grammar; no tags, URLs or npm aliases. */
function version(value: string): { parts: number[]; pre: string[] } {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value);
  if (!match) throw new Error(`Unsupported semantic version: ${value}`);
  const parts = match.slice(1, 4).map(Number), pre = match[4]?.split('.') ?? [];
  const build = value.includes('+') ? value.slice(value.indexOf('+') + 1).split('.') : [];
  if (build.some(part => !part || !/^[0-9A-Za-z-]+$/.test(part))) throw new Error(`Unsupported semantic version: ${value}`);
  if (parts.some((part) => !Number.isSafeInteger(part)) || pre.some((part) => !part || /^0\d+$/.test(part))) throw new Error(`Unsupported semantic version: ${value}`);
  return { parts, pre };
}
function compare(left: string, right: string): number {
  const a = version(left), b = version(right);
  for (let i = 0; i < 3; i++) if (a.parts[i] !== b.parts[i]) return a.parts[i] > b.parts[i] ? 1 : -1;
  if (!a.pre.length || !b.pre.length) return Number(!a.pre.length) - Number(!b.pre.length);
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    if (a.pre[i] === b.pre[i]) continue;
    if (a.pre[i] === undefined || b.pre[i] === undefined) return a.pre[i] === undefined ? -1 : 1;
    const an = /^\d+$/.test(a.pre[i]), bn = /^\d+$/.test(b.pre[i]);
    if (an && bn) return a.pre[i].length !== b.pre[i].length ? (a.pre[i].length > b.pre[i].length ? 1 : -1) : (a.pre[i] > b.pre[i] ? 1 : -1);
    if (an !== bn) return an ? -1 : 1;
    return a.pre[i] > b.pre[i] ? 1 : -1;
  }
  return 0;
}
export function satisfiesVersion(actual: string, range: string): boolean {
  version(actual);
  if (typeof range !== 'string' || !range.trim() || range.length > 256) throw new Error('Invalid version range');
  // Evaluate every clause, including unused alternatives, to reject unsupported syntax.
  return range.split('||').map((alternative) => {
    const terms = alternative.trim().split(/\s+/);
    if (!terms.length || !terms[0]) throw new Error('Invalid version range');
    const parsed = terms.map((term) => {
      if (term === '*') return { ok: true, prerelease: false };
      const match = /^(\^|~|>=|<=|>|<|=)?(.+)$/.exec(term)!;
      const target = match[2], op = match[1] ?? '=';
      const v = version(target), c = compare(actual, target);
      let ok: boolean;
      if (op === '^' || op === '~') {
        const upper = [...v.parts];
        const index = op === '~' ? 1 : v.parts[0] ? 0 : v.parts[1] ? 1 : 2;
        upper[index]++; for (let i = index + 1; i < 3; i++) upper[i] = 0;
        ok = c >= 0 && compare(actual, upper.join('.')) < 0;
      } else ok = op === '>=' ? c >= 0 : op === '<=' ? c <= 0 : op === '>' ? c > 0 : op === '<' ? c < 0 : c === 0;
      return { ok, prerelease: !!v.pre.length && v.parts.join('.') === version(actual).parts.join('.') };
    });
    return parsed.every((term) => term.ok) && (!version(actual).pre.length || parsed.some((term) => term.prerelease));
  }).some(Boolean);
}
function requireVersion(actual: string, range: string, name: string): void {
  if (!satisfiesVersion(actual, range)) throw new Error(`Incompatible ${name}: installed ${actual}, requires ${range}`);
}
function hostVersion(name: string): string {
  if (!Object.hasOwn(hostPackage.dependencies, name) || !/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name)) throw new Error(`Unsupported non-host production dependency: ${name}; LPP v1 does not install npm dependencies`);
  try { return JSON.parse(fs.readFileSync(path.join(hostRoot, 'node_modules', name, 'package.json'), 'utf8')).version; }
  catch { throw new Error(`Missing installed host dependency: ${name}`); }
}
function json(data: Buffer | undefined, label: string): Record<string, unknown> {
  if (!data || data.length > PACKAGE_LIMITS.metadataBytes) throw new Error(`Missing or oversized ${label}`);
  try { const value: unknown = JSON.parse(data.toString('utf8')); if (!object(value)) throw new Error(); return value; }
  catch { throw new Error(`Invalid ${label}`); }
}
export function validateArchivePath(name: string): void {
  validateRelativePath(name);
  if (name.split('/').some((part) => part.toLowerCase() === '.linearpress-install.json')) throw new Error('Package contains reserved installation marker');
  if (name.includes('\\') || name.length > 240 || name.split('/').length > 24 || name !== name.normalize('NFC') || /[<>"|?*\x7f]/.test(name)) throw new Error(`Invalid archive path: ${name}`);
}
/** Accounts for implicit directories too: Foo/a and foo/b must conflict on Linux as on Windows. */
export class ArchivePaths {
  private paths = new Map<string, { spelling: string; directory: boolean; explicit: boolean }>();
  add(name: string, directory: boolean): void {
    validateArchivePath(name);
    const parts = name.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const spelling = parts.slice(0, i).join('/'), key = spelling.toLowerCase();
      const isDirectory = i < parts.length || directory, explicit = i === parts.length;
      const found = this.paths.get(key);
      if (found && (found.spelling !== spelling || found.directory !== isDirectory || (found.explicit && explicit))) throw new Error(`Duplicate/casefold/file-directory archive path: ${name}`);
      this.paths.set(key, { spelling, directory: isDirectory, explicit: explicit || !!found?.explicit });
    }
  }
}
const crcTable = Array.from({ length: 256 }, (_, n) => { for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
function crc32(data: Buffer): number { let crc = 0xffffffff; for (const byte of data) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }

/** Read classic ZIP ourselves so duplicate entries and lying size headers cannot be hidden by an archive library. */
export function readZipFiles(buffer: Buffer): Map<string, Buffer> {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22 || buffer.length > PACKAGE_LIMITS.archiveBytes) throw new Error('Empty, oversized or invalid ZIP archive');
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50 && i + 22 + buffer.readUInt16LE(i + 20) === buffer.length) { end = i; break; }
  }
  if (end < 0) throw new Error('Corrupt ZIP end record');
  const count = buffer.readUInt16LE(end + 10), centralSize = buffer.readUInt32LE(end + 12), centralOffset = buffer.readUInt32LE(end + 16);
  if (buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6) || count !== buffer.readUInt16LE(end + 8) || !count || count > PACKAGE_LIMITS.entries || centralOffset + centralSize !== end) throw new Error('Invalid/multidisk/ZIP64 or oversized ZIP directory');
  const paths = new ArchivePaths(), files = new Map<string, Buffer>(), ranges: [number, number][] = [];
  let cursor = centralOffset, total = 0;
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Corrupt ZIP central directory');
    const flags = buffer.readUInt16LE(cursor + 8), method = buffer.readUInt16LE(cursor + 10), crc = buffer.readUInt32LE(cursor + 16);
    const compressed = buffer.readUInt32LE(cursor + 20), size = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28), extraLength = buffer.readUInt16LE(cursor + 30), commentLength = buffer.readUInt16LE(cursor + 32);
    const mode = buffer.readUInt32LE(cursor + 38) >>> 16, offset = buffer.readUInt32LE(cursor + 42);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (next > end || !nameLength || flags & ~0x080e || flags & 1 || ![0, 8].includes(method) || buffer.readUInt16LE(cursor + 34)) throw new Error('Unsupported ZIP flags/method/disk');
    const rawName = buffer.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = rawName.toString('utf8');
    if (!Buffer.from(name).equals(rawName) || (!(flags & 0x800) && rawName.some((b) => b > 127))) throw new Error('ZIP names must use UTF-8');
    const directory = name.endsWith('/'), cleanName = directory ? name.slice(0, -1) : name;
    paths.add(cleanName, directory);
    const type = mode & 0o170000;
    if (type && type !== (directory ? 0o040000 : 0o100000)) throw new Error('ZIP links/special files are forbidden');
    for (let e = cursor + 46 + nameLength; e < cursor + 46 + nameLength + extraLength;) {
      if (e + 4 > cursor + 46 + nameLength + extraLength) throw new Error('Invalid ZIP extra field');
      const tag = buffer.readUInt16LE(e), length = buffer.readUInt16LE(e + 2); e += 4 + length;
      if (tag === 1 || e > cursor + 46 + nameLength + extraLength) throw new Error('ZIP64/invalid extra field');
    }
    total += size;
    if (size > PACKAGE_LIMITS.fileBytes || total > PACKAGE_LIMITS.totalBytes || (size > 1024 * 1024 && size > Math.max(1, compressed) * PACKAGE_LIMITS.ratio) || (directory && size)) throw new Error('ZIP expansion quota exceeded');
    if (offset + 30 > centralOffset || buffer.readUInt32LE(offset) !== 0x04034b50) throw new Error('Corrupt ZIP local header');
    const localNameLength = buffer.readUInt16LE(offset + 26), localExtraLength = buffer.readUInt16LE(offset + 28);
    const start = offset + 30 + localNameLength + localExtraLength;
    if (start + compressed > centralOffset || buffer.readUInt16LE(offset + 6) !== flags || buffer.readUInt16LE(offset + 8) !== method || !buffer.subarray(offset + 30, offset + 30 + localNameLength).equals(rawName)) throw new Error('ZIP local/central mismatch');
    if (!(flags & 8) && (buffer.readUInt32LE(offset + 14) !== crc || buffer.readUInt32LE(offset + 18) !== compressed || buffer.readUInt32LE(offset + 22) !== size)) throw new Error('ZIP local size/CRC mismatch');
    let finish = start + compressed;
    if (flags & 8) {
      if (finish + 12 > centralOffset) throw new Error('Truncated ZIP data descriptor');
      if (buffer.readUInt32LE(finish) === 0x08074b50) finish += 4;
      if (finish + 12 > centralOffset || buffer.readUInt32LE(finish) !== crc || buffer.readUInt32LE(finish + 4) !== compressed || buffer.readUInt32LE(finish + 8) !== size) throw new Error('Invalid ZIP data descriptor');
      finish += 12;
    }
    ranges.push([offset, finish]);
    const payload = buffer.subarray(start, start + compressed);
    let data: Buffer;
    try { data = method === 0 ? Buffer.from(payload) : inflateRawSync(payload, { maxOutputLength: Math.max(1, size) }); }
    catch { throw new Error(`Corrupt/oversized ZIP deflate stream: ${cleanName}`); }
    if (data.length !== size || crc32(data) !== crc) throw new Error(`ZIP size/CRC integrity failure: ${cleanName}`);
    if (!directory) files.set(cleanName, data);
    cursor = next;
  }
  ranges.sort((a, b) => a[0] - b[0]);
  let last = 0;
  for (const [start, finish] of ranges) { if (start !== last) throw new Error('Overlapping/hidden ZIP records'); last = finish; }
  if (last !== centralOffset || cursor !== end) throw new Error('Unaccounted ZIP records');
  return files;
}

function packageRequirements(files: Map<string, Buffer>, manifest: PluginManifest): { linearpress: string; node?: string; host: Record<string, string> } {
  const pkg = files.has('package.json') ? json(files.get('package.json'), 'package.json') : {};
  const deps: Record<string, string> = Object.create(null);
  const optional = object(pkg.peerDependenciesMeta) ? pkg.peerDependenciesMeta : {};
  let linearpress = '^3.0.0';
  for (const key of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    const values = pkg[key];
    if (values === undefined) continue;
    if (!object(values)) throw new Error(`Invalid package.json ${key}`);
    for (const [name, range] of Object.entries(values)) {
      if (typeof range !== 'string') throw new Error(`Invalid dependency range: ${name}`);
      if (name === 'linearpress') { requireVersion(hostPackage.version, range, 'LinearPress'); linearpress = range; continue; }
      if (key === 'peerDependencies' && object(optional[name]) && optional[name].optional === true && !Object.hasOwn(hostPackage.dependencies, name)) continue;
      requireVersion(hostVersion(name), range, name); deps[name] = range;
    }
  }
  // Follow only the runtime import graph; browser assets and build scripts are not server dependencies.
  const seen = new Set<string>();
  const visit = (name: string): void => {
    if (seen.has(name)) return; seen.add(name);
    const data = files.get(name); if (!data || !/\.[cm]?[jt]sx?$/.test(name)) return;
    const source = ts.createSourceFile(name, data.toString('utf8'), ts.ScriptTarget.Latest, true);
    const check = (specifier: string): void => {
      if (specifier.startsWith('.')) {
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(name), specifier));
        if (target.startsWith('../')) return; // Preserve host ../../core/services/types imports without bundling.
        const candidates = [target, target.replace(/\.js$/, '.ts'), target.replace(/\.mjs$/, '.mts'), target.replace(/\.cjs$/, '.cts'), target.replace(/\.jsx$/, '.tsx'), `${target}.ts`, `${target}.js`, `${target}/index.ts`, `${target}/index.js`];
        const found = candidates.find((candidate) => files.has(candidate));
        if (!found) throw new Error(`Missing local runtime dependency: ${name} -> ${specifier}`);
        visit(found);
        return;
      }
      if (builtins.has(specifier)) return;
      const dependency = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
      if (object(optional[dependency]) && optional[dependency].optional === true && !Object.hasOwn(hostPackage.dependencies, dependency)) return;
      if (!Object.hasOwn(deps, dependency)) { const actual = hostVersion(dependency); requireVersion(actual, hostPackage.dependencies[dependency], dependency); deps[dependency] = hostPackage.dependencies[dependency]; }
    };
    const walk = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly && ts.isStringLiteral(node.moduleSpecifier)) {
        const clause = node.importClause, bindings = clause?.namedBindings;
        const allType = !clause?.name && bindings && ts.isNamedImports(bindings) && bindings.elements.length > 0 && bindings.elements.every(item => item.isTypeOnly);
        if (!allType) check(node.moduleSpecifier.text);
      }
      if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const allType = node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.length > 0 && node.exportClause.elements.every(item => item.isTypeOnly);
        if (!allType) check(node.moduleSpecifier.text);
      }
      if (ts.isImportEqualsDeclaration(node) && !node.isTypeOnly && ts.isExternalModuleReference(node.moduleReference) && node.moduleReference.expression && ts.isStringLiteral(node.moduleReference.expression)) check(node.moduleReference.expression.text);
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require') && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) check(node.arguments[0].text);
      ts.forEachChild(node, walk);
    };
    walk(source);
  };
  visit(manifest.main);
  const engines = object(pkg.engines) ? pkg.engines : {};
  if (engines.node !== undefined && typeof engines.node !== 'string') throw new Error('Invalid Node version requirement');
  const node = engines.node as string | undefined;
  requireVersion(hostPackage.version, linearpress, 'LinearPress');
  if (node) requireVersion(process.versions.node, node, 'Node');
  return { linearpress, ...(node ? { node } : {}), host: deps };
}
export function validatePluginFiles(files: Map<string, Buffer>): ValidatedPackage {
  const manifest = validateManifest(json(files.get('plugin.json'), 'plugin.json'));
  version(manifest.version);
  if ([...files.keys()].some((name) => name.split('/').some((part) => part.toLowerCase() === '.linearpress-install.json'))) throw new Error('Package contains reserved installation marker');
  if (!files.has(manifest.main)) throw new Error(`Plugin entry ${manifest.main} is missing`);
  if ([...files.keys()].some((name) => name.split('/').some((part) => part.toLowerCase() === 'node_modules'))) throw new Error('LPP v1/ZIP installer does not accept vendored node_modules; unsupported production dependencies must be reviewed explicitly');
  for (const resource of [manifest.views, manifest.public]) {
    if (resource && ![...files.keys()].some(name => name.startsWith(resource.replace(/\\/g, '/') + '/'))) throw new Error(`Declared resource directory missing from package: ${resource}`);
  }
  for (const asset of [...(manifest.styles ?? []), ...(manifest.scripts ?? [])]) {
    if (!manifest.public) throw new Error(`Declared asset requires a public directory: ${asset}`);
    const name = path.posix.join(manifest.public.replace(/\\/g, '/'), asset.split('?')[0]);
    if (!files.has(name)) throw new Error(`Declared asset missing from package (possibly excluded by pack policy): ${name}`);
  }
  packageRequirements(files, manifest);
  return { manifest, files };
}
export async function validateLpp(buffer: Buffer): Promise<ValidatedPackage & { metadata: LppMetadata }> {
  const files = readZipFiles(buffer);
  const raw = json(files.get('lpp.json'), 'lpp.json');
  if (raw.format !== 'linearpress-plugin' || raw.formatVersion !== 1 || !object(raw.requires) || typeof raw.requires.linearpress !== 'string' || !Array.isArray(raw.files)) throw new Error('Unsupported/invalid LPP format or version');
  requireVersion(hostPackage.version, raw.requires.linearpress, 'LinearPress');
  if (raw.requires.node !== undefined) { if (typeof raw.requires.node !== 'string') throw new Error('Invalid Node requirement'); requireVersion(process.versions.node, raw.requires.node, 'Node'); }
  if (raw.requires.host !== undefined) {
    if (!object(raw.requires.host)) throw new Error('Invalid host dependency requirements');
    for (const [name, range] of Object.entries(raw.requires.host)) { if (typeof range !== 'string') throw new Error('Invalid host dependency range'); requireVersion(hostVersion(name), range, name); }
  }
  const listed = new ArchivePaths(); let count = 0;
  for (const item of raw.files) {
    if (!object(item) || typeof item.path !== 'string' || !Number.isSafeInteger(item.size) || typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(item.sha256) || item.path === 'lpp.json') throw new Error('Invalid LPP file manifest');
    listed.add(item.path, false);
    const data = files.get(item.path);
    if (!data || data.length !== item.size || sha256(data) !== item.sha256) throw new Error(`LPP hash/size integrity failure: ${item.path}`);
    count++;
  }
  if (count !== files.size - 1) throw new Error('LPP contains unlisted files');
  const validated = validatePluginFiles(files);
  if (raw.pluginId !== validated.manifest.id || raw.pluginVersion !== validated.manifest.version) throw new Error('LPP/plugin.json identity mismatch');
  return { ...validated, metadata: raw as unknown as LppMetadata };
}
export async function validateZip(buffer: Buffer): Promise<ValidatedPackage> {
  const files = readZipFiles(buffer);
  // ZIP upload cannot bypass LPP integrity validation by changing its extension.
  if (files.has('lpp.json')) return validateLpp(buffer);
  return validateLegacyFiles(files);
}
export function validateLegacyFiles(files: Map<string, Buffer>): ValidatedPackage {
  const roots = [...files.keys()].filter((name) => name === 'plugin.json' || /^[^/]+\/plugin\.json$/.test(name));
  if (roots.length !== 1) throw new Error('ZIP/npm archive must contain exactly one plugin root');
  const prefix = roots[0].slice(0, -'plugin.json'.length);
  if ([...files.keys()].some((name) => !name.startsWith(prefix))) throw new Error('ZIP/npm archive contains files outside the plugin root');
  const rooted = new Map([...files].map(([name, data]) => [name.slice(prefix.length), data]));
  if (rooted.has('lpp.json')) throw new Error('LPP metadata must be installed as a root-level LPP container');
  return validatePluginFiles(rooted);
}
const excluded = new Set(['.git', '.github', '.pi', '.svn', '.hg', '.npmrc', '.yarnrc', '.yarnrc.yml', '.ds_store', 'thumbs.db', 'node_modules', 'data', 'uploads', 'test', 'tests', '__tests__', '__snapshots__', 'coverage', 'test-results', 'playwright-report', '.cache', '.idea', '.vscode', 'dist']);
function excludedPath(name: string): boolean {
  return name.split('/').some((part) => excluded.has(part.toLowerCase()) || /^\.env(?:\.|$)/i.test(part) || /(?:\.test|\.spec)\.[cm]?[jt]sx?$|\.(?:lpp|zip|tgz|log|sqlite|sqlite3|db|pem|key|p12)$/i.test(part));
}
/** Source is preserved verbatim, including ../../core imports; no builds, lifecycle scripts or package code run. */
export async function packPluginDirectory(root: string): Promise<Buffer> {
  if (fs.lstatSync(root).isSymbolicLink() || !fs.statSync(root).isDirectory()) throw new Error('Plugin source must be a real directory');
  const files = new Map<string, Buffer>(), paths = new ArchivePaths(); let total = 0;
  const visit = (relative: string): void => {
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (excludedPath(name) || name === 'lpp.json') continue;
      if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) throw new Error(`Source link/special file: ${name}`);
      paths.add(name, entry.isDirectory());
      if (entry.isDirectory()) visit(name);
      else {
        const file = path.join(root, name), size = fs.statSync(file).size; total += size;
        if (size > PACKAGE_LIMITS.fileBytes || total > PACKAGE_LIMITS.totalBytes || files.size >= PACKAGE_LIMITS.entries - 1) throw new Error('Package size/count quota exceeded');
        files.set(name, fs.readFileSync(file));
      }
    }
  };
  visit('');
  const { manifest } = validatePluginFiles(files);
  validatePluginEntry(root, manifest.main);
  const metadata: LppMetadata = { format: 'linearpress-plugin', formatVersion: 1, pluginId: manifest.id, pluginVersion: manifest.version, requires: packageRequirements(files, manifest), files: [...files].map(([name, data]) => ({ path: name, size: data.length, sha256: sha256(data) })) };
  const zip = new AdmZip();
  for (const [name, data] of files) zip.addFile(name, data);
  zip.addFile('lpp.json', Buffer.from(JSON.stringify(metadata, null, 2) + '\n'));
  const buffer = zip.toBuffer();
  await validateLpp(buffer);
  return buffer;
}
