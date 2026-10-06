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
 * When `NODE_INSPECT_HOST` is set (Compose uses `0.0.0.0`), each child listens on a
 * fixed inspector port so Cursor can attach breakpoints.
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
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exit(code);
};

/**
 * Spawns a TypeScript entry.
 *
 * Without inspect: `tsx watch` so Compose file sync restarts the process.
 * With inspect: `node --inspect --import tsx <script>` so the inspected process
 * is the one that runs route code. The `tsx` CLI always forks a child; putting
 * `--inspect` on the CLI leaves breakpoints on an empty parent process.
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
  const debugging = Boolean(inspectHost && inspectPort !== undefined);
  const args = debugging
    ? [`--inspect=${inspectHost}:${inspectPort}`, '--import', 'tsx', script]
    : [tsxCli, 'watch', '--clear-screen=false', script];

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
  const authDisabled = (process.env.AUTH_DISABLED ?? 'true') === 'true';
  const env: Record<string, string> = {
    PORT: String(areaPort(area)),
    DYNAMODB_ENDPOINT: process.env.DYNAMODB_ENDPOINT ?? 'http://127.0.0.1:8000',
    CLIENT_ORIGIN: process.env.CLIENT_ORIGIN ?? 'http://localhost:4200',
    AUTH_DISABLED: authDisabled ? 'true' : 'false',
    AUTH_CALLBACK_URL:
      process.env.AUTH_CALLBACK_URL ?? 'http://localhost:3000/identity/oauth/callback',
  };
  if (authDisabled) {
    env.AUTH_SEED_USER_ID =
      process.env.AUTH_SEED_USER_ID?.trim() || '44444444-4444-4444-8444-444444444444';
  }
  if (area === 'chat' || area === 'schedule') {
    env.FANOUT_DELIVER_URL =
      process.env.FANOUT_DELIVER_URL ??
      `http://127.0.0.1:${areaPort('fanout')}/fanout/deliver`;
  }
  if (area === 'fanout') {
    env.WEBSOCKET_CALLBACK_URL =
      process.env.WEBSOCKET_CALLBACK_URL ?? `http://127.0.0.1:${areaPort('socket')}`;
  }
  if (area === 'media') {
    env.MEDIA_BUCKET = process.env.MEDIA_BUCKET ?? 'gameplan-media-local';
    env.MEDIA_PUBLIC_ORIGIN =
      process.env.MEDIA_PUBLIC_ORIGIN ?? 'http://localhost:3000';
  }
  start(`functions/${area}/src/local.ts`, env, inspectPortForArea(area));
}
start('local/src/proxy.ts', {}, PROXY_INSPECT_PORT);
