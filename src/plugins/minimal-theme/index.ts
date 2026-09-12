/*
  Minimal Theme Plugin

  Cordis plugin entry for the minimal theme.

  Authors:
  MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥

  Copyright (C) 2026 Evarentha
  SPDX-License-Identifier: GPL-3.0-or-later
*/
/**
  Cordis plugin entry for the minimal theme package. Logs that the
  theme is ready on activation; the theme's post template ships in
  the plugin's views directory.
  @since 2.0.1
*/

import type { Context } from 'cordis';

export default function minimalTheme(context: Context): void {
  context.logger.info('theme ready');
}
