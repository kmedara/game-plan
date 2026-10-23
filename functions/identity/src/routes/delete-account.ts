/**
 * `DELETE /identity/me`
 */

import { clearRefreshSetCookie } from '../../../lib/auth/index.js';
import { requireUser } from '../../../lib/guards.js';
import { json, withCookies } from '../../../lib/http.js';
import { route } from '../../../lib/pipeline.js';
import { deleteAccount, deletionBlockers, isBlocked } from '../delete-account.js';
import { withIdentityErrors } from './session.js';

/**
 * Handles `DELETE /identity/me`.
 *
 * Answers `409 account_deletion_blocked` with the organizations and teams to
 * hand over first. Otherwise deletes the account and clears the refresh cookie.
 *
 * @returns An empty `204`, or the blockers.
 */
export const handleDeleteAccount = route(
  'DELETE',
  '/identity/me',
  withIdentityErrors(),
  requireUser(),
  async ({ user }) => {
    const blockers = await deletionBlockers(user.userId);
    if (isBlocked(blockers)) return json(409, { error: 'account_deletion_blocked', ...blockers });
    await deleteAccount(user.userId);
    return withCookies({ statusCode: 204 }, clearRefreshSetCookie());
  },
);
