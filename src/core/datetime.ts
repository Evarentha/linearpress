/*
 * LinearPress Date and Time Formatting
 *
 * Site-configurable date and time formatting helpers.
 *
 * Authors:
 * MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥
 *
 * Copyright (C) 2026 Evarentha
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Exposes the date/time format option tables used by site settings, resolves
 * the reference "now" from the server clock or a configured ISO 8601 base
 * time, and formats dates (Chinese and English styles) combined with 12- or
 * 24-hour times according to the site configuration.
 *
 * @since 2.0.1
 */

import type { SiteConfig, TimeFormat } from '../types/index.js';

export interface SelectOption { value: string; label: string; }

/** 日期格式选项（value 为内部键，label 为 UI 展示的示例）。 */
export const DATE_FORMAT_OPTIONS: SelectOption[] = [
  { value: 'zh-full', label: 'yyyy 年1月1日 星期X' },
  { value: 'zh-dmy', label: '日月年' },
  { value: 'slash-mdy', label: '月/日/年' },
  { value: 'slash-dmy', label: '1/1/2026' },
  { value: 'month-name', label: 'Jan 1 2026' }
];

export const TIME_FORMAT_OPTIONS: SelectOption[] = [
  { value: '24-hour', label: '二十四小时制' },
  { value: '12-hour', label: '十二小时制' }
];

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pad = (value: number): string => String(value).padStart(2, '0');

/** 依据 timeSource 计算“当前时刻”：SYSTEM 用服务器时间，否则尝试解析 ISO 8601 基准时间。 */
export function referenceNow(timeSource: string): Date {
  if (timeSource && timeSource !== 'SYSTEM') {
    const parsed = new Date(timeSource);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

export function formatDatePart(date: Date, format: string): string {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  switch (format) {
    case 'zh-full': return `${y}年${m}月${d}日 ${WEEKDAYS[date.getDay()]}`;
    case 'zh-dmy': return `${d}日${m}月${y}年`;
    case 'slash-mdy': return `${m}/${d}/${y}`;
    case 'slash-dmy': return `${d}/${m}/${y}`;
    case 'month-name': return `${MONTHS_EN[date.getMonth()]} ${d} ${y}`;
    default: return `${y}-${pad(m)}-${pad(d)}`;
  }
}

export function formatTimePart(date: Date, format: TimeFormat): string {
  const hh = date.getHours();
  const mm = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  if (format === '12-hour') {
    const period = hh < 12 ? '上午' : '下午';
    return `${period} ${pad(hh % 12 || 12)}:${mm}:${ss}`;
  }
  return `${pad(hh)}:${mm}:${ss}`;
}

type DateTimeConfig = Pick<SiteConfig, 'timeSource' | 'dateFormat' | 'timeFormat'>;

/** 格式化日期时间：优先使用传入日期，缺省时使用 timeSource 参考时间。 */
export function formatDate(value: Date | string | null | undefined, config: DateTimeConfig): string {
  const date = value ? new Date(value) : referenceNow(config.timeSource);
  if (Number.isNaN(date.getTime())) return String(value ?? '');
  const datePart = formatDatePart(date, config.dateFormat);
  const timePart = formatTimePart(date, config.timeFormat);
  return `${datePart} ${timePart}`.trim();
}
