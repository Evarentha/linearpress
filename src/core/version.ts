/*
 * Author: MoyuZJ
 * Team: LinearTeam
 * Contact: linearteam@foxmail.com
 * Made by MoyuZJ in China with ♥
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
