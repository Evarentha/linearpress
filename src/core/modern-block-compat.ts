/*
 * Legacy Modern Editor Compatibility
 *
 * Safely render previously stored editor markers when the plugin is unavailable.
 *
 * Authors:
 * MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥
 * worryzu <worryzu@gmail.com> @LinearTeam
 *
 * Copyright (C) 2026 Evarentha
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const MARKER = 'LP-MODERN-BLOCK::';
const MAX_MARKER_LENGTH = 4 * 1024 * 1024;
const escape = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]!));
const inlineTags = new Set(['strong', 'b', 'em', 'i', 'u', 's', 'del', 'span', 'br', 'code', 'mark', 'font']);
const inlineStyles = new Set(['color', 'background-color', 'font-size', 'text-decoration-line', 'text-decoration-style', 'font-weight', 'font-style']);
const text = (value: unknown): string => String(value ?? '').replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);)/gi, '&amp;').replace(/[<>"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]!));

/** Tokenize before escaping: unfinished tags and unrecognized attributes never survive. */
function inline(value: unknown): string {
  const raw = String(value ?? '');
  let cursor = 0;
  let html = '';
  for (const match of raw.matchAll(/<!--[\s\S]*?-->|<\/?([a-z][\w-]*)([^>]*)>/gi)) {
    html += text(raw.slice(cursor, match.index)).replace(/\r?\n/g, '<br>');
    cursor = match.index! + match[0].length;
    const tag = match[1]?.toLowerCase();
    if (!tag || !inlineTags.has(tag)) continue;
    if (tag === 'br') { html += '<br>'; continue; }
    const outputTag = tag === 'font' ? 'span' : tag;
    if (match[0].startsWith('</')) { html += `</${outputTag}>`; continue; }
    const rawStyle = match[2]?.match(/\bstyle\s*=\s*(["'])(.*?)\1/i)?.[2] ?? '';
    const styles = rawStyle.split(';').map((s) => s.trim()).filter((s) => {
      const colon = s.indexOf(':');
      const property = s.slice(0, colon).trim().toLowerCase();
      const value = s.slice(colon + 1).trim();
      return colon > 0 && inlineStyles.has(property) && /^[#\w (),.%+-]+$/.test(value) && !/expression|url\s*\(/i.test(value);
    }).join(';');
    html += `<${outputTag}${styles ? ` style="${escape(styles)}"` : ''}>`;
  }
  return html + text(raw.slice(cursor)).replace(/\r?\n/g, '<br>');
}

function url(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw || /[\u0000-\u0020\u007f]/.test(raw)) return '#';
  if (/^https?:\/\//i.test(raw) || /^\/(?!\/)/.test(raw) || raw.startsWith('./') || raw.startsWith('../') || raw.startsWith('#')) return escape(raw);
  return '#';
}
function decode(value: unknown): Record<string, unknown> | undefined {
  const raw = String(value ?? '');
  if (!raw.startsWith(MARKER) || raw.length > MAX_MARKER_LENGTH) return undefined;
  const encoded = raw.slice(MARKER.length);
  if (!encoded || !/^[a-z\d+/]*={0,2}$/i.test(encoded)) return undefined;
  try {
    const block: unknown = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    return block && typeof block === 'object' && !Array.isArray(block) ? block as Record<string, unknown> : undefined;
  } catch { return undefined; }
}
function render(block: Record<string, unknown>, depth: number): string {
  if (depth > 12) return '<p>旧编辑器内容嵌套过深。</p>';
  const body = () => inline(block.contentHtml ?? block.content);
  switch (String(block.type ?? 'paragraph')) {
    case 'custom-html': {
      const decoded = decode(block.content);
      return decoded ? render(decoded, depth + 1) : `<p>${escape(block.content)}</p>`;
    }
    case 'paragraph': return `<p>${body()}</p>`;
    case 'heading': { const level = Math.min(6, Math.max(1, Number(block.level) || 2)); return `<h${level}>${body()}</h${level}>`; }
    case 'blockquote': case 'quote': return `<blockquote><p>${body()}</p>${block.cite ? `<cite>${escape(block.cite)}</cite>` : ''}</blockquote>`;
    case 'code': case 'pre': return `<pre>${block.type === 'code' ? '<code>' : ''}${escape(block.content)}${block.type === 'code' ? '</code>' : ''}</pre>`;
    case 'list': {
      const tag = block.ordered ? 'ol' : 'ul';
      const values = Array.isArray(block.itemsHtml) ? block.itemsHtml : Array.isArray(block.items) ? block.items : String(block.items ?? '').split('\n').filter(Boolean);
      return `<${tag}>${values.map((value) => `<li>${inline(value)}</li>`).join('')}</${tag}>`;
    }
    case 'details': case 'collapse': return `<details${block.open ? ' open' : ''}><summary>${inline(block.summaryHtml ?? block.summary ?? '展开详情')}</summary><div>${body()}</div></details>`;
    case 'math': return `<div class="lp-modern-math">${escape(block.content)}</div>`;
    case 'citation': case 'poem': return `<figure><blockquote>${body()}</blockquote>${block.source ? `<figcaption>${escape(block.source)}</figcaption>` : ''}</figure>`;
    case 'table': {
      const rows = Array.isArray(block.cells) ? block.cells : String(block.rows ?? '').split('\n').filter(Boolean).map((row) => row.split('|'));
      return `<table><tbody>${rows.filter(Array.isArray).map((row) => `<tr>${row.map((cell: unknown) => `<td>${inline(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    }
    case 'image': return `<figure><img src="${url(block.src)}" alt="${escape(block.alt)}"></figure>`;
    case 'audio': return `<audio controls src="${url(block.src)}"></audio>`;
    case 'video': return `<video controls src="${url(block.src)}"></video>`;
    case 'icon': return `<span aria-label="${escape(block.label)}">${escape(block.icon ?? '✦')}</span>`;
    case 'button': {
      const buttons = Array.isArray(block.buttonsHtml) ? block.buttonsHtml : String(block.buttons ?? '按钮').split('\n');
      return `<p>${buttons.map((button) => `<a href="${url(block.href)}">${inline(button)}</a>`).join('')}</p>`;
    }
    case 'columns': {
      const columns = Array.isArray(block.columns) ? block.columns.slice(0, 3) : [{ type: 'paragraph', contentHtml: block.leftHtml ?? block.left }, { type: 'paragraph', contentHtml: block.rightHtml ?? block.right }];
      return `<div class="lp-modern-columns">${columns.map((column) => `<div class="lp-modern-column">${render(column && typeof column === 'object' ? column as Record<string, unknown> : { content: column }, depth + 1)}</div>`).join('')}</div>`;
    }
    case 'spacer': return `<div style="height:${Math.max(8, Math.min(400, Number(block.size) || 48))}px"></div>`;
    default: return `<p>${body()}</p>`;
  }
}

/** Plain custom HTML keeps its existing contract; only legacy encoded markers are decoded. */
export function renderLegacyModernHtml(content: unknown): string {
  const raw = String(content ?? '');
  if (!raw.startsWith(MARKER)) return raw;
  const block = decode(raw);
  return block ? render(block, 0) : '<p>旧编辑器内容无法解析，请重新启用编辑器检查原文。</p>';
}
