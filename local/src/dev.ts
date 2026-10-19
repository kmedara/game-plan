/**
 * Starts every area process and the local reverse proxy for day-to-day development.
 *
 * Each area runs as its own Node.js process so the cloud model (one function per area)
 * stays visible on the laptop. The proxy keeps a single local origin.
 *
 * Area and proxy processes use `tsx watch` so source edits restart them. In Compose,
 * `docker compose up --watch` syncs host files into the container filesystem; `tsx watch`
 * then sees normal inotify events (no bind-mount polling).
 *
 * When `NODE_INSPECT_HOST` is set (Compose uses `0.0.0.0`), `--inspect` is passed after
 * `watch` so it lands on the child that runs the routes. The watcher parent stays
 * uninspected and restarts that child when a synced file changes.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AREAS, areaPort, type Area } from '../../functions/lib/names.js';

/** Absolute path to the repository root. */
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

/** Resolve the `tsx` CLI from the root workspace install. */
const require = createRequire(import.meta.url);
const tsxCli = join(dirname(require.resolve('tsx/package.json')), 'dist', 'cli.mjs');

/** Child processes started for the areas and the proxy. */
const children: ChildProcess[] = [];

/** Local reminder sweep. Assigned after the area processes start. */
let reminderTimer: ReturnType<typeof setInterval> | undefined;

/** First inspector port (identity); later areas and the proxy use the next ports. */
const INSPECT_BASE_PORT = 9229;

/** Stable inspector port for each area process. */
const inspectPortForArea = (area: Area): number =>
  INSPECT_BASE_PORT + AREAS.indexOf(area);

/** Inspector port for the reverse proxy (after the last area). */
const PROXY_INSPECT_PORT = INSPECT_BASE_PORT + AREAS.length;

/**
 * Stops every child process and exits the parent.
 *
 * @param code - The process exit code. Defaults to `0`.
 */
const shutdown = (code = 0): void => {
  if (reminderTimer !== undefined) clearInterval(reminderTimer);
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exit(code);
};

/**
 * Spawns a TypeScript entry under `tsx watch`.
 *
 * `--inspect` is an argument of `watch`, not of this parent process. The `tsx`
 * CLI forks a child to run the script; a flag before `watch` would attach the
 * debugger to the watcher and leave route breakpoints unbound.
 *
 * @param script - A path relative to the repository root.
 * @param env - Extra environment variables for the child.
 * @param inspectPort - When `NODE_INSPECT_HOST` is set, bind the inspector here.
 */
const start = (
  script: string,
  env: Record<string, string> = {},
  inspectPort?: number,
): void => {
  const inspectHost = process.env.NODE_INSPECT_HOST?.trim();
  const inspectArgs =
    inspectHost && inspectPort !== undefined
      ? [`--inspect=${inspectHost}:${inspectPort}`]
      : [];
  const args = [tsxCli, 'watch', '--clear-screen=false', ...inspectArgs, script];

  const child = spawn(process.execPath, args, {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });
  children.push(child);
  child.on('exit', (exitCode, signal) => {
    // `tsx watch` stays alive across restarts; a real exit means stop everything.
    if (signal !== null) return;
    if (exitCode !== null && exitCode !== 0) shutdown(exitCode);
  });
};

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

for (const area of AREAS) {
  const env: Record<string, string> = {
    PORT: String(areaPort(area)),
    DYNAMODB_ENDPOINT: process.env.DYNAMODB_ENDPOINT ?? 'http://127.0.0.1:8000',
    CLIENT_ORIGIN: process.env.CLIENT_ORIGIN ?? 'http://localhost:4200',
    AUTH_CALLBACK_URL:
      process.env.AUTH_CALLBACK_URL ?? 'http://localhost:4200/api/identity/oauth/callback',
  };
  if (area === 'chat' || area === 'schedule' || area === 'teams' || area === 'payments') {
    env.FANOUT_DELIVER_URL =
      process.env.FANOUT_DELIVER_URL ??
      `http://127.0.0.1:${areaPort('fanout')}/fanout/deliver`;
  }
  if (area === 'fanout') {
    env.WEBSOCKET_CALLBACK_URL =
      process.env.WEBSOCKET_CALLBACK_URL ?? `http://127.0.0.1:${areaPort('socket')}`;
    // A throttled slice is posted back here when the queue is not running.
    if ((process.env.FANOUT_QUEUE_URL ?? '').length === 0) {
      env.FANOUT_DELIVER_URL =
        process.env.FANOUT_DELIVER_URL ??
        `http://127.0.0.1:${areaPort('fanout')}/fanout/deliver`;
    }
    const vapidPublic = process.env.VAPID_PUBLIC_KEY?.trim();
    const vapidPrivate = process.env.VAPID_PRIVATE_KEY?.trim();
    if (vapidPublic !== undefined && vapidPublic.length > 0) env.VAPID_PUBLIC_KEY = vapidPublic;
    if (vapidPrivate !== undefined && vapidPrivate.length > 0) env.VAPID_PRIVATE_KEY = vapidPrivate;
    env.VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? 'mailto:push@gameplan.local';
  }
  if (area === 'media') {
    env.MEDIA_BUCKET = process.env.MEDIA_BUCKET ?? 'gameplan-media-local';
    env.MEDIA_PUBLIC_ORIGIN =
      process.env.MEDIA_PUBLIC_ORIGIN ?? 'http://localhost:3000';
  }
  if (area === 'payments') {
    for (const name of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'PLATFORM_FEE_BPS']) {
      const value = process.env[name]?.trim();
      if (value !== undefined && value.length > 0) env[name] = value;
    }
    env.PAYMENTS_RETURN_URL =
      process.env.PAYMENTS_RETURN_URL ?? 'http://localhost:4200/api/payments/return';
  }
  if (area === 'places') {
    const mapsKey = process.env.GOOGLE_MAPS_API_KEY?.trim();
    if (mapsKey !== undefined && mapsKey.length > 0) {
      env.GOOGLE_MAPS_API_KEY = mapsKey;
    }
  }
  start(`functions/${area}/src/local.ts`, env, inspectPortForArea(area));
}
start('local/src/proxy.ts', {}, PROXY_INSPECT_PORT);

reminderTimer = setInterval(() => {
  void Promise.all([
    import('../../functions/schedule/src/reminders.js').then((mod) => mod.runDueReminders(new Date())),
    import('../../functions/payments/src/reminders.js').then((mod) =>
      mod.runDuePaymentReminders(new Date()),
    ),
  ])
    .catch((error: unknown) => {
      console.warn(
        JSON.stringify({
          service: 'dev',
          event: 'reminder_sweep_failed',
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    });
}, 60_000);
reminderTimer.unref?.();
