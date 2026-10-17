/**
 * Starts Expo or exports the website, mapping the deploy env vars onto EXPO_PUBLIC_*.
 */

import { spawn } from 'node:child_process';

const apiBaseUrl = (
  process.env.EXPO_PUBLIC_API_BASE_URL ??
  process.env.API_BASE_URL ??
  'http://localhost:4200/api'
).replace(/\/$/u, '');

if (process.env.BUILD_CONFIGURATION === 'production' && process.env.API_BASE_URL === undefined) {
  throw new Error('API_BASE_URL must be set for a production environment build');
}

/**
 * Local web calls `/api` on the website port. The socket process stays on port 3000.
 * A deployed `/api` base has no socket on that host, so the WebSocket URL is required.
 *
 * @param base - The HTTP API base URL.
 * @returns The WebSocket URL to bake into the client.
 */
const websocketFallback = (base) => {
  const url = new URL(base);
  const path = url.pathname.replace(/\/$/u, '');
  const wsProtocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  if (path === '/api' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) {
    return `${wsProtocol}//${url.hostname}:3000/socket`;
  }
  if (path === '/api') {
    throw new Error('WS_BASE_URL must be set when API_BASE_URL is the website /api path');
  }
  return `${wsProtocol}//${url.host}/socket`;
};

const configuredWs = [process.env.EXPO_PUBLIC_WS_BASE_URL, process.env.WS_BASE_URL].find(
  (value) => value !== undefined && value.trim() !== '',
);

process.env.EXPO_PUBLIC_API_BASE_URL = apiBaseUrl;
process.env.EXPO_PUBLIC_WS_BASE_URL = (configuredWs ?? websocketFallback(apiBaseUrl)).replace(/\/$/u, '');
process.env.EXPO_PUBLIC_AUTH_DISABLED =
  process.env.EXPO_PUBLIC_AUTH_DISABLED ?? process.env.AUTH_DISABLED ?? 'false';
process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY =
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? process.env.GOOGLE_MAPS_BROWSER_API_KEY ?? '';
process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY =
  process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY ?? process.env.VAPID_PUBLIC_KEY ?? '';

const mode = process.argv[2] ?? 'start';
const extra = process.argv.slice(3);
const args =
  mode === 'export'
    ? ['expo', 'export', '--platform', 'web', ...extra]
    : ['expo', 'start', ...extra];

const child = spawn('npx', args, { stdio: 'inherit', shell: true, env: process.env });
child.on('exit', (code) => process.exit(code ?? 1));
