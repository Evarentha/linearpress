/*
 * LinearPress Comment Data Service
 *
 * Comment persistence, moderation and listing queries.
 *
 * Authors:
 * MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥
 * worryzu <worryzu@gmail.com> @LinearTeam
 *
 * Copyright (C) 2026 Evarentha
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Direct SQLite data access for comments: approved comments per post, admin
 * listings joined with post titles and usernames, creation with
 * minimum-length and field-length validation, and status moderation and
 * deletion.
 *
 * @since 2.0.1
 */

import { db } from '../core/database.js';
import type { Comment } from '../types/index.js';
export function approvedForPost(postId: number): Comment[] { return db.prepare("SELECT * FROM comments WHERE post_id=? AND status='approved' ORDER BY created_at ASC").all(postId) as Comment[]; }
export function listComments(): Array<Comment & { post_title: string; username: string | null }> { return db.prepare('SELECT comments.*, posts.title AS post_title, users.username FROM comments JOIN posts ON posts.id=comments.post_id LEFT JOIN users ON users.id=comments.user_id ORDER BY comments.created_at DESC').all() as Array<Comment & { post_title: string; username: string | null }>; }
export function findComment(id: number): Comment | undefined { return db.prepare('SELECT * FROM comments WHERE id=?').get(id) as Comment | undefined; }
/** 评论字段长度上限：防止超大 payload 刷爆数据库（插件可在 hook 中进一步收紧）。 */
const MAX_CONTENT_LENGTH = 5000;
const MAX_NAME_LENGTH = 80;
const MAX_EMAIL_LENGTH = 160;

export function createComment(input: { postId: number; userId?: number; guestName?: string; guestEmail?: string; content: string; ip?: string }): Comment { if (input.content.trim().length < 2) throw new Error('评论内容过短'); if (input.content.length > MAX_CONTENT_LENGTH) throw new Error(`评论内容不能超过 ${MAX_CONTENT_LENGTH} 字`); if ((input.guestName ?? '').length > MAX_NAME_LENGTH) throw new Error('姓名过长'); if ((input.guestEmail ?? '').length > MAX_EMAIL_LENGTH) throw new Error('邮箱过长'); const id = Number(db.prepare('INSERT INTO comments(post_id,user_id,guest_name,guest_email,content,ip) VALUES(?,?,?,?,?,?)').run(input.postId, input.userId ?? null, input.guestName ?? null, input.guestEmail ?? null, input.content.trim(), input.ip ?? null).lastInsertRowid); return findComment(id)!; }
export function setCommentStatus(id: number, status: 'approved' | 'pending' | 'spam'): void { db.prepare('UPDATE comments SET status=? WHERE id=?').run(status, id); }
export function deleteComment(id: number): void { db.prepare('DELETE FROM comments WHERE id=?').run(id); }
