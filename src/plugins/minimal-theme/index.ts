/*
 * Author: MoyuZJ
 * Team: LinearTeam
 * Contact: linearteam@foxmail.com
 * Made by MoyuZJ in China with ♥
 */

import type { PluginEntry } from '../../types/plugin.js';
export const activate: PluginEntry['activate'] = ({ logger }) => logger.info('theme ready');
