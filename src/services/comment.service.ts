/*
 * Author: MoyuZJ
 * Team: LinearTeam
 * Contact: linearteam@foxmail.com
 * Made by MoyuZJ in China with ♥
 */

import { db } from '../core/database.js';
import type { Comment } from '../types/index.js';
export function approvedForPost(postId: number): Comment[] { return db.prepare("SELECT * FROM comments WHERE post_id=? AND status='approved' ORDER BY created_at ASC").all(postId) as Comment[]; }
export function listComments(): Array<Comment & { post_title: string; username: string | null }> { return db.prepare('SELECT comments.*, posts.title AS post_title, users.username FROM comments JOIN posts ON posts.id=comments.post_id LEFT JOIN users ON users.id=comments.user_id ORDER BY comments.created_at DESC').all() as Array<Comment & { post_title: string; username: string | null }>; }
export function findComment(id: number): Comment | undefined { return db.prepare('SELECT * FROM comments WHERE id=?').get(id) as Comment | undefined; }
export function createComment(input: { postId: number; userId?: number; guestName?: string; guestEmail?: string; content: string; ip?: string }): Comment { if (input.content.trim().length < 2) throw new Error('评论内容过短'); const id = Number(db.prepare('INSERT INTO comments(post_id,user_id,guest_name,guest_email,content,ip) VALUES(?,?,?,?,?,?)').run(input.postId, input.userId ?? null, input.guestName ?? null, input.guestEmail ?? null, input.content.trim(), input.ip ?? null).lastInsertRowid); return findComment(id)!; }
export function setCommentStatus(id: number, status: 'approved' | 'pending' | 'spam'): void { db.prepare('UPDATE comments SET status=? WHERE id=?').run(status, id); }
export function deleteComment(id: number): void { db.prepare('DELETE FROM comments WHERE id=?').run(id); }
