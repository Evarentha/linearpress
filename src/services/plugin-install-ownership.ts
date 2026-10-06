/*
 * Installation-scoped SQLite registry ownership (not plugin configuration).
 *
 * Implements the plugin install ownership module for LinearPress.
 *
 * Authors:
 * MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥
 * worryzu <worryzu@gmail.com> @LinearTeam
 *
 * Copyright (C) 2026 Evarentha
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { SqliteDatabase } from '../core/database.js';
import type { PluginManifest } from '../types/plugin.js';

/** Call inside the INSERT transaction. Replacement/deletion of a row invalidates its ownership. */
export function ensureInstallOwnership(database: SqliteDatabase): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS plugin_install_ownership (
      plugin_id TEXT PRIMARY KEY, installation_id TEXT NOT NULL,
      registry_rowid INTEGER NOT NULL, manifest TEXT NOT NULL
    );
    CREATE TRIGGER IF NOT EXISTS plugin_install_owner_deleted AFTER DELETE ON plugins BEGIN
      DELETE FROM plugin_install_ownership WHERE plugin_id=OLD.id;
    END;
    CREATE TRIGGER IF NOT EXISTS plugin_install_owner_replaced AFTER INSERT ON plugins BEGIN
      DELETE FROM plugin_install_ownership WHERE plugin_id=NEW.id;
    END;
    CREATE TRIGGER IF NOT EXISTS plugin_install_owner_renamed AFTER UPDATE OF id ON plugins WHEN OLD.id != NEW.id BEGIN
      DELETE FROM plugin_install_ownership WHERE plugin_id=OLD.id;
    END;
  `);
}
export function bindInstallOwnership(database: SqliteDatabase, installationId: string, manifest: PluginManifest): void {
  database.prepare('INSERT INTO plugin_install_ownership(plugin_id,installation_id,registry_rowid,manifest) SELECT id,?,rowid,? FROM plugins WHERE id=?')
    .run(installationId, JSON.stringify({ id: manifest.id, name: manifest.name, version: manifest.version, type: manifest.type, icon: manifest.icon ?? null, description: manifest.description ?? null }), manifest.id);
}
/** A foreign/replaced row is never deleted, even if it reuses the same ID and rowid. */
export async function removeOwnedInstallRow(database: SqliteDatabase, installationId: string, plugin: { id: string; name: string; version: string }): Promise<void> {
  const { sqliteTransaction } = await import('../core/database.js');
  await sqliteTransaction(database, () => {
    const table = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='plugin_install_ownership'").get();
    if (!table) return; // Historical journals without a registry identity cannot authorize row deletion.
    const owner = database.prepare('SELECT manifest FROM plugin_install_ownership WHERE plugin_id=? AND installation_id=?').get(plugin.id, installationId) as { manifest: string } | undefined;
    if (!owner) return;
    const manifest = JSON.parse(owner.manifest) as PluginManifest;
    if (manifest.id !== plugin.id || manifest.name !== plugin.name || manifest.version !== plugin.version) throw new Error('Installation registry ownership manifest mismatch');
    database.prepare(`DELETE FROM plugins WHERE id=? AND name=? AND version=? AND type=? AND icon IS ? AND description IS ?
      AND rowid=(SELECT registry_rowid FROM plugin_install_ownership WHERE plugin_id=? AND installation_id=?)`)
      .run(plugin.id, manifest.name, manifest.version, manifest.type, manifest.icon ?? null, manifest.description ?? null, plugin.id, installationId);
  });
}
export function releaseInstallOwnership(database: SqliteDatabase, installationId: string): void {
  if (database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='plugin_install_ownership'").get()) {
    database.prepare('DELETE FROM plugin_install_ownership WHERE installation_id=?').run(installationId);
  }
}
