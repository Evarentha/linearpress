/*
 * LinearPress Database Initializer
 *
 * One-shot helper that prepares the infrastructure database.
 *
 * Authors:
 * MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥
 * worryzu <worryzu@gmail.com> @LinearTeam
 *
 * Copyright (C) 2026 Evarentha
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Runs the SQLite schema migrations against the configured database and
 * closes the handle.
 *
 * @since 2.0.1
 */

import { db, runMigrations } from '../src/core/database.js';
runMigrations();
console.log('Database initialized.');
db.close();
