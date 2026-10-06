# Supervised LinearPress deployment

## Entry point and guarantees

From `Base`, run `npm start` (or `npm run dev`). Both launch `node scripts/serve.js`; dev currently uses the same restart protocol, **not** filesystem watching. Node 22+ is required; use a current Node release providing `node:sqlite`. Dependencies, including the shipped `tsx` runtime, must be installed. Windows and Linux use the same single-PID worker loader; there is no intermediate tsx CLI process to leave running after a forced kill.

The supervisor owns `HOST`/`PORT` (`0.0.0.0:3000` by default). An application worker listens on a random **127.0.0.1-only** port. Keep one supervisor per data directory; do not configure PM2 cluster mode or multiple systemd replicas against the same SQLite database/install journal.

1. Public requests receive **503 + `Retry-After: 2`**, with `data/maintenance.html` when available or a built-in maintenance page, while booting/restarting/recovering. The public listener does not close between worker replacements.
2. Readiness requires completed plugin discovery, preboot/bootstrap/activation, successful private HTTP listen, and `verifyPendingInstall(manager)`. Only then does IPC publish readiness. A TCP listener alone is not success.
3. `GET /__linearpress/ready` always returns only `{ "ready": boolean, "bootId": string | null }`, status 200 iff ready, otherwise 503. It is not a job-status or diagnostic API. Job details require normal admin authentication/permissions.
4. Installation initiation is backend-owned; closing the browser does not cancel restart. While a durable install journal exists, non-GET/HEAD/OPTIONS mutations are rejected with 503 before the app parsers/session pipeline. Existing requests already in flight are drained, not rolled back.
5. A restart IPC request immediately withdraws readiness, drains/closes the old worker, then starts its replacement. Plugin disposal and database closure follow HTTP drain. An uncooperative worker is killed at the configured deadline, so an infinite loop cannot hold the public port or block maintenance responses.
6. On failure before readiness (including import errors, preboot exceptions, `process.exit()`, and startup hangs), a **separate recovery-mode worker** imports only `recoverPendingInstall(reason)`, not the app or candidate plugins. The jobs module validates journal paths and installation ownership before quarantine. Unrelated pre-existing plugins are not automatically deleted. A clean worker then verifies the recovered state. Recovery attempts are bounded (two until a stable run or explicit new restart cycle), and all replacements additionally have a rate limit. A failed recovery process never causes blindly importing the broken plugin again.
7. When limits are reached, the supervisor remains alive serving maintenance, with diagnostics in `Base/data/.logs/supervisor.log`. Correct the underlying problem and restart the supervisor; do not rely on PM2 to defeat the limit. Parent/worker stdout and stderr share this log (rotated at supervisor startup when above 10 MiB; use an external log rotation policy for long-lived production instances). No automatic database rollback is promised: plugins are trusted server code and may have already changed data or made external calls.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | Public bind address; use `127.0.0.1` behind a local TLS proxy |
| `PORT` | `3000` | Public port; 0 is useful for isolated tests |
| `LINEARPRESS_STARTUP_TIMEOUT_MS` | `60000` | Maximum app or recovery boot time |
| `LINEARPRESS_DRAIN_TIMEOUT_MS` | `15000` | Drain/disposal deadline, then hard kill |
| `LINEARPRESS_RESTART_LIMIT` | `10` | Maximum replacements in the rolling window |
| `LINEARPRESS_RESTART_WINDOW_MS` | `60000` | Rolling replacement window |
| `LINEARPRESS_RETRY_DELAY_MS` | `300` | Delay before starting a replacement |
| `LINEARPRESS_PUBLIC_PROTOCOL` | `http` | Set to `https` only behind a trusted TLS terminator |

`LINEARPRESS_WORKER`, `LINEARPRESS_SUPERVISOR`, `LINEARPRESS_PROXY_TOKEN`, and recovery variables are private launcher protocol fields; do not set them to imitate supervision during direct startup.

## Reverse proxy security

The gateway streams request/response bodies with backpressure and forwards statuses, cookies (including multiple `Set-Cookie` fields), and end-to-end headers. Original HTTP `Host` and URL are preserved for origin checks and site redirects. Hop-by-hop headers, including names nominated by `Connection`, are stripped. Client `Forwarded`, `X-Real-IP`, `X-Forwarded-*`, and private proxy headers are discarded. The supervisor creates trusted forwarding metadata from the actual network peer and configured public protocol. The private worker requires a fresh random token and trusts only one loopback proxy hop. Do not publish the worker port/token.

