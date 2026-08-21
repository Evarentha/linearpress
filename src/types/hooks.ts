import type { Post } from './index.js';
export interface HookPayloadMap { 'post:beforeSave': Post; 'post:afterSave': Post; 'post:beforeRender': { post: Post; html: string }; 'admin:menu': Array<{ title: string; link: string }>; }
export type HookName = keyof HookPayloadMap;
