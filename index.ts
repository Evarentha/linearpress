/*
 * LinearPress Application Entry Point
 *
 * Minimal launcher that boots the LinearPress server application.
 *
 * Authors:
 * MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥
 * worryzu <worryzu@gmail.com> @LinearTeam
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

// Dynamic import lets the launcher diagnose module-import failures as well as
// async bootstrap failures. The supervisor recovery helper never imports this file.
try {
  const { start } = await import('./src/core/app.js');
  await start();
} catch (error) {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error('[LinearPress] Startup failed:', message);
  if (process.connected) process.send?.({ type: 'linearpress:failed', message }, () => {});
  setTimeout(() => process.exit(1), 30);
}
