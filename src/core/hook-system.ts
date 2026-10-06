/*
 * LinearPress Hook System
 *
 * Priority-ordered, plugin-scoped hook dispatch.
 *
 * Authors:
 * MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥
 * worryzu <worryzu@gmail.com> @LinearTeam
 *
 * Copyright (C) 2026 Evarentha
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * <code>HookSystem</code> registers handlers per hook name with a priority
 * and an owning plugin id, drops them on plugin teardown, and chains async
 * handlers through <code>trigger()</code> so each handler can transform the
 * payload; <code>collect()</code> is the gather-style alias. Hooks with no
 * handlers return the payload directly on a zero-cost fast path.
 *
 * @since 2.0.1
 */

import type { HookName, HookPayloadMap } from '../types/hooks.js';
import { assertRegistrationActive, bindLifecycle, currentPluginId, ownResource } from './lifecycle-scope.js';

type Handler<K extends HookName> = { callback: (payload: HookPayloadMap[K]) => HookPayloadMap[K] | void | Promise<HookPayloadMap[K] | void>; priority: number; pluginId: string };

export class HookSystem {
  private handlers = new Map<HookName, Handler<HookName>[]>();
  private currentPluginId = 'core';

  setCurrentPluginId(id: string): void { this.currentPluginId = id; }

  on<K extends HookName>(name: K, callback: Handler<K>['callback'], options: { priority?: number } = {}): void {
    assertRegistrationActive();
    const list = (this.handlers.get(name) ?? []) as unknown as Handler<K>[];
    const handler = { callback: bindLifecycle(callback), priority: options.priority ?? 10, pluginId: currentPluginId(this.currentPluginId) };
    list.push(handler);
    ownResource(() => { this.handlers.set(name, (this.handlers.get(name) ?? []).filter((item) => item !== handler)); });
    list.sort((a, b) => a.priority - b.priority);
    this.handlers.set(name, list as unknown as Handler<HookName>[]);
  }

  offPlugin(pluginId: string): void {
    for (const [name, list] of this.handlers) this.handlers.set(name, list.filter((item) => item.pluginId !== pluginId));
  }

  /** 是否注册了该 hook 的处理器（供热路径跳过 async 调度）。 */
  hasHandlers(name: HookName): boolean { return (this.handlers.get(name)?.length ?? 0) > 0; }

  async trigger<K extends HookName>(name: K, payload: HookPayloadMap[K]): Promise<HookPayloadMap[K]> {
    const list = this.handlers.get(name);
    if (!list || !list.length) return payload; // 快速路径：无处理器时零开销返回
    let result = payload;
    for (const item of list as unknown as Handler<K>[]) result = (await item.callback(result)) ?? result;
    return result;
  }

  async collect<K extends HookName>(name: K, initial: HookPayloadMap[K]): Promise<HookPayloadMap[K]> {
    return this.trigger(name, initial);
  }
}
