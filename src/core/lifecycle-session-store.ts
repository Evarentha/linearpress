/*
 * Revocable root-provider session store bridge.
 *
 * Implements the lifecycle session store module for LinearPress.
 *
 * Authors:
 * MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥
 * worryzu <worryzu@gmail.com> @LinearTeam
 *
 * Copyright (C) 2026 Evarentha
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import session from 'express-session';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestHandler } from 'express';

type Factory = () => session.Store;
/** Express keeps this bridge, not a disposed driver's concrete store. */
export class LifecycleSessionStore extends session.Store {
  private factory?: Factory;
  private store?: session.Store;
  private readonly stores = new WeakMap<Factory, session.Store>();
  // After a provider switch, never look up an old SID in another authority:
  // identical user ids there need not refer to the same person.
  private accepted?: Map<string, number>;
  private lastSweep = 0;
  private sweepAccepted(): void {
    const now = Date.now();
    if (!this.accepted || now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [sid, expires] of this.accepted) if (expires <= now) this.accepted.delete(sid);
  }
  private readonly requests = new AsyncLocalStorage<Factory>();
  constructor(private currentFactory: () => Factory) { super(); }
  private current(): session.Store {
    const factory = this.currentFactory();
    if (factory !== this.factory) {
      if (this.factory) this.accepted = new Map();
      this.store = this.stores.get(factory);
      if (!this.store) { this.store = factory(); this.stores.set(factory, this.store); }
      this.factory = factory;
    }
    this.sweepAccepted();
    return this.store!;
  }
  scope(): RequestHandler {
    return (_req, _res, next) => {
      try { this.current(); this.requests.run(this.factory!, next); } catch (error) { next(error); }
    };
  }
  private staleRequest(): boolean { const owner = this.requests.getStore(); return !!owner && owner !== this.factory; }
  get(sid: string, callback: (error: any, session?: session.SessionData | null) => void): void {
    try {
      const store = this.current();
      if (this.staleRequest() || (this.accepted && (this.accepted.get(sid) ?? 0) <= Date.now())) return callback(null, null);
      const factory = this.factory;
      store.get(sid, (error, data) => {
        if (factory !== this.currentFactory()) return callback(null, null);
        callback(error, data);
      });
    } catch (error) { callback(error); }
  }
  set(sid: string, data: session.SessionData, callback?: (error?: any) => void): void {
    try {
      const store = this.current();
      if (this.staleRequest()) return callback?.();
      const factory = this.factory;
      store.set(sid, data, (error?: any) => {
        if (!error && factory === this.currentFactory()) {
          const expires = data.cookie?.expires ? new Date(data.cookie.expires).getTime() : Date.now() + 86_400_000;
          this.accepted?.set(sid, Number.isFinite(expires) ? expires : Date.now() + 86_400_000);
        }
        callback?.(error);
      });
    } catch (error) { callback?.(error); }
  }
  destroy(sid: string, callback?: (error?: any) => void): void {
    try { const store = this.current(); if (this.staleRequest()) return callback?.(); this.accepted?.delete(sid); store.destroy(sid, callback); } catch (error) { callback?.(error); }
  }
  touch(sid: string, data: session.SessionData, callback?: (error?: any) => void): void {
    try { const store = this.current(); if (this.staleRequest()) return callback?.(); if (store.touch) store.touch(sid, data, callback); else callback?.(); }
    catch (error) { callback?.(error); }
  }
}
