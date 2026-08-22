import { spawn } from 'node:child_process';

let restartRequested = false;

/**
 * Ask the current launcher to restart, falling back to starting the same Node
 * command after the current process has released its port.
 */
export function requestRestart(): void {
  if (restartRequested) return;
  restartRequested = true;

  // A process manager can restart us more reliably than a detached child.
  if (process.env.PM2_HOME || process.env.INVOCATION_ID || process.env.LINEARPRESS_SUPERVISOR === '1') {
    setTimeout(() => process.exit(0), 350);
    return;
  }

  const child = spawn(process.execPath, process.argv.slice(1), {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, LINEARPRESS_RESTART_CHILD: '1' }
  });
  child.unref();
  setTimeout(() => process.exit(0), 350);
}
