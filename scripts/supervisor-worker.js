/*
 * LinearPress Supervisor Worker
 *
 * Implements the supervisor worker module for LinearPress.
 *
 * Authors:
 * MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥
 * worryzu <worryzu@gmail.com> @LinearTeam
 *
 * Copyright (C) 2026 Evarentha
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// A single Node PID owns the loader and app: no tsx CLI grandchildren to orphan.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function send(message) {
  if (process.connected) process.send(message, () => {});
}

try {
  if (!process.env.ESBUILD_BINARY_PATH) {
    const executable = process.platform === 'win32' ? 'esbuild.exe' : 'esbuild';
    const source = path.join(process.cwd(), 'node_modules', '@esbuild', `${process.platform}-${process.arch}`, 'bin', executable);
    if (fs.existsSync(source)) {
      const directory = path.join(os.tmpdir(), 'linearpress-tools');
      const target = path.join(directory, executable);
      fs.mkdirSync(directory, { recursive: true });
      if (!fs.existsSync(target) || fs.statSync(source).mtimeMs > fs.statSync(target).mtimeMs) fs.copyFileSync(source, target);
      if (process.platform !== 'win32') fs.chmodSync(target, 0o755);
      process.env.ESBUILD_BINARY_PATH = target;
    }
  }
  const { register } = await import('tsx/esm/api');
  register();
  if (process.env.LINEARPRESS_RECOVER_INSTALL === '1') {
    // Never import app, discover plugins or run migrations in this process.
    const { recoverPendingInstall } = await import('../src/core/plugin-install-jobs.ts');
    const reason = process.env.LINEARPRESS_RECOVERY_REASON || 'Worker failed before readiness';
    const recovered = await recoverPendingInstall(reason);
    const { recoverPendingPluginChange } = await import('../src/core/plugin-change-jobs.ts');
    const changed = await recoverPendingPluginChange(reason);
    send({ type: 'linearpress:recovered', recovered: recovered === true || changed === true });
    setTimeout(() => process.exit(0), 20);
  } else {
    await import(pathToFileURL(path.join(process.cwd(), 'index.ts')).href);
  }
} catch (error) {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error('[LinearPress] Worker startup failed:', message);
  send({ type: 'linearpress:failed', message });
  setTimeout(() => process.exit(1), 20);
}
