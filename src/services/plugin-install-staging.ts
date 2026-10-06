/*
 * Owned, crash-recoverable plugin staging directories.
 *
 * Implements the plugin install staging module for LinearPress.
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
import { rejectSymlinks } from '../core/plugin-validation.js';

export const STAGE_MARKER = '.linearpress-stage.json';
const bootToken = randomUUID();
const startedAt = new Date(Date.now() - process.uptime() * 1000).toISOString();
const active = new Set<string>();
const stageName = /^install-([1-9][0-9]*)-([0-9a-f-]{36})-([0-9a-f-]{36})$/;
interface Owner { schema: 1; pid: number; bootToken: string; token: string; startedAt: string; createdAt: string; }
function root(): string {
  const src = path.join(process.cwd(), 'src');
  const dir = path.join(src, '.plugin-install-staging');
  for (const item of [src, dir]) {
    fs.mkdirSync(item, { recursive: true });
    const stat = fs.lstatSync(item);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Staging root must be a real directory');
  }
  return dir;
}
function dead(pid: number): boolean {
  try { process.kill(pid, 0); return false; }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH'; }
}
/** Only provably dead owners are reaped. A live/reused PID or EPERM is not proof of death. */
export function reapPluginInstallStaging(): void {
  try {
    const parent = root();
    for (const name of fs.readdirSync(parent)) {
      const match = stageName.exec(name);
      if (!match) continue; // Legacy/unidentified stages require operator inspection, never an age-only guess.
      const dir = path.join(parent, name);
      if (active.has(dir)) continue;
      try {
        const stat = fs.lstatSync(dir);
        if (stat.isSymbolicLink() || !stat.isDirectory()) continue;
        const pid = Number(match[1]);
        if (!Number.isSafeInteger(pid) || !dead(pid)) continue;
        const marker = path.join(dir, STAGE_MARKER);
        if (fs.existsSync(marker)) {
          if (fs.lstatSync(marker).isSymbolicLink()) continue;
          const owner = JSON.parse(fs.readFileSync(marker, 'utf8')) as Owner;
          if (owner.schema !== 1 || owner.pid !== pid || owner.bootToken !== match[2] || owner.token !== match[3] || !Number.isFinite(Date.parse(owner.startedAt)) || !Number.isFinite(Date.parse(owner.createdAt))) continue;
        }
        // The owner-encoded directory name also covers a crash between mkdir and marker write.
        // Do not follow or even remove foreign links placed inside an otherwise owned stage.
        rejectSymlinks(dir);
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (error) { console.error('[plugin-install] stage reap deferred', name, error); }
    }
  } catch (error) { console.error('[plugin-install] staging housekeeping deferred', error); }
}
export function createPluginInstallStage(): { directory: string; cleanup(): void; detach(): void } {
  const token = randomUUID();
  const directory = path.join(root(), `install-${process.pid}-${bootToken}-${token}`);
  fs.mkdirSync(directory, { mode: 0o700 });
  active.add(directory);
  const owner: Owner = { schema: 1, pid: process.pid, bootToken, token, startedAt, createdAt: new Date().toISOString() };
  const cleanup = () => {
    if (fs.existsSync(directory)) {
      if (fs.lstatSync(directory).isSymbolicLink()) throw new Error('Owned staging directory was replaced by a symlink');
      rejectSymlinks(directory);
      fs.rmSync(directory, { recursive: true, force: true });
    }
    active.delete(directory);
  };
  try { fs.writeFileSync(path.join(directory, STAGE_MARKER), JSON.stringify(owner), { flag: 'wx', mode: 0o600 }); }
  catch (error) { cleanup(); throw error; }
  return { directory, cleanup, detach() { active.delete(directory); } };
}
