/*
 * LinearPress Plugin Lifecycle Ownership
 *
 * Implements the lifecycle scope module for LinearPress.
 *
 * Authors:
 * MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥
 * worryzu <worryzu@gmail.com> @LinearTeam
 *
 * Copyright (C) 2026 Evarentha
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { Context } from 'cordis';

interface Scope { id: string; context: Context; active: boolean; }
const scopes = new AsyncLocalStorage<Scope>();
const arrayOwners = new WeakMap<unknown[], object[]>();

export function currentPluginId(fallback = 'core'): string { return scopes.getStore()?.id ?? fallback; }
export function withLifecycleScope<T>(id: string, context: Context, callback: () => T): T {
  const scope = { id, context, active: true };
  context.effect(() => () => { scope.active = false; });
  return scopes.run(scope, callback);
}

export function assertRegistrationActive(): void {
  if (scopes.getStore()?.active === false) throw new Error('Plugin lifecycle has been disposed');
}
export function ownResource(dispose: () => void): void {
  const scope = scopes.getStore();
  assertRegistrationActive();
  if (scope) scope.context.effect(() => dispose);
}
export function bindLifecycle<T extends (...args: any[]) => any>(callback: T): T {
  const scope = scopes.getStore();
  if (!scope) return callback;
  return ((...args: Parameters<T>) => scopes.run(scope, () => callback(...args))) as T;
}
export function appendOwned<T>(list: T[], value: T, changed: () => void = () => {}): void {
  assertRegistrationActive();
  let owners = arrayOwners.get(list);
  if (!owners) { owners = list.map(() => ({})); arrayOwners.set(list, owners); }
  const token = {};
  owners.push(token);
  list.push(value);
  changed();
  ownResource(() => {
    const index = owners.indexOf(token);
    if (index >= 0) { owners.splice(index, 1); list.splice(index, 1); }
    changed();
  });
}
