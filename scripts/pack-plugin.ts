/*
 * LinearPress LPP Pack CLI
 *
 * Implements the pack plugin module for LinearPress.
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
import { packPluginDirectory, validateLpp } from '../src/services/lpp-package.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length !== 3 || args[1] !== '--out' || !args[0] || !args[2] || !args[2].toLowerCase().endsWith('.lpp')) throw new Error('Usage: node scripts/run.js scripts/pack-plugin.ts <plugin-directory> --out <file.lpp>');
  const source = path.resolve(args[0]), destination = path.resolve(args[2]);
  if (destination === source || destination.startsWith(`${source}${path.sep}`)) throw new Error('Output must be outside the plugin source directory');
  const buffer = await packPluginDirectory(source);
  const { manifest, metadata } = await validateLpp(buffer);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try { fs.writeFileSync(temporary, buffer, { flag: 'wx' }); fs.renameSync(temporary, destination); }
  finally { fs.rmSync(temporary, { force: true }); }
  console.log(`Packed ${manifest.id}@${manifest.version}: ${metadata.files.length} files, ${buffer.length} bytes -> ${destination}`);
  console.log('SHA-256 checks integrity, NOT publisher identity. Only install trusted server-side plugin code.');
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
