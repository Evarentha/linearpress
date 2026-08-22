/*
 * Author: MoyuZJ
 * Team: LinearTeam
 * Contact: linearteam@foxmail.com
 * Made by MoyuZJ in China with ♥
 */

export interface SiteConfig { title: string; description: string; customCss: string; }
export type PostStatus = 'draft' | 'published' | 'archived';
export type CommentStatus = 'pending' | 'approved' | 'spam';

export type Block =
  | { type: 'paragraph'; content: string }
  | { type: 'heading'; level: 1 | 2 | 3; content: string }
  | { type: 'blockquote'; content: string }
  | { type: 'image'; src: string; alt?: string }
  | { type: 'custom-html'; content: string }
  | { type: string; [key: string]: unknown };

export interface User { id: number; username: string; password_hash: string; email: string | null; group_id: number; is_super_admin: number; created_at: string; }
export interface Group { id: number; name: string; permissions: string[]; is_system: number; created_at: string; }
export interface Post { id: number; title: string; slug: string; content_json: Block[]; html_cache: string | null; status: PostStatus; author_id: number; views: number; created_at: string; updated_at: string | null; }
export interface Comment { id: number; post_id: number; user_id: number | null; guest_name: string | null; guest_email: string | null; content: string; status: CommentStatus; ip: string | null; created_at: string; }
export interface Plugin { id: string; name: string; version: string; enabled: number; load_order: number; config: string | null; installed_at: string; }
