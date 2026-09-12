/*
 * LinearPress Version Constant
 *
 * Runtime version identifier for LinearPress.
 *
 * Authors:
 * MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥
 *
 * Copyright (C) 2026 Evarentha
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Resolves <code>LINEARPRESS_VERSION</code> from <code>package.json</code>
 * via <code>createRequire</code>, falling back to the hard-coded
 * <code>2.0.1</code> when the manifest cannot be read. Shown in the site
 * footer and the OOBE welcome page.
 *
 * @since 2.0.1
 */

import { createRequire } from 'node:module';

/** LinearPress 运行版本，用于页脚与 OOBE 欢迎页展示。 */
export const LINEARPRESS_VERSION: string = (() => {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require('../../package.json') as { version?: string };
    return pkg.version || '2.0.1';
  } catch {
    return '2.0.1';
  }
})();
