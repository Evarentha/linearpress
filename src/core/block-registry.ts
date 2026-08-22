/*
 * Author: MoyuZJ
 * Team: LinearTeam
 * Contact: linearteam@foxmail.com
 * Made by MoyuZJ in China with ♥
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
