/**
 * Writes the active Angular environment file from process environment variables.
 *
 * Used by `prestart` / `prebuild`. Production builds require `API_BASE_URL`.
 *
 * Env vars:
 * - `BUILD_CONFIGURATION` — `development` (default) or `production`
 * - `API_BASE_URL` — HTTP API origin (required for production)
 * - `WS_BASE_URL` — WebSocket origin (defaults from `API_BASE_URL` + `/socket`)
 * - `AUTH_DISABLED` — `true` enables the seed-user bypass (dev only; prod forces false)
 * - `GOOGLE_MAPS_BROWSER_API_KEY` — Maps JavaScript API key for the web map picker
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const environmentsDir = path.join(__dirname, '../src/environments');

const configuration = process.env.BUILD_CONFIGURATION ?? 'development';
const isProduction = configuration === 'production';

const target = path.join(
  environmentsDir,
  isProduction ? 'environment.production.ts' : 'environment.development.ts',
);

if (isProduction && !process.env.API_BASE_URL) {
  throw new Error('API_BASE_URL must be set for a production environment build');
}

const apiBaseUrl = (process.env.API_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');

const defaultWsBaseUrl = (() => {
  if (apiBaseUrl.startsWith('https://')) return `wss://${apiBaseUrl.slice('https://'.length)}/socket`;
  if (apiBaseUrl.startsWith('http://')) return `ws://${apiBaseUrl.slice('http://'.length)}/socket`;
  return 'ws://localhost:3000/socket';
})();

const environment = {
  apiBaseUrl,
  wsBaseUrl: (process.env.WS_BASE_URL ?? defaultWsBaseUrl).replace(/\/$/, ''),
  authDisabled: isProduction
    ? false
    : (process.env.AUTH_DISABLED ?? 'true') === 'true',
  googleMapsApiKey: (process.env.GOOGLE_MAPS_BROWSER_API_KEY ?? '').trim(),
};

const contents = `import type { Environment } from './environment.types';

export const environment: Environment = ${JSON.stringify(environment, null, 2)};
`;

fs.writeFileSync(target, contents);
console.log(
  `Wrote ${target} (configuration=${configuration}, authDisabled=${environment.authDisabled}, mapsBrowserKey=${environment.googleMapsApiKey.length > 0})`,
);
