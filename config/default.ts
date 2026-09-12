/*
 * LinearPress Default Site Configuration
 *
 * Baseline site configuration shipped with LinearPress.
 *
 * Authors:
 * MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥
 *
 * Copyright (C) 2026 Evarentha
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Exports the default <code>SiteConfig</code> applied before any persisted
 * settings exist: site identity and description, datetime locale preferences,
 * domain auto-detection, permalink pattern, and footer/ICP fields.
 *
 * @since 2.0.1
 */

import type { SiteConfig } from '../src/types/index.js';

export const siteConfig: SiteConfig = {
  title: 'LinearPress',
  description: 'A focused publishing system.',
  customCss: '',
  siteName: 'LinearPress',
  siteDescription: 'A focused publishing system.',
  siteTitle: '写下值得留下的内容。',
  siteSubtitle: 'LinearPress 是一个极简、可扩展、服务端渲染的写作空间。',
  timeSource: 'SYSTEM',
  dateFormat: 'zh-full',
  timeFormat: '24-hour',
  autoDetect: true,
  primaryDomain: '',
  backupDomains: [],
  permalink: '/posts/:slug',
  footerCopyright: 'powered-by',
  icpProvince: '',
  icpNumber: '',
  policeNumber: '',
  footerHtml: ''
};
