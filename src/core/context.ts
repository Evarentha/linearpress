/*
 * LinearPress Active Context Holder
 *
 * Module-level holder for the active Cordis context.
 *
 * Authors:
 * MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥
 *
 * Copyright (C) 2026 Evarentha
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Keeps a single active Cordis <code>Context</code> reachable from modules
 * that lack direct access to the plugin manager, and allows replacing a
 * named service through Cordis reflection so later plugin activations take
 * effect for core consumers.
 *
 * @since 2.0.1
 */

import type { Context } from 'cordis';

let active: Context | undefined;

export function setActiveContext(context: Context): void { active = context; }
export function getActiveContext(): Context {
  if (!active) throw new Error('LinearPress context is not initialized');
  return active;
}
export function replaceService(context: Context, name: string, value: unknown): void {
  context.reflect.set(name, value);
}
