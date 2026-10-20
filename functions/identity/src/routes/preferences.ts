/**
 * `GET` and `PATCH /identity/me/preferences` — the caller's own settings.
 */

import { updatePreferencesBodySchema } from '@gameplan/schemas';
import { requireUser } from '../../../lib/auth/index.js';
import { json } from '../../../lib/http.js';
import { route, withBodyValidation } from '../../../lib/pipeline.js';
import { loadPreferences, savePreferences } from '../../../lib/preferences.js';
import { withIdentityErrors } from './session.js';

/** `GET /identity/me/preferences` */
export const handleGetPreferences = route(
  'GET',
  '/identity/me/preferences',
  withIdentityErrors(),
  requireUser(),
  async ({ user }) => json(200, await loadPreferences(user.userId)),
);

/** `PATCH /identity/me/preferences` */
export const handleUpdatePreferences = route(
  'PATCH',
  '/identity/me/preferences',
  withIdentityErrors(),
  requireUser(),
  withBodyValidation(updatePreferencesBodySchema),
  async ({ user, body }) => json(200, await savePreferences(user.userId, body)),
);
