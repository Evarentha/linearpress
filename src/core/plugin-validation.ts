/*
 * LinearPress Plugin Boundary and Entry Validation
 *
 * Implements the plugin validation module for LinearPress.
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
import ts from 'typescript';
import type { PluginManifest } from '../types/plugin.js';

export function validatePluginId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9_-])?$/.test(id) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(id)) throw new Error('Invalid plugin id');
}
export function validateRelativePath(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value || /[%\x00-\x1f:]/.test(value) || path.posix.isAbsolute(value) || path.win32.isAbsolute(value) || value.replace(/\\/g, '/').split('/').some((part) => !part || part === '..' || part === '.' || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error('Invalid plugin relative path');
}
function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return !!relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
export function pluginPath(root: string, relative: string): string {
  validateRelativePath(relative);
  const target = path.resolve(root, relative);
  if (!inside(path.resolve(root), target)) throw new Error('Plugin path escapes root');
  // Reject symlink escapes, including a nonexistent tail below a linked parent.
  let ancestor = target;
  while (!fs.existsSync(ancestor)) {
    if (fs.lstatSync(ancestor, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('Broken plugin symlink');
    ancestor = path.dirname(ancestor);
  }
  const realRoot = fs.realpathSync(root);
  const realAncestor = fs.realpathSync(ancestor);
  if (realAncestor !== realRoot && !inside(realRoot, realAncestor)) throw new Error('Plugin symlink escapes root');
  return target;
}
export function candidateRoot(pluginsRoot: string, id: string): string {
  validatePluginId(id);
  const root = pluginPath(pluginsRoot, id);
  if (!fs.lstatSync(root).isDirectory() || fs.lstatSync(root).isSymbolicLink()) throw new Error('Invalid plugin directory');
  return root;
}
export function validateManifest(value: unknown): PluginManifest {
  if (!value || typeof value !== 'object') throw new Error('Invalid plugin manifest');
  const manifest = value as PluginManifest;
  validatePluginId(manifest.id);
  if (manifest.preboot !== undefined && typeof manifest.preboot !== 'boolean') throw new Error('Invalid preboot flag');
  if (manifest.permissions !== undefined && (!Array.isArray(manifest.permissions) || manifest.permissions.some((permission) => typeof permission !== 'string' || !permission))) throw new Error('Invalid permissions');
  for (const name of ['name', 'version', 'main'] as const) if (typeof manifest[name] !== 'string' || !manifest[name].trim()) throw new Error(`Invalid plugin manifest ${name}`);
  if (!['backend', 'frontend', 'both', 'theme', 'driver'].includes(manifest.type)) throw new Error('Invalid plugin type');
  validateRelativePath(manifest.main);
  for (const resource of [manifest.views, manifest.public]) if (resource !== undefined) validateRelativePath(resource);
  for (const urls of [manifest.styles, manifest.scripts]) {
    if (urls !== undefined && !Array.isArray(urls)) throw new Error('Invalid plugin asset list');
    for (const url of urls ?? []) { if (typeof url !== 'string') throw new Error('Invalid plugin asset'); validateRelativePath(url.split('?')[0]); }
  }
  return manifest;
}

const lifecycleNames = new Set(['default', 'preboot', 'bootstrap', 'activate']);
/** Inspect actual TypeScript export symbols and callable types; never import code. */
export function validatePluginEntry(root: string, main: string): string {
  const entry = pluginPath(root, main);
  if (!fs.existsSync(entry) || !fs.statSync(entry).isFile()) throw new Error(`Plugin entry ${main} does not exist`);
  const program = ts.createProgram([entry], { allowJs: true, checkJs: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext });
  const source = program.getSourceFile(entry);
  if (!source || program.getSyntacticDiagnostics(source).length) throw new Error('Invalid plugin entry syntax');
  const checker = program.getTypeChecker();
  const module = checker.getSymbolAtLocation(source);
  const exports = module ? checker.getExportsOfModule(module) : [];
  const functions = exports.filter((symbol) => lifecycleNames.has(symbol.name));
  if (!functions.length || functions.some((symbol) => !checker.getTypeOfSymbolAtLocation(symbol, source).getCallSignatures().length)) throw new Error('Plugin must export a callable default/preboot/bootstrap/activate lifecycle');
  return entry;
}
export function validateRuntimeEntry(entry: unknown): void {
  const module = entry as Record<string, unknown>;
  const exports = [...lifecycleNames].filter((name) => module[name] !== undefined);
  if (!exports.length || exports.some((name) => typeof module[name] !== 'function')) throw new Error('Plugin must export a callable default/preboot/bootstrap/activate lifecycle');
}
export function rejectSymlinks(root: string): void {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Plugin archive contains a symlink');
    if (entry.isDirectory()) rejectSymlinks(file);
  }
}
