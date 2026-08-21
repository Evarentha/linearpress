import type { HookName, HookPayloadMap } from '../types/hooks.js';

type Handler<K extends HookName> = { callback: (payload: HookPayloadMap[K]) => HookPayloadMap[K] | void | Promise<HookPayloadMap[K] | void>; priority: number; pluginId: string };

export class HookSystem {
  private handlers = new Map<HookName, Handler<HookName>[]>();
  private currentPluginId = 'core';

  setCurrentPluginId(id: string): void { this.currentPluginId = id; }

  on<K extends HookName>(name: K, callback: Handler<K>['callback'], options: { priority?: number } = {}): void {
    const list = (this.handlers.get(name) ?? []) as unknown as Handler<K>[];
    list.push({ callback, priority: options.priority ?? 10, pluginId: this.currentPluginId });
    list.sort((a, b) => a.priority - b.priority);
    this.handlers.set(name, list as unknown as Handler<HookName>[]);
  }

  offPlugin(pluginId: string): void {
    for (const [name, list] of this.handlers) this.handlers.set(name, list.filter((item) => item.pluginId !== pluginId));
  }

  async trigger<K extends HookName>(name: K, payload: HookPayloadMap[K]): Promise<HookPayloadMap[K]> {
    let result = payload;
    for (const item of (this.handlers.get(name) ?? []) as unknown as Handler<K>[]) result = (await item.callback(result)) ?? result;
    return result;
  }

  async collect<K extends HookName>(name: K, initial: HookPayloadMap[K]): Promise<HookPayloadMap[K]> {
    return this.trigger(name, initial);
  }
}
