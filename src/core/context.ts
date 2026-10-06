/*
 * LinearPress Active Context Holder
 *
 * Module-level holder for the active Cordis context.
 *
 * Authors:
 * MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥
 * worryzu <worryzu@gmail.com> @LinearTeam
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
import { assertRegistrationActive } from './lifecycle-scope.js';

// Only the root provider writes its value. Child fibers own revocable leases,
// never Cordis providers for the same name.
const replacements = new WeakMap<Context, Map<string, { base: unknown; leases: Array<{ value: unknown }> }>>();

let active: Context | undefined;

export function setActiveContext(context: Context | undefined): void { active = context; }
export function getActiveContext(): Context {
  if (!active) throw new Error('LinearPress context is not initialized');
  return active;
}
export function replaceService(context: Context, name: string, value: unknown): void {
  assertRegistrationActive();
  const root = (context as Context & { root: Context }).root;
  if (root === context) {
    const state = replacements.get(root)?.get(name);
    if (state) state.base = value;
    else root.reflect.set(name, value);
    return;
  }
  if (!Object.prototype.hasOwnProperty.call((root.fiber as typeof root.fiber & { store: Record<string, unknown> }).store, name)) throw new Error(`Service ${name} is not owned by the root provider`);
  let services = replacements.get(root);
  if (!services) replacements.set(root, services = new Map());
  let state = services.get(name);
  if (!state) services.set(name, state = { base: root.reflect.get(name, false), leases: [] });
  const lease = { value };
  const owned = state;
  context.effect(() => {
    owned.leases.push(lease);
    root.reflect.set(name, value);
    return () => {
      const index = owned.leases.indexOf(lease);
      if (index >= 0) owned.leases.splice(index, 1);
      root.reflect.set(name, owned.leases.length ? owned.leases[owned.leases.length - 1].value : owned.base);
      if (!owned.leases.length) services!.delete(name);
    };
  });
}
