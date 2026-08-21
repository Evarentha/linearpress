import type { PluginEntry } from '../../types/plugin.js';
export const activate: PluginEntry['activate'] = ({ logger }) => logger.info('theme ready');
