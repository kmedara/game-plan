/**
 * Volunteer sign-ups: slots staff add to one occurrence, and who took them.
 *
 * All slots of an occurrence share one row (`SIGNUPS#<occ>#<eventId>`), like
 * carpools. Every write is conditional on the row's `version`, so two people
 * taking the last place at once cannot both get it; the loser sees
 * `condition_failed` and retries.
 */

import { randomBytes } from 'node:crypto';
import type { ClaimSignupBody, PutSignupsBody, SignupsResponse } from '@gameplan/schemas';
import { loadMemberNames } from '../../lib/chat-member-names.js';
import { TABLE_PK, TABLE_SK, deleteItem, getItem, putItem, queryBySkPrefix, signupsSk, teamPk } from '../../lib/dynamo/index.js';
import { enqueueFanout } from '../../lib/fanout-enqueue.js';
import { isGuardianOf } from '../../lib/guardians.js';
import { listTeamMemberIds } from '../../lib/team-roster.js';
import { requireOccurrence } from './schedule-store.js';

/** One person on a slot, as stored. */
type StoredClaim = { userId: string; claimedBy: string };

/** One slot, as stored. */
type StoredSlot = { slotId: string; label: string; capacity: number; claims: StoredClaim[] };

/** The occurrence's row. */
type SignupsItem = {
  teamId: string;
  eventId: string;
  occurrenceStartsAt: string;
  slots: StoredSlot[];
  version: number;
};

/** A short random slot id. */
const newSlotId = (): string => randomBytes(6).toString('base64url');

/**
 * Adds display names to the stored slots.
 *
 * @param item - The stored row, or `undefined` for none.
 * @param eventId - The event.
 * @param occurrenceIso - The occurrence.
 * @returns The wire response.
 */
const respond = async (
  item: Pick<SignupsItem, 'slots'> | undefined,
  eventId: string,
  occurrenceIso: string,
): Promise<SignupsResponse> => {
  const slots = item?.slots ?? [];
  const names = await loadMemberNames([...new Set(slots.flatMap((slot) => slot.claims.map((claim) => claim.userId)))]);
  return {
    eventId,
    occurrenceStartsAt: occurrenceIso,
    slots: slots.map((slot) => ({
      ...slot,
      claims: slot.claims.map((claim) => ({
        ...claim,
        ...(names[claim.userId] !== undefined ? { displayName: names[claim.userId] } : {}),
      })),
    })),
  };
};

/**
 * Writes the row only if nobody else did since it was read, then tells the team.
 *
 * @param teamId - The team.
 * @param previous - The row as read, or `undefined` when there was none.
 * @param next - The new row contents.
 */
const save = async (
  teamId: string,
  previous: SignupsItem | undefined,
  next: Omit<SignupsItem, 'version' | 'teamId'>,
): Promise<void> => {
  const key = { [TABLE_PK]: teamPk(teamId), [TABLE_SK]: signupsSk(next.occurrenceStartsAt, next.eventId) };
  if (next.slots.length === 0) {
    if (previous !== undefined) await deleteItem(key[TABLE_PK], key[TABLE_SK]);
  } else {
    await putItem(
      { ...key, teamId, ...next, version: (previous?.version ?? 0) + 1 },
      previous === undefined
        ? { conditionExpression: 'attribute_not_exists(PK)' }
        : {
            conditionExpression: '#version = :version',
            expressionAttributeNames: { '#version': 'version' },
            expressionAttributeValues: { ':version': previous.version },
          },
    );
  }
  await enqueueFanout({
    type: 'signups_changed',
    teamId,
    eventId: next.eventId,
    occurrenceStartsAt: next.occurrenceStartsAt,
  });
};

/**
 * Sign-ups for one occurrence. None yet is an empty list.
 *
 * @param input - Team, event, and occurrence.
 * @returns The slots and who took them.
 */
export const getSignups = async (input: {
  teamId: string;
  eventId: string;
  occurrenceStartsAt: string;
}): Promise<SignupsResponse> => {
  const occurrenceIso = await requireOccurrence(input.teamId, input.eventId, input.occurrenceStartsAt);
  const item = await getItem<SignupsItem>(teamPk(input.teamId), signupsSk(occurrenceIso, input.eventId));
  return respond(item, input.eventId, occurrenceIso);
};

