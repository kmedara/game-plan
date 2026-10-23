/**
 * Keeps an invite code across login and profile completion, then joins the team.
 *
 * The invite page lives in the signed-in shell. A visitor without an account is
 * sent to login, and a new account then has to finish a profile, so the code
 * has to outlive both of those pages.
 */

import { Platform } from 'react-native';
import { errorCode } from './errors';
import { queryKeys } from './queries/keys';
import { readPreference, writePreference } from './refresh-store';

const PENDING_INVITE_KEY = 'pending-invite-code';

type InviteApi = {
  getInvite: (code: string) => Promise<{ teamId: string }>;
  acceptInvite: (code: string) => Promise<{ teamId: string }>;
};

type TeamListCache = {
  invalidateQueries: (filters: { queryKey: readonly unknown[] }) => Promise<void> | void;
};

/** Result of trying to join from the stored invite code. */
export type PendingInviteResult =
  | { status: 'none' }
  | { status: 'joined'; teamId: string }
  | { status: 'failed'; code: string };

const nativeStore = (): boolean => Platform.OS !== 'web';

/**
 * Reads the invite code from an invite-page path.
 *
 * @param pathname - The current path, such as `/invite/abc`.
 * @returns The decoded code, or `undefined` when the path is not an invite page.
 */
export const inviteCodeFromPath = (pathname: string): string | undefined => {
  const match = /^\/invite\/([^/]+)\/?$/u.exec(pathname);
  const raw = match?.[1];
  if (raw === undefined) return undefined;
  try {
    const code = decodeURIComponent(raw).trim();
    return code.length > 0 ? code : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Code from an invite link that should survive the redirect to login or profile completion.
 *
 * A signed-in member whose profile is already finished stays on the invite page.
 *
 * @param pathname - The current path.
 * @param authenticated - Whether a session is present.
 * @param needsProfileCompletion - Whether birthday and display name are still required.
 * @returns The code to store, or `undefined` when this visit should stay on the invite page.
 */
export const inviteCodeToRemember = (
  pathname: string,
  authenticated: boolean,
  needsProfileCompletion: boolean,
): string | undefined => {
  if (authenticated && !needsProfileCompletion) return undefined;
  return inviteCodeFromPath(pathname);
};

/** Reads the invite code saved before login. */
export const readPendingInvite = (): Promise<string | undefined> =>
  readPreference(PENDING_INVITE_KEY, nativeStore());

/**
 * Stores an invite code until the account can join.
 *
 * @param code - The code from the invite link.
 */
export const savePendingInvite = (code: string): Promise<void> =>
  writePreference(PENDING_INVITE_KEY, code, nativeStore());

/** Forgets a stored invite code. */
export const clearPendingInvite = (): Promise<void> =>
  writePreference(PENDING_INVITE_KEY, undefined, nativeStore());

let accepting: Promise<PendingInviteResult> | undefined;

/**
 * Joins the team for a stored invite code.
 *
 * A second call while the first is running shares that attempt, so a re-render
 * cannot accept twice. The code is removed whether the join succeeds or the
 * invite can no longer be used.
 *
 * @param api - Invite lookup and accept calls.
 * @param queryClient - Cache whose team list should reload after a join.
 * @returns Whether a stored code was joined or rejected.
 */
export const consumePendingInvite = (
  api: InviteApi,
  queryClient: TeamListCache,
): Promise<PendingInviteResult> => {
  accepting ??= acceptStoredInvite(api, queryClient).finally(() => {
    accepting = undefined;
  });
  return accepting;
};

const acceptStoredInvite = async (
  api: InviteApi,
  queryClient: TeamListCache,
): Promise<PendingInviteResult> => {
  const code = await readPendingInvite();
  if (code === undefined) return { status: 'none' };

  try {
    const membership = await api.acceptInvite(code);
    await finishJoin(queryClient);
    return { status: 'joined', teamId: membership.teamId };
  } catch (err) {
    if (errorCode(err) !== 'already_a_member') {
      await clearPendingInvite();
      return { status: 'failed', code };
    }
  }

  try {
    const preview = await api.getInvite(code);
    await finishJoin(queryClient);
    return { status: 'joined', teamId: preview.teamId };
  } catch {
    await clearPendingInvite();
    return { status: 'failed', code };
  }
};

const finishJoin = async (queryClient: TeamListCache): Promise<void> => {
  await clearPendingInvite();
  await queryClient.invalidateQueries({ queryKey: queryKeys.teams });
};