This intentionally means that behind nginx/Caddy, **`req.ip` identifies that proxy**, not arbitrary incoming `X-Forwarded-For`. There is no trust-all-forwarders option. Applications needing end-user IP through another proxy need a separately reviewed trusted-proxy policy. For TLS termination set `LINEARPRESS_PUBLIC_PROTOCOL=https` and prevent direct external access to the public HTTP listener; an incoming header cannot switch Express to HTTPS or forge a client IP. WebSocket/HTTP Upgrade is currently unsupported and returns 501; ordinary streamed HTTP is supported.

## PM2

Run the supervisor, not `index.ts`, in one fork instance. Example `ecosystem.config.cjs` (outside the application repository as appropriate):

```js
module.exports = { apps: [{
  name: 'linearpress', cwd: '/srv/linearpress/Base',
  script: 'scripts/serve.js', interpreter: 'node', exec_mode: 'fork', instances: 1,
  shutdown_with_message: true, kill_timeout: 20000,
  env: { NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '3000', LINEARPRESS_PUBLIC_PROTOCOL: 'https' }
}] };
```

PM2 restarts the **supervisor itself** if it crashes. Worker restarts stay internal. `shutdown_with_message` is particularly important on Windows: Node's `child.kill('SIGTERM')` maps to abrupt termination there, not a graceful POSIX signal. The supervisor accepts PM2's `shutdown` IPC message on both platforms. On Linux SIGTERM/SIGINT drain the worker and never spawn another one. Windows console Ctrl+C also requests graceful shutdown. Forced OS termination cannot guarantee grace; the private worker exits when its parent IPC disconnects, unless its event loop is stuck (use process-manager tree termination in that case).

## systemd (Linux)

```ini
[Unit]
Description=LinearPress supervisor
After=network.target

[Service]
Type=simple
WorkingDirectory=/srv/linearpress/Base
ExecStart=/usr/bin/node /srv/linearpress/Base/scripts/serve.js
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=3000
Environment=LINEARPRESS_PUBLIC_PROTOCOL=https
Restart=on-failure
RestartSec=3
TimeoutStopSec=25
KillMode=mixed
User=linearpress
Group=linearpress

[Install]
WantedBy=multi-user.target
```

Grant the service user write access to its own data/uploads/plugin installation directories only as required. `KillMode=mixed` initially signals the supervisor, allowing ordered HTTP drain; systemd kills remaining cgroup children only if the stop deadline expires. Make the process manager's stop timeout longer than the application's drain timeout.

## Direct mode / troubleshooting

`node scripts/run.js index.ts` and existing tsx direct invocations still start the app without a gateway. A direct `requestRestart()` closes/drains first and attempts a detached handoff. **It has no persistent maintenance listener and no guaranteed automatic failure recovery.** Managed installation therefore rejects direct mode rather than claiming completion. PM2/systemd environment variables alone are not supervision detection.

For startup errors inspect `data/.logs/supervisor.log` and authenticated job diagnostics, plus the retained journal/quarantine. A damaged/unowned journal is not authorization to delete a plugin directory. If a failure reaches the configured limit, repair configuration/code and restart the supervisor manually.

## Regression

From the repository root:

```sh
node .pi/lpp/supervisor-regression.mjs
```

This spawns real supervisor/application processes using random loopback public ports and private copied runtimes/dependencies, never the original site's data. It asserts IPC PID changes, continuous maintenance responses, verified readiness, streamed requests/in-flight responses, session/cookie forwarding, Host/IP/protocol/header anti-spoofing, private worker rejection, mutation freeze, import/preboot/early-exit/hang recovery, drain/recovery timeouts, bounded replacements and shutdown. The harness stubs only the jobs hooks **inside its generated runtime** to isolate the process protocol; the production hooks remain untouched. Backend/e2e regressions separately exercise the actual durable install journal and package pipeline. Windows uses shutdown IPC for the graceful-stop assertion; Linux uses SIGTERM. Failed fixtures retain their private logs for inspection.
