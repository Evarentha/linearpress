/*
 * Author: MoyuZJ
 * Team: LinearTeam
 * Contact: linearteam@foxmail.com
 * Made by MoyuZJ in China with ♥
 */

import { siteConfig } from '../../config/default.js';
import type { SiteConfig } from '../types/index.js';

const state: SiteConfig = { ...siteConfig };
export function getBaseConfig(): SiteConfig { return { ...state }; }
export function setBaseConfig(patch: Partial<SiteConfig>): void { Object.assign(state, patch); }
