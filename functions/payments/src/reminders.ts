/**
 * Daily dues reminders: three days before, on the due date, then weekly.
 *
 * Creating a charge writes one dated row per reminder under
 * `PAYMENT_REMINDERS`. The sweep sends every row dated today or earlier to the
 * people who can still pay, then deletes it. Settled dues are skipped, so a
 * fully paid charge sends nothing.
 */

import { payerIdsForDue } from '@gameplan/rules';
import { getProfile } from '../../lib/auth/index.js';
import {
  PAYMENT_REMINDER_SK_PREFIX,
  PAYMENT_REMINDERS_PK,
  deleteItem,
  queryBySkBetween,
  type PaymentReminderKind,
} from '../../lib/dynamo/index.js';
import { enqueueFanout } from '../../lib/fanout-enqueue.js';
import { listGuardianIds } from '../../lib/guardians.js';
import { getCharge, isOutstanding, listChargeDues } from './payments-store.js';

/** Stored reminder under `PAYMENT_REMINDERS` / `PAYREMIND#…`. */
type PaymentReminderItem = {
  PK: string;
  SK: string;
  teamId: string;
  chargeId: string;
  kind: PaymentReminderKind;
  sendOn: string;
};

/**
 * Everyone who can pay at least one outstanding due on a charge.
 *
 * @param teamId - The team.
 * @param chargeId - The charge.
 * @returns Distinct payer user ids.
 */
export const outstandingPayerIds = async (teamId: string, chargeId: string): Promise<string[]> => {
  const dues = (await listChargeDues(teamId, chargeId)).filter((due) => isOutstanding(due.status));
  const payers = new Set<string>();
  for (const due of dues) {
    const member = await getProfile(due.memberId);
    if (member === undefined) continue;
    const guardianIds = member.accountKind === 'minor' ? await listGuardianIds(due.memberId) : [];
    for (const payerId of payerIdsForDue({ userId: due.memberId, accountKind: member.accountKind, guardianIds })) {
      payers.add(payerId);
    }
  }
  return [...payers];
};

/**
 * Sends one reminder row.
 *
 * @param row - The stored reminder.
 */
const sendReminder = async (row: PaymentReminderItem): Promise<void> => {
  const charge = await getCharge(row.teamId, row.chargeId);
  if (charge === undefined) return;
  const [first, ...rest] = await outstandingPayerIds(row.teamId, row.chargeId);
  if (first === undefined) return;
  await enqueueFanout({
    type: 'dues_reminder',
    teamId: charge.teamId,
    chargeId: charge.chargeId,
    title: charge.title.slice(0, 200),
    amountCents: charge.amountCents,
    currency: charge.currency,
    dueDate: charge.dueDate,
    kind: row.kind,
    userIds: [first, ...rest],
  });
};

/**
 * Sends every reminder dated on or before today (UTC).
 *
 * A row that fails stays for the next sweep; the rest still go out.
 *
 * @param now - The sweep clock.
 * @returns How many reminders were sent or dropped.
 */
export const runDuePaymentReminders = async (now: Date): Promise<number> => {
  const today = now.toISOString().slice(0, 10);
  const rows = await queryBySkBetween<PaymentReminderItem>(
    PAYMENT_REMINDERS_PK,
    PAYMENT_REMINDER_SK_PREFIX,
    `${PAYMENT_REMINDER_SK_PREFIX}${today}#￿`,
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
          service: 'payments',
          event: 'dues_reminder_failed',
          teamId: row.teamId,
          chargeId: row.chargeId,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
  return handled;
};
