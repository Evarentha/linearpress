/*
 * LinearPress Block Registry
 *
 * Central registry mapping content block types to HTML renderers.
 *
 * Authors:
 * MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥
 *
 * Copyright (C) 2026 Evarentha
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Plugins register renderers per block type and unregister them on teardown;
 * <code>renderBlocks()</code> renders a post's block list to HTML, skipping
 * unknown types. Built-in block types (paragraph, heading, blockquote, image,
 * custom-html) are registered here with HTML-escaped content.
 *
 * @since 2.0.1
 */

import type { Block } from '../types/index.js';
import type { GenericBlock } from '../types/plugin.js';

type Renderer = (block: GenericBlock) => string;
interface Entry { renderer: Renderer; pluginId: string; }

const registry = new Map<string, Entry>();
const esc = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]!));

export function registerBlock(type: string, renderer: Renderer, pluginId = 'core'): void { registry.set(type, { renderer, pluginId }); }
export function unregisterPluginBlocks(pluginId: string): void { for (const [type, entry] of registry) if (entry.pluginId === pluginId) registry.delete(type); }
export function renderBlocks(blocks: Block[]): string { return blocks.map((block) => registry.get(block.type)?.renderer(block as unknown as GenericBlock) ?? '').join('\n'); }

registerBlock('paragraph', (block) => `<p>${esc(block.content)}</p>`);
registerBlock('heading', (block) => `<h${String(block.level)}>${esc(block.content)}</h${String(block.level)}>`);
registerBlock('blockquote', (block) => `<blockquote>${esc(block.content)}</blockquote>`);
registerBlock('image', (block) => `<figure><img src="${esc(block.src)}" alt="${esc(block.alt ?? '')}"></figure>`);
registerBlock('custom-html', (block) => String(block.content ?? ''));
