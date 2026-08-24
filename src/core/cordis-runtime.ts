/*
 * Author: MoyuZJ
 * Team: LinearTeam
 * Contact: linearteam@foxmail.com
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
