/*
 * LinearPress Application Entry Point
 *
 * Minimal launcher that boots the LinearPress server application.
 *
 * Authors:
 * MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥
 *
 * Copyright (C) 2026 Evarentha
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Delegates to the application bootstrap module in <code>src/core/app.ts</code>
 * and starts the HTTP server.
 *
 * @since 2.0.1
 */

import { start } from './src/core/app.js';

start();