/**
 * Replaces the slot list. Kept slots keep their people; a slot cannot shrink
 * below the people already on it.
 *
 * @param teamId - The team.
 * @param body - The occurrence and the full slot list.
 * @returns The saved sign-ups.
 */
export const putSignups = async (teamId: string, body: PutSignupsBody): Promise<SignupsResponse> => {
  const occurrenceIso = await requireOccurrence(teamId, body.eventId, body.occurrenceStartsAt);
  const previous = await getItem<SignupsItem>(teamPk(teamId), signupsSk(occurrenceIso, body.eventId));
  const existing = new Map((previous?.slots ?? []).map((slot) => [slot.slotId, slot]));
  const slots = body.slots.map((input): StoredSlot => {
    const kept = input.slotId === undefined ? undefined : existing.get(input.slotId);
    const claims = kept?.claims ?? [];
    if (claims.length > input.capacity) throw new Error('signup_capacity_below_claims');
    return { slotId: kept?.slotId ?? newSlotId(), label: input.label, capacity: input.capacity, claims };
  });
  await save(teamId, previous, { eventId: body.eventId, occurrenceStartsAt: occurrenceIso, slots });
  return respond({ slots }, body.eventId, occurrenceIso);
};

/**
 * Takes a place on a slot, or gives it up when already taken.
 *
 * Anyone acts for themselves; a guardian for their child on the team; staff
 * with `manage_events` for any member (to remove someone).
 *
 * @param input - Team, caller, whether the caller is staff, and the body.
 * @returns The saved sign-ups.
 */
export const toggleSignup = async (input: {
  teamId: string;
  callerId: string;
  callerIsStaff: boolean;
  body: ClaimSignupBody;
}): Promise<SignupsResponse> => {
  const { teamId, callerId, body } = input;
  const occurrenceIso = await requireOccurrence(teamId, body.eventId, body.occurrenceStartsAt);
  const forUserId = body.forUserId ?? callerId;
  if (forUserId !== callerId && !input.callerIsStaff && !(await isGuardianOf(callerId, forUserId))) {
    throw new Error('forbidden');
  }
  if (!(await listTeamMemberIds(teamId)).includes(forUserId)) throw new Error('signup_member_not_found');

  const previous = await getItem<SignupsItem>(teamPk(teamId), signupsSk(occurrenceIso, body.eventId));
  const slot = previous?.slots.find((candidate) => candidate.slotId === body.slotId);
  if (previous === undefined || slot === undefined) throw new Error('signup_slot_not_found');
  const leaving = slot.claims.some((claim) => claim.userId === forUserId);
  if (!leaving && slot.claims.length >= slot.capacity) throw new Error('signup_full');
  const slots = previous.slots.map((candidate) =>
    candidate.slotId !== slot.slotId
      ? candidate
      : {
          ...candidate,
          claims: leaving
            ? candidate.claims.filter((claim) => claim.userId !== forUserId)
            : [...candidate.claims, { userId: forUserId, claimedBy: callerId }],
        },
  );
  await save(teamId, previous, { eventId: body.eventId, occurrenceStartsAt: occurrenceIso, slots });
  return respond({ slots }, body.eventId, occurrenceIso);
};

/**
 * Everyone signed up for anything on one occurrence, and whoever signed them
 * up (a guardian is usually the one bringing the snacks), for reminders.
 *
 * @param teamId - The team.
 * @param eventId - The event.
 * @param occurrenceIso - The occurrence.
 * @returns Distinct user ids.
 */
export const signedUpUserIds = async (teamId: string, eventId: string, occurrenceIso: string): Promise<string[]> => {
  const rows = await queryBySkPrefix<SignupsItem>(teamPk(teamId), signupsSk(occurrenceIso, eventId));
  return [
    ...new Set(
      rows.flatMap((row) => row.slots.flatMap((slot) => slot.claims.flatMap((claim) => [claim.userId, claim.claimedBy]))),
    ),
  ];
};
