/*
 * LinearPress Cordis Runtime Wrapper
 *
 * Self-contained Cordis runtime for tooling and smoke tests.
 *
 * Authors:
 * MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥
 *
 * Copyright (C) 2026 Evarentha
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * <code>CordisRuntime</code> runs callbacks inside a dedicated fiber per
 * plugin id, provides services into the runtime context (without overwriting
 * existing providers), and disposes each plugin's fibers in reverse
 * registration order.
 *
 * @since 2.0.1
 */

import { Context, type Fiber } from 'cordis';

export class CordisRuntime {
  readonly context = new Context();
  private fibers = new Map<string, Fiber[]>();

  async run<T>(pluginId: string, callback: (context: Context) => T | Promise<T>): Promise<T> {
    let result!: T;
    const plugin = async (context: Context) => { result = await callback(context); };
    Object.defineProperty(plugin, 'name', { value: `linearpress:${pluginId}` });
    const fiber = this.context.plugin(plugin);
    await fiber;
    const list = this.fibers.get(pluginId) ?? [];
    list.push(fiber);
    this.fibers.set(pluginId, list);
    return result;
  }

  provide(name: string, service: unknown): void {
    if (this.context.reflect.get(name, false) === undefined) this.context.reflect.provide(name, service);
    else this.context.reflect.set(name, service);
  }

  async dispose(pluginId: string): Promise<void> {
    const list = this.fibers.get(pluginId) ?? [];
    this.fibers.delete(pluginId);
    for (const fiber of [...list].reverse()) await fiber.dispose();
  }

  async disposeAll(): Promise<void> {
    for (const pluginId of [...this.fibers.keys()].reverse()) await this.dispose(pluginId);
    await this.context.fiber.dispose();
  }
}
