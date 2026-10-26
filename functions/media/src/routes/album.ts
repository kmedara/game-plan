/**
 * Team album routes: list, sign an upload, add, and remove.
 *
 * Every member can see, add to, and remove from the album. The team's plan
 * decides storage and whether video is allowed.
 */

import { addAlbumItemBodySchema, albumListQuerySchema, albumUploadBodySchema } from '@gameplan/schemas';
import { loadTeamEntitlements } from '../../../lib/entitlements.js';
import { requireMembership, requireUser } from '../../../lib/guards.js';
import { json } from '../../../lib/http.js';
import { route, withBodyValidation, withQueryValidation } from '../../../lib/pipeline.js';
import { addAlbumItem, assertAlbumUploadAllowed, listAlbum, removeAlbumItem } from '../album-store.js';
import { signUpload } from '../media-store.js';
import { withMediaErrors } from './errors.js';

/** `GET /media/teams/:teamId/album` */
export const handleListAlbum = route(
  'GET',
  '/media/teams/:teamId/album',
  withMediaErrors(),
  requireUser(),
  withQueryValidation(albumListQuerySchema),
  requireMembership(),
  async ({ teamId, query }) => json(200, await listAlbum(teamId, query.cursor)),
);

/**
 * `POST /media/teams/:teamId/album/uploads`
 *
 * Checks the plan before signing, so nobody uploads a clip the album will refuse.
 */
export const handleAlbumUpload = route(
  'POST',
  '/media/teams/:teamId/album/uploads',
  withMediaErrors(),
  requireUser(),
  withBodyValidation(albumUploadBodySchema),
  requireMembership(),
  async ({ teamId, user, body }) => {
    await assertAlbumUploadAllowed(teamId, await loadTeamEntitlements(teamId), {
      contentType: body.contentType,
      bytes: body.contentLength,
      ...(body.durationSeconds !== undefined ? { durationSeconds: body.durationSeconds } : {}),
    });
    return json(200, await signUpload(user.userId, body));
  },
);

/** `POST /media/teams/:teamId/album` */
export const handleAddAlbumItem = route(
  'POST',
  '/media/teams/:teamId/album',
  withMediaErrors(),
  requireUser(),
  withBodyValidation(addAlbumItemBodySchema),
  requireMembership(),
  async ({ teamId, user, body }) =>
    json(
      201,
      await addAlbumItem({ teamId, userId: user.userId, limits: await loadTeamEntitlements(teamId), body }),
    ),
);

/** `DELETE /media/teams/:teamId/album/:itemId` */
export const handleRemoveAlbumItem = route(
  'DELETE',
  '/media/teams/:teamId/album/:itemId',
  withMediaErrors(),
  requireUser(),
  requireMembership(),
  async ({ teamId, itemId }) => {
    await removeAlbumItem(teamId, itemId);
    return { statusCode: 204 };
  },
);
