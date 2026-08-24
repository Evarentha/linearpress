/*
 * Author: MoyuZJ
 * Team: LinearTeam
 * Contact: linearteam@foxmail.com
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
