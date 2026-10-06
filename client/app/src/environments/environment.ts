/**
 * Default environment used by unit tests and as the fileReplacements target.
 *
 * Local serve / production builds overwrite the configuration-specific files
 * via `scripts/write-environment.mjs` from process environment variables.
 */

import type { Environment } from './environment.types';

export const environment: Environment = {
  apiBaseUrl: 'http://localhost:3000',
  wsBaseUrl: 'ws://localhost:3000/socket',
  authDisabled: true,
  googleMapsApiKey: '',
};
