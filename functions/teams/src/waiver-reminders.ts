/**
 * Daily waiver reminders: three days before the due date, on it, then weekly.
 *
 * Giving a waiver a due date writes one dated row per reminder under
 * `WAIVER_REMINDERS`. The sweep sends every row dated today or earlier to the
 * people who can still sign, then deletes it. A row for a date the waiver no
 * longer has, or for an archived waiver, is dropped without sending.
 */

import {
  WAIVER_REMINDER_SK_PREFIX,
  WAIVER_REMINDERS_PK,
  deleteItem,
  queryBySkBetween,
  type PaymentReminderKind,
} from '../../lib/dynamo/index.js';
import { enqueueFanout } from '../../lib/fanout-enqueue.js';
import { findWaiver, outstandingSignerIds } from './waiver-store.js';

/** Stored reminder under `WAIVER_REMINDERS` / `WAIVREMIND#…`. */
type WaiverReminderItem = {
  PK: string;
  SK: string;
  teamId: string;
  waiverId: string;
  dueDate: string;
  kind: PaymentReminderKind;
  sendOn: string;
};

/**
 * Sends one reminder row, unless the waiver changed since it was written.
 *
 * @param row - The stored reminder.
 */
const sendReminder = async (row: WaiverReminderItem): Promise<void> => {
  const waiver = await findWaiver(row.teamId, row.waiverId);
  if (waiver === undefined || waiver.archived || waiver.dueDate !== row.dueDate) return;
  const [first, ...rest] = await outstandingSignerIds(waiver);
  if (first === undefined) return;
  await enqueueFanout({
    type: 'waiver_reminder',
    teamId: waiver.teamId,
    waiverId: waiver.waiverId,
    title: waiver.title.slice(0, 200),
    dueDate: row.dueDate,
    kind: row.kind,
    userIds: [first, ...rest],
  });
};

/**
 * Sends every waiver reminder dated on or before today (UTC).
 *
 * A row that fails stays for the next sweep; the rest still go out.
 *
 * @param now - The sweep clock.
 * @returns How many reminders were sent or dropped.
 */
export const runDueWaiverReminders = async (now: Date): Promise<number> => {
  const today = now.toISOString().slice(0, 10);
  const rows = await queryBySkBetween<WaiverReminderItem>(
    WAIVER_REMINDERS_PK,
    WAIVER_REMINDER_SK_PREFIX,
    `${WAIVER_REMINDER_SK_PREFIX}${today}#￿`,
  );
  let handled = 0;
  for (const row of rows) {
    try {
      await sendReminder(row);
      await deleteItem(row.PK, row.SK);
      handled += 1;
    } catch (error) {
      console.error(
        JSON.stringify({
          service: 'teams',
          event: 'waiver_reminder_failed',
          teamId: row.teamId,
          waiverId: row.waiverId,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
  return handled;
};
