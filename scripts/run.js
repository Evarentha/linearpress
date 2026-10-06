/*
 * LinearPress Run
 *
 * Implements the run module for LinearPress.
 *
 * Authors:
 * MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥
 * worryzu <worryzu@gmail.com> @LinearTeam
 *
 * Copyright (C) 2026 Evarentha
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function esbuildPackageName() {
  const platform = process.platform === 'android' ? 'android' : process.platform;
  const arch = process.arch;
  return `@esbuild/${platform}-${arch}`;
}

function prepareEsbuild() {
  if (process.env.ESBUILD_BINARY_PATH) return;
  const executable = process.platform === 'win32' ? 'esbuild.exe' : 'esbuild';
  const source = path.join(process.cwd(), 'node_modules', esbuildPackageName(), 'bin', executable);
  if (!fs.existsSync(source)) return;
  const targetDir = path.join(os.tmpdir(), 'linearpress-tools');
  const target = path.join(targetDir, executable);
  fs.mkdirSync(targetDir, { recursive: true });
  try {
    if (!fs.existsSync(target) || fs.statSync(source).mtimeMs > fs.statSync(target).mtimeMs) fs.copyFileSync(source, target);
    if (process.platform !== 'win32') fs.chmodSync(target, 0o755);
    process.env.ESBUILD_BINARY_PATH = target;
  } catch {
    // Let tsx report its normal error if the executable directory is unavailable.
  }
}

prepareEsbuild();
const cli = path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
process.argv = [process.argv[0], cli, ...process.argv.slice(2)];
await import(pathToFileURL(cli).href);
