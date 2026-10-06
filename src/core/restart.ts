/*
 * LinearPress Restart
 *
 * Implements the restart module for LinearPress.
 *
 * Authors:
 * MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥
 * worryzu <worryzu@gmail.com> @LinearTeam
 *
 * Copyright (C) 2026 Evarentha
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { spawn } from 'node:child_process';

let restartRequested = false;
let shutdown: (() => Promise<void>) | undefined;
export function isRestartRequested(): boolean { return restartRequested; }
export function registerShutdown(handler: () => Promise<void>): void { shutdown = handler; }

/** Supervised restarts are serialized by the public gateway, never by PM2 guesses. */
export function requestRestart(): void {
  if (restartRequested) return;
  restartRequested = true;
  if (process.env.LINEARPRESS_WORKER === '1' && process.env.LINEARPRESS_SUPERVISOR === '1' && process.connected) {
    process.send?.({ type: 'linearpress:restart' }, () => {});
    return;
  }
  // Direct mode remains a best-effort handoff, NOT automatic failure recovery.
  // Close/drain our listener before spawning, so old/new workers never race PORT.
  console.warn('[LinearPress] Direct restart: no persistent maintenance gateway or automatic recovery. Use node scripts/serve.js.');
  setTimeout(async () => {
    try {
      if (!shutdown) throw new Error('Application shutdown handler is not registered');
      await shutdown();
      const child = spawn(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
        detached: true, stdio: 'ignore', env: { ...process.env, LINEARPRESS_RESTART_CHILD: '1' }
      });
      child.once('error', error => { console.error('[LinearPress] Direct restart failed:', error); process.exit(1); });
      child.once('spawn', () => { child.unref(); process.exit(0); });
    } catch (error) { console.error('[LinearPress] Direct restart failed:', error); process.exitCode = 1; }
  }, 100);
}
