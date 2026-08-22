/*
 * Author: MoyuZJ
 * Team: LinearTeam
 * Contact: linearteam@foxmail.com
 * Made by MoyuZJ in China with ♥
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ServiceContainer, createToken } from '../src/core/service-container.js';

const testToken = createToken<{ value: number }>('smoke:test');
const container = new ServiceContainer();
container.provide(testToken, { value: 1 });
assert.equal(container.resolve(testToken).value, 1);
container.decorate(testToken, (service) => ({ value: service.value + 1 }));
assert.equal(container.resolve(testToken).value, 2);
container.replace(testToken, { value: 3 });
assert.equal(container.resolve(testToken).value, 3);

const dbPath = path.join(process.cwd(), 'data', `smoke-${randomUUID()}.db`);
process.env.DB_PATH = dbPath;
process.env.SESSION_SECRET = 'smoke-test-session-secret';
const { createApp } = await import('../src/core/app.js');
const { db } = await import('../src/core/database.js');
const { generateSlug } = await import('../src/services/post.service.js');
const app = await createApp();
const server = app.listen(0);
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Test server did not bind');
const base = `http://127.0.0.1:${address.port}`;
let cookie = '';

async function request(route: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (cookie) headers.set('cookie', cookie);
  const response = await fetch(`${base}${route}`, { ...init, headers, redirect: 'manual' });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  return response;
}

try {
  let response = await request('/');
  assert.equal(response.status, 302, 'clean install should enter OOBE');
  assert.equal(response.headers.get('location'), '/oobe');
  response = await request('/oobe');
  assert.equal(response.status, 200, 'OOBE page should render');

  const oobeBody = new URLSearchParams({ username: 'rootadmin', email: 'root@example.com', password: 'pass1234', password_confirmation: 'pass1234' });
  response = await request('/oobe', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: oobeBody });
  assert.equal(response.status, 302, 'OOBE should create and sign in the super administrator');
  assert.equal(response.headers.get('location'), '/admin');
  assert.equal((db.prepare('SELECT COUNT(*) count FROM users WHERE is_super_admin=1').get() as { count: number }).count, 1);

  response = await request('/oobe');
  assert.equal(response.status, 302, 'completed OOBE cannot run again');
  assert.equal(response.headers.get('location'), '/');
  response = await request('/admin/groups');
  assert.equal(response.status, 200, 'super administrator should access groups');
  response = await request('/admin/plugins');
  assert.equal(response.status, 200, 'super administrator should access plugins');
  response = await request('/admin/seo');
  assert.equal(response.status, 200, 'super administrator should access plugin routes');

  response = await request('/');
  assert.equal(response.status, 200);
  const homeHtml = await response.text();
  assert.equal(homeHtml.includes('/plugins/'), false, 'no example plugin assets should be loaded');

  assert.equal(generateSlug('你好，LinearPress 世界！'), '你好-linearpress-世界', 'Unicode titles should generate readable slugs');
  const blocks = JSON.stringify([{ type: 'paragraph', content: 'Plugin-independent content' }]);
  const postBody = new URLSearchParams({ title: 'Smoke Post', slug: '', status: 'published', content_json: blocks });
  response = await request('/admin/posts/save', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: postBody });
  assert.equal(response.status, 302, 'super administrator should publish a post with an automatic slug');
  assert.ok(db.prepare("SELECT id FROM posts WHERE slug='smoke-post'").get(), 'blank slug should be generated from title');

  response = await request('/admin/posts/save', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: postBody });
  assert.equal(response.status, 302, 'duplicate title should still save');
  assert.ok(db.prepare("SELECT id FROM posts WHERE slug='smoke-post-2'").get(), 'duplicate slug should receive a numeric suffix');

  response = await request('/post/smoke-post');
  assert.equal(response.status, 200, 'published post should render');
  const postHtml = await response.text();
  assert.match(postHtml, /Responses/, 'later-loaded theme should override the post view');
  assert.match(postHtml, /Plugin-independent content/, 'core content should render without example plugins');
  console.log('Smoke tests passed');
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  db.close();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${dbPath}${suffix}`, { force: true });
}
