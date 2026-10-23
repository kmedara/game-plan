/**
 * Starts Expo or exports the website, mapping the deploy env vars onto EXPO_PUBLIC_*.
 * An export also writes the app-link files when `APPLE_TEAM_ID` or `ANDROID_CERT_SHA256` is set.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import appLinks from './app-links.js';

const { appleAppSiteAssociation, assetLinks, fingerprintList } = appLinks;

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
process.env.EXPO_PUBLIC_SUPPORT_EMAIL =
  process.env.EXPO_PUBLIC_SUPPORT_EMAIL ?? process.env.SUPPORT_EMAIL ?? '';

const mode = process.argv[2] ?? 'start';
const extra = process.argv.slice(3);
const args =
  mode === 'export'
    ? ['expo', 'export', '--platform', 'web', ...extra]
    : ['expo', 'start', ...extra];

/**
 * Writes the files that let the store apps open invite links on this host.
 *
 * Each file is written only when its signing id is set, so a website-only
 * deploy does not claim links for an app it has not shipped.
 */
const writeAppLinkFiles = () => {
  const appConfig = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8')).expo;
  const dir = new URL('../dist/.well-known/', import.meta.url);
  const teamId = process.env.APPLE_TEAM_ID?.trim();
  const fingerprints = fingerprintList(process.env.ANDROID_CERT_SHA256);
  if ((teamId === undefined || teamId === '') && fingerprints.length === 0) return;
  mkdirSync(dir, { recursive: true });
  if (teamId !== undefined && teamId !== '') {
    writeFileSync(
      new URL('apple-app-site-association', dir),
      JSON.stringify(appleAppSiteAssociation(teamId, appConfig.ios.bundleIdentifier)),
    );
  }
  if (fingerprints.length > 0) {
    writeFileSync(
      new URL('assetlinks.json', dir),
      JSON.stringify(assetLinks(appConfig.android.package, fingerprints)),
    );
  }
};

const child = spawn('npx', args, { stdio: 'inherit', shell: true, env: process.env });
child.on('exit', (code) => {
  if (code === 0 && mode === 'export') writeAppLinkFiles();
  process.exit(code ?? 1);
});
