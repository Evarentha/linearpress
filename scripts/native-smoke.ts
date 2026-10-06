/*
 * LinearPress Native Smoke
 *
 * Implements the native smoke module for LinearPress.
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
const root = process.cwd();
const ids = ['advanced-posts-list', 'media-library', 'mysql-plugin', 'modern-editor'];
for (const id of ids) fs.cpSync(path.join(root, '..', 'Plugins', id), path.join(root, 'src', 'plugins', id), { recursive: true });
const dbPath = path.join(root, 'data', `native-${randomUUID()}.db`);
process.env.DB_PATH = dbPath;
process.env.SESSION_SECRET = 'native-smoke-secret';
const { createApp } = await import('../src/core/app.js');
const app = await createApp();
const server = app.listen(0);
try {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  const base = `http://127.0.0.1:${address.port}`;
  const home = await fetch(base);
  const homeText = await home.text();
  console.log('home', home.status, 'hasAdvancedCss', homeText.includes('advanced-posts-list'), 'hasMediaCss', homeText.includes('media-library'));
} finally {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  for (const id of ids) fs.rmSync(path.join(root, 'src', 'plugins', id), { recursive: true, force: true });
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${dbPath}${suffix}`, { force: true });
}
