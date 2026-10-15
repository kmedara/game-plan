/**
 * Starts Expo or exports the website, mapping the deploy env vars onto EXPO_PUBLIC_*.
 */

import { spawn } from 'node:child_process';

const apiBaseUrl = (
  process.env.EXPO_PUBLIC_API_BASE_URL ??
  process.env.API_BASE_URL ??
  'http://localhost:3000'
).replace(/\/$/u, '');

if (process.env.BUILD_CONFIGURATION === 'production' && process.env.API_BASE_URL === undefined) {
  throw new Error('API_BASE_URL must be set for a production environment build');
}

const defaultWs = apiBaseUrl.startsWith('https://')
  ? `wss://${apiBaseUrl.slice('https://'.length)}/socket`
  : `ws://${apiBaseUrl.replace(/^http:\/\//u, '')}/socket`;

process.env.EXPO_PUBLIC_API_BASE_URL = apiBaseUrl;
process.env.EXPO_PUBLIC_WS_BASE_URL = (
  process.env.EXPO_PUBLIC_WS_BASE_URL ??
  process.env.WS_BASE_URL ??
  defaultWs
).replace(/\/$/u, '');
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
