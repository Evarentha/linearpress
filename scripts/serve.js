#!/usr/bin/env node
/*
 * LinearPress Serve
 *
 * Implements the serve module for LinearPress.
 *
 * Authors:
 * MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥
 * worryzu <worryzu@gmail.com> @LinearTeam
 *
 * Copyright (C) 2026 Evarentha
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Public listener stays alive while isolated, loopback-only workers are replaced.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const number = (name, fallback, min = 1, max = 3600000) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid ${name}`);
  return value;
};
const port = number('PORT', 3000, 0, 65535);
const host = process.env.HOST || '0.0.0.0';
const startupMs = number('LINEARPRESS_STARTUP_TIMEOUT_MS', 60000);
const drainMs = number('LINEARPRESS_DRAIN_TIMEOUT_MS', 15000);
const restartLimit = number('LINEARPRESS_RESTART_LIMIT', 10, 1, 100);
const restartWindow = number('LINEARPRESS_RESTART_WINDOW_MS', 60000);
const retryMs = number('LINEARPRESS_RETRY_DELAY_MS', 300);
const logDirectory = path.join(root, 'data', '.logs');
fs.mkdirSync(logDirectory, { recursive: true });
const logFile = path.join(logDirectory, 'supervisor.log');
if (fs.existsSync(logFile) && fs.statSync(logFile).size > 10 * 1024 * 1024) {
  fs.rmSync(`${logFile}.1`, { force: true });
  fs.renameSync(logFile, `${logFile}.1`);
}
const logFd = fs.openSync(logFile, 'a');
function log(message) {
  const line = `${new Date().toISOString()} [supervisor ${process.pid}] ${message}\n`;
  fs.writeSync(logFd, line);
  process.stderr.write(line);
}
const fallback = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>LinearPress · 维护中</title><body><main><h1>站点正在维护 / Temporarily unavailable</h1><p>正在安全启动，请稍后重试。Please try again shortly.</p></main><script>(function(){var end=Date.now()+600000;async function poll(){if(Date.now()>end)return;try{var r=await fetch("/__linearpress/ready",{cache:"no-store",signal:AbortSignal.timeout(4000)});if(r.ok&&(await r.json()).ready){location.reload();return;}}catch(e){}setTimeout(poll,2000);}setTimeout(poll,1000);})();</script></body></html>';
function unavailable(req, res) {
  let html = fallback;
  try { html = fs.readFileSync(path.join(root, 'data', 'maintenance.html'), 'utf8'); } catch { /* built-in fallback */ }
  res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(html), 'Retry-After': '2', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(req.method === 'HEAD' ? undefined : html);
}
// RFC 9110 connection-specific fields, including arbitrary Connection tokens.
function endToEnd(headers) {
  const denied = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'proxy-connection']);
  for (const token of String(headers.connection || '').split(',')) denied.add(token.trim().toLowerCase());
  const result = {};
  for (const [name, value] of Object.entries(headers)) if (!denied.has(name.toLowerCase())) result[name] = value;
  return result;
}
let current;
let ready;
let stopping = false;
let busy = false;
let recoveries = 0;
const restartTimes = [];
const publicSockets = new Set();
const server = http.createServer((req, res) => {
  if (req.url?.split('?')[0] === '/__linearpress/ready') {
    res.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(ready ? {} : { 'Retry-After': '2' }) });
    res.end(JSON.stringify({ ready: !!ready, bootId: ready?.bootId ?? null }));
    return;
  }
  const target = ready;
  if (!target || stopping) return unavailable(req, res);
  const headers = endToEnd(req.headers);
  // The network peer, never client-supplied forwarding headers, is authoritative.
  for (const key of Object.keys(headers)) if (/^(x-forwarded-|x-linearpress-)/i.test(key) || ['forwarded', 'x-real-ip'].includes(key)) delete headers[key];
  headers.host = req.headers.host || '';
  headers['x-forwarded-host'] = headers.host;
  headers['x-forwarded-for'] = req.socket.remoteAddress || '127.0.0.1';
  headers['x-forwarded-proto'] = process.env.LINEARPRESS_PUBLIC_PROTOCOL === 'https' ? 'https' : 'http';
  headers['x-linearpress-proxy'] = target.token;
  const upstream = http.request({ host: '127.0.0.1', port: target.port, method: req.method, path: req.url, headers, agent: false }, response => {
    res.writeHead(response.statusCode || 502, endToEnd(response.headers));
    response.on('error', () => res.destroy());
    response.pipe(res);
  });
  upstream.on('error', error => {
    if (res.destroyed) return;
    if (res.headersSent) res.destroy(error);
    else unavailable(req, res);
  });
  req.on('aborted', () => upstream.destroy());
  req.on('error', () => upstream.destroy());
  res.on('close', () => { if (!res.writableFinished) upstream.destroy(); });
  req.pipe(upstream);
});
server.on('connection', socket => { publicSockets.add(socket); socket.on('close', () => publicSockets.delete(socket)); });
// WebSocket upgrades are deliberately unsupported; never leave a socket hanging.
server.on('upgrade', (_req, socket) => socket.end('HTTP/1.1 501 Not Implemented\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'));
server.on('clientError', (_error, socket) => socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'));

function spawnWorker(recovery, reason = '') {
  const token = crypto.randomBytes(32).toString('hex');
  const child = spawn(process.execPath, [path.join(root, 'scripts', 'supervisor-worker.js')], {
    cwd: root, stdio: ['ignore', logFd, logFd, 'ipc'], windowsHide: true,
    env: { ...process.env, PORT: '0', HOST: '127.0.0.1', LINEARPRESS_SUPERVISOR: '1', LINEARPRESS_WORKER: '1', LINEARPRESS_PROXY_TOKEN: token, LINEARPRESS_RECOVER_INSTALL: recovery ? '1' : '0', LINEARPRESS_RECOVERY_REASON: reason.slice(0, 8000) }
  });
  const state = { child, token, recovery, expected: false, exited: false, recovered: false, failure: '', started: Date.now() };
  current = state;
  state.exit = new Promise(resolve => child.once('close', (code, signal) => {
    state.exited = true;
    if (recovery && (code !== 0 || !state.recoveryAcknowledged)) state.failure ||= `Recovery exited without successful acknowledgement (code=${code}, signal=${signal || '-'})`;
    clearTimeout(state.timer);
    if (ready?.state === state) ready = undefined;
    log(`${recovery ? 'Recovery' : 'Worker'} pid=${child.pid} exited code=${code} signal=${signal || '-'}${state.expected ? ' (expected)' : ''}`);
    resolve();
    if (!state.expected && !stopping) void replace(true, state.failure || `Worker exited ${code ?? signal} ${state.wasReady ? 'after' : 'before'} ready`);
  }));
  child.on('error', error => { state.failure = error.stack || error.message; log(state.failure); });
  child.on('message', message => {
    if (!message || typeof message !== 'object' || stopping || current !== state) return;
    if (message.type === 'linearpress:ready' && !recovery && !state.expected && !state.wasReady) {
      if (!Number.isInteger(message.port) || message.port < 1 || message.port > 65535 || !/^[a-f0-9-]{36}$/.test(message.bootId || '')) return;
      clearTimeout(state.timer);
      state.wasReady = true;
      ready = { port: message.port, bootId: message.bootId, token, state };
      log(`Worker ready pid=${child.pid} port=${message.port} bootId=${message.bootId}`);
    } else if (message.type === 'linearpress:restart' && !recovery && !state.expected) {
      void replace(false, 'Worker requested restart');
    } else if (message.type === 'linearpress:failed') {
      state.failure = String(message.message || 'Worker startup failed').slice(0, 8000);
      log(state.failure);
      if (!recovery) void replace(true, state.failure);
    } else if (message.type === 'linearpress:recovered' && recovery) {
      state.recoveryAcknowledged = true;
      state.recovered = message.recovered === true;
    }
  });
  state.timer = setTimeout(() => {
    state.failure = `${recovery ? 'Recovery' : 'Worker'} startup timed out after ${startupMs}ms`;
    log(state.failure);
    if (recovery) { state.expected = true; child.kill('SIGKILL'); }
    else void replace(true, state.failure);
  }, startupMs);
  log(`Spawned ${recovery ? 'recovery' : 'worker'} pid=${child.pid}`);
  return state;
}
async function stopWorker(state) {
  if (!state || state.exited) return;
  state.expected = true;
  clearTimeout(state.timer);
  if (state.child.connected) state.child.send({ type: 'linearpress:shutdown' }, () => {});
  else state.child.kill('SIGTERM');
  const deadline = setTimeout(() => { log(`Drain timeout; killing pid=${state.child.pid}`); state.child.kill('SIGKILL'); }, drainMs);
  await state.exit;
  clearTimeout(deadline);
}
async function replace(failed, reason) {
  if (stopping || busy) return;
  busy = true;
  ready = undefined;
  log(reason);
  try {
    const previous = current;
    await stopWorker(previous);
    if (stopping) return;
    const now = Date.now();
    while (restartTimes.length && now - restartTimes[0] > restartWindow) restartTimes.shift();
    if (restartTimes.length >= restartLimit) { log(`Restart limit (${restartLimit}/${restartWindow}ms) reached; remaining in maintenance. Correct the fault and restart supervisor.`); return; }
    restartTimes.push(now);
    if (previous?.wasReady && now - previous.started > restartWindow) recoveries = 0;
    if (failed) {
      if (recoveries >= 2) { log('Installation recovery limit reached; remaining in maintenance. Inspect plugin-install-job.json and logs.'); return; }
      recoveries++;
      const recovery = spawnWorker(true, reason);
      recovery.expected = true;
      await recovery.exit;
      if (stopping) return;
      if (recovery.failure) { log('Recovery failed; refusing to import potentially broken plugins again.'); return; }
      log(`Recovery prepared=${recovery.recovered}; no unrelated plugins are modified by supervisor`);
    } else recoveries = 0;
    await new Promise(resolve => setTimeout(resolve, retryMs));
    if (!stopping) spawnWorker(false);
  } catch (error) { log(`Restart failed: ${error.stack || error}`); }
  finally { busy = false; }
}
async function shutdown() {
  if (stopping) return;
  stopping = true;
  ready = undefined;
  log('Shutting down; automatic restart disabled');
  const closed = new Promise(resolve => server.close(resolve));
  const deadline = setTimeout(() => { for (const socket of publicSockets) socket.destroy(); }, drainMs);
  await stopWorker(current);
  await closed;
  clearTimeout(deadline);
  fs.closeSync(logFd);
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
// PM2 shutdown_with_message and test harnesses work on Windows as well as Unix.
process.on('message', message => { if (message === 'shutdown' || message?.type === 'linearpress:shutdown') void shutdown(); });
process.on('disconnect', () => void shutdown());
server.on('error', error => { log(`Public listener failed: ${error.stack || error}`); void shutdown(); });
server.listen(port, host, () => {
  log(`Listening http://${host}:${server.address().port}; logs=${logFile}`);
  spawnWorker(false);
});
