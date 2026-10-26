/**
 * Storage for team Stripe accounts, charges, and member dues.
 *
 * A charge lives at `TEAM#<teamId>` / `CHARGE#<chargeId>`. Each member's share
 * lives beside it at `DUE#<chargeId>#<memberId>`, with a pointer on the member's
 * own partition so "my dues" is one query. Due status changes are conditional
 * on `version`, so a webhook retry or a race with staff cannot clobber a newer
 * write.
 */

import { randomUUID } from 'node:crypto';
import type { CreateChargeBody } from '@gameplan/schemas';
import type {
  Charge,
  ChargeCurrency,
  ChargeTotals,
  Due,
  DueStatus,
  MyDue,
  PaymentAccount,
} from '@gameplan/types';
import { loadMemberNames } from '../../lib/chat-member-names.js';
import { addDays, reminderSchedule } from '../../lib/due-reminders.js';
import {
  CHARGE_SK_PREFIX,
  TABLE_PK,
  TABLE_SK,
  TEAM_MEMBER_SK_PREFIX,
  USER_DUE_SK_PREFIX,
  chargeSk,
  dueSk,
  dueSkPrefix,
  getItem,
  paymentReminderSk,
  PAYMENT_REMINDERS_PK,
  putItem,
  queryBySkPrefix,
  stripeAccountPk,
  stripeAccountSk,
  teamMetaSk,
  teamPk,
  teamStripeSk,
  transactWrite,
  userDueSk,
  userPk,
} from '../../lib/dynamo/index.js';
import { TABLE_NAME } from '../../lib/names.js';
import type { AccountState } from './stripe.js';

/** `TEAM#<teamId>` / `STRIPE`. */
export type StripeAccountItem = AccountState & {
  teamId: string;
  accountId: string;
  updatedAt: string;
};

/** `TEAM#<teamId>` / `CHARGE#<chargeId>`. */
export type ChargeItem = {
  teamId: string;
  chargeId: string;
  title: string;
  description?: string;
  amountCents: number;
  currency: ChargeCurrency;
  dueDate: string;
  createdBy: string;
  createdAt: string;
};

/** `TEAM#<teamId>` / `DUE#<chargeId>#<memberId>`. */
export type DueItem = {
  teamId: string;
  chargeId: string;
  memberId: string;
  status: DueStatus;
  amountCents: number;
  paidBy?: string;
  paidAt?: string;
  checkoutSessionId?: string;
  paymentIntentId?: string;
  updatedAt: string;
  /** Bumped on every write; the next write is conditional on it. */
  version: number;
};

/** Statuses that need no more money. */
const SETTLED: ReadonlySet<DueStatus> = new Set(['paid', 'paid_offline', 'waived']);

/** Most items DynamoDB accepts in one transaction. */
const TRANSACT_LIMIT = 100;

/**
 * Wraps an item as a transaction `Put` on the product table.
 *
 * @param item - The full item, including `PK` and `SK`.
 * @returns The transaction entry.
 */
const put = (item: Record<string, unknown>) => ({ Put: { TableName: TABLE_NAME, Item: item } });

/**
 * Whether a due still needs paying.
 *
 * @param status - The due status.
 * @returns `true` for unpaid, pending, and refunded.
 */
export const isOutstanding = (status: DueStatus): boolean => !SETTLED.has(status);

/** Strips table keys and bookkeeping from a stored due. */
const dueResponse = (item: DueItem, memberName?: string): Due => ({
  teamId: item.teamId,
  chargeId: item.chargeId,
  memberId: item.memberId,
  ...(memberName !== undefined ? { memberName } : {}),
  status: item.status,
  amountCents: item.amountCents,
  ...(item.paidBy !== undefined ? { paidBy: item.paidBy } : {}),
  ...(item.paidAt !== undefined ? { paidAt: item.paidAt } : {}),
  updatedAt: item.updatedAt,
});

/**
 * Adds up a charge's dues.
 *
 * @param dues - Every due on one charge.
 * @returns Member, settled, and outstanding counts, and what Stripe collected.
 */
export const totalsOf = (dues: readonly DueItem[]): ChargeTotals => ({
  members: dues.length,
  settled: dues.filter((due) => !isOutstanding(due.status)).length,
  outstanding: dues.filter((due) => isOutstanding(due.status)).length,
  collectedCents: dues
    .filter((due) => due.status === 'paid')
    .reduce((sum, due) => sum + due.amountCents, 0),
});

/** Strips table keys from a stored charge and attaches its totals. */
const chargeResponse = (item: ChargeItem, dues: readonly DueItem[]): Charge => ({
  teamId: item.teamId,
  chargeId: item.chargeId,
  title: item.title,
  ...(item.description !== undefined ? { description: item.description } : {}),
  amountCents: item.amountCents,
  currency: item.currency,
  dueDate: item.dueDate,
  createdBy: item.createdBy,
  createdAt: item.createdAt,
  totals: totalsOf(dues),
});

/**
 * Loads a team's connected Stripe account row.
 *
 * @param teamId - The team.
 * @returns The row, or `undefined` before onboarding starts.
 */
export const getStripeAccount = async (teamId: string): Promise<StripeAccountItem | undefined> =>
  getItem<StripeAccountItem>(teamPk(teamId), teamStripeSk());

/**
 * Finds the team a connected account belongs to.
 *
 * @param accountId - The Stripe account id.
 * @returns The team id, or `undefined` for an unknown account.
 */
export const teamIdForAccount = async (accountId: string): Promise<string | undefined> =>
  (await getItem<{ teamId?: string }>(stripeAccountPk(accountId), stripeAccountSk()))?.teamId;

/**
 * Stores a team's connected account and its current flags.
 *
 * @param teamId - The team.
 * @param accountId - The Stripe account id.
 * @param state - Flags from Stripe.
 * @returns The stored row.
 */
export const saveStripeAccount = async (
  teamId: string,
  accountId: string,
  state: AccountState,
): Promise<StripeAccountItem> => {
  const item: StripeAccountItem = {
    teamId,
    accountId,
    ...state,
    updatedAt: new Date().toISOString(),
  };
  await transactWrite([
    put({ [TABLE_PK]: teamPk(teamId), [TABLE_SK]: teamStripeSk(), ...item }),
    put({ [TABLE_PK]: stripeAccountPk(accountId), [TABLE_SK]: stripeAccountSk(), accountId, teamId }),
  ]);
  return item;
};

/**
 * Account status for the API.
 *
 * @param teamId - The team.
 * @param item - The stored account, if any.
 * @returns Connected and readiness flags.
 */
export const accountResponse = (teamId: string, item: StripeAccountItem | undefined): PaymentAccount => ({
  teamId,
  connected: item !== undefined,
  chargesEnabled: item?.chargesEnabled ?? false,
  payoutsEnabled: item?.payoutsEnabled ?? false,
  detailsSubmitted: item?.detailsSubmitted ?? false,
});

/** When to remind payers about a charge; waivers use the same schedule. */
export { addDays, reminderSchedule };

/**
 * Creates a charge and one due per member.
 *
 * Dues are written first, in transactions of up to 100 items. The charge row
 * and its reminders go last, so a charge is only listed once every due exists.
 *
 * @param input - The team, the creator, and the validated body.
 * @returns The new charge with its totals.
 * @throws `member_not_on_team` when a member id is not on the roster.
 */
export const createCharge = async (input: {
  teamId: string;
  createdBy: string;
  body: CreateChargeBody;
  now?: Date;
}): Promise<Charge> => {
  const roster = await queryBySkPrefix<{ userId?: string }>(teamPk(input.teamId), TEAM_MEMBER_SK_PREFIX);
  const onTeam = new Set(roster.flatMap((row) => (typeof row.userId === 'string' ? [row.userId] : [])));
  if (input.body.memberIds.some((memberId) => !onTeam.has(memberId))) {
    throw new Error('member_not_on_team');
  }

  const now = input.now ?? new Date();
  const createdAt = now.toISOString();
  const chargeId = randomUUID();
  const charge: ChargeItem = {
    teamId: input.teamId,
    chargeId,
    title: input.body.title,
    ...(input.body.description !== undefined && input.body.description.length > 0
      ? { description: input.body.description }
      : {}),
    amountCents: input.body.amountCents,
    currency: input.body.currency ?? 'usd',
    dueDate: input.body.dueDate,
    createdBy: input.createdBy,
    createdAt,
  };
  const dues: DueItem[] = input.body.memberIds.map((memberId) => ({
    teamId: input.teamId,
    chargeId,
    memberId,
    status: 'unpaid',
    amountCents: charge.amountCents,
    updatedAt: createdAt,
    version: 1,
  }));

  const dueWrites = dues.flatMap((due) => [
    put({ [TABLE_PK]: teamPk(due.teamId), [TABLE_SK]: dueSk(chargeId, due.memberId), ...due }),
    put({
      [TABLE_PK]: userPk(due.memberId),
      [TABLE_SK]: userDueSk(due.teamId, chargeId),
      teamId: due.teamId,
      chargeId,
      memberId: due.memberId,
    }),
  ]);
  for (let start = 0; start < dueWrites.length; start += TRANSACT_LIMIT) {
    await transactWrite(dueWrites.slice(start, start + TRANSACT_LIMIT));
  }

  const reminders = reminderSchedule(charge.dueDate, createdAt.slice(0, 10)).map((reminder) =>
    put({
      [TABLE_PK]: PAYMENT_REMINDERS_PK,
      [TABLE_SK]: paymentReminderSk(reminder.sendOn, charge.teamId, chargeId, reminder.kind),
      teamId: charge.teamId,
      chargeId,
      kind: reminder.kind,
      sendOn: reminder.sendOn,
    }),
  );
  await transactWrite([
    put({ [TABLE_PK]: teamPk(charge.teamId), [TABLE_SK]: chargeSk(chargeId), ...charge }),
    ...reminders,
  ]);

  return chargeResponse(charge, dues);
};

/**
 * Loads one charge.
 *
 * @param teamId - The team.
 * @param chargeId - The charge.
 * @returns The stored charge, or `undefined`.
 */
export const getCharge = async (teamId: string, chargeId: string): Promise<ChargeItem | undefined> =>
  getItem<ChargeItem>(teamPk(teamId), chargeSk(chargeId));

/**
 * Loads every due on one charge.
 *
 * @param teamId - The team.
 * @param chargeId - The charge.
 * @returns Dues in member-id order.
 */
export const listChargeDues = async (teamId: string, chargeId: string): Promise<DueItem[]> =>
  queryBySkPrefix<DueItem>(teamPk(teamId), dueSkPrefix(chargeId));

/**
 * Lists a team's charges with totals, newest due date first.
 *
 * @param teamId - The team.
 * @returns Every charge on the team.
 */
export const listCharges = async (teamId: string): Promise<Charge[]> => {
  const [charges, dues] = await Promise.all([
    queryBySkPrefix<ChargeItem>(teamPk(teamId), CHARGE_SK_PREFIX),
    queryBySkPrefix<DueItem>(teamPk(teamId), 'DUE#'),
  ]);
  const byCharge = new Map<string, DueItem[]>();
  for (const due of dues) byCharge.set(due.chargeId, [...(byCharge.get(due.chargeId) ?? []), due]);
  return charges
    .map((charge) => chargeResponse(charge, byCharge.get(charge.chargeId) ?? []))
    .sort((left, right) =>
      left.dueDate === right.dueDate
        ? right.createdAt.localeCompare(left.createdAt)
        : right.dueDate.localeCompare(left.dueDate),
    );
};

/**
 * One charge and every member's due, with member names.
 *
 * @param teamId - The team.
 * @param chargeId - The charge.
 * @returns The charge and its dues, sorted by member name.
 * @throws `charge_not_found` when the charge does not exist.
 */
export const chargeDetail = async (
  teamId: string,
  chargeId: string,
): Promise<{ charge: Charge; dues: Due[] }> => {
  const charge = await getCharge(teamId, chargeId);
  if (charge === undefined) throw new Error('charge_not_found');
  const dues = await listChargeDues(teamId, chargeId);
  const names = await loadMemberNames(dues.map((due) => due.memberId));
  return {
    charge: chargeResponse(charge, dues),
    dues: dues
      .map((due) => dueResponse(due, names[due.memberId]))
      .sort((left, right) => (left.memberName ?? '').localeCompare(right.memberName ?? '')),
  };
};

/**
 * Loads one due.
 *
 * @param teamId - The team.
 * @param chargeId - The charge.
 * @param memberId - The member the due belongs to.
 * @returns The due, or `undefined`.
 */
export const getDue = async (
  teamId: string,
  chargeId: string,
  memberId: string,
): Promise<DueItem | undefined> => getItem<DueItem>(teamPk(teamId), dueSk(chargeId, memberId));

/**
 * Writes a new version of a due, only if nobody else wrote it first.
 *
 * @param previous - The due as it was read.
 * @param changes - Fields to change. `undefined` removes a field.
 * @returns The stored due.
 * @throws `ConditionalCheckFailedException` when the due changed since the read.
 */
export const updateDue = async (
  previous: DueItem,
  changes: Partial<Omit<DueItem, 'teamId' | 'chargeId' | 'memberId' | 'version' | 'updatedAt'>>,
): Promise<DueItem> => {
  const next = Object.fromEntries(
    Object.entries({
      ...previous,
      ...changes,
      updatedAt: new Date().toISOString(),
      version: previous.version + 1,
    }).filter(([, value]) => value !== undefined),
  ) as DueItem;
  await putItem(
    { [TABLE_PK]: teamPk(next.teamId), [TABLE_SK]: dueSk(next.chargeId, next.memberId), ...next },
    {
      conditionExpression: '#version = :version',
      expressionAttributeNames: { '#version': 'version' },
      expressionAttributeValues: { ':version': previous.version },
    },
  );
  return next;
};

/**
 * Staff mark a due paid outside the app, waived, or back to unpaid.
 *
 * A due paid through Stripe is refunded in Stripe, not reset here.
 *
 * @param input - The due and the new status.
 * @returns The stored due with the member's name.
 * @throws `due_not_found`, or `paid_in_app` for a Stripe payment.
 */
export const setDueStatusByStaff = async (input: {
  teamId: string;
  chargeId: string;
  memberId: string;
  status: 'unpaid' | 'paid_offline' | 'waived';
  staffId: string;
}): Promise<Due> => {
  const due = await getDue(input.teamId, input.chargeId, input.memberId);
  if (due === undefined) throw new Error('due_not_found');
  if (due.status === 'paid') throw new Error('paid_in_app');
  const settled = input.status !== 'unpaid';
  const next = await updateDue(due, {
    status: input.status,
    paidBy: settled ? input.staffId : undefined,
    paidAt: settled ? new Date().toISOString() : undefined,
    checkoutSessionId: undefined,
  });
  const names = await loadMemberNames([next.memberId]);
  return dueResponse(next, names[next.memberId]);
};

/** Pointer row at `USER#<memberId>` / `DUE#<teamId>#<chargeId>`. */
type UserDuePointer = { teamId?: string; chargeId?: string; memberId?: string };

/**
 * Every due owed by the given members, joined with its charge and team name.
 *
 * @param memberIds - The caller and any children they pay for.
 * @param payableMemberIds - Members whose dues the caller may pay.
 * @returns Dues, outstanding first, then by due date.
 */
export const listDuesForMembers = async (
  memberIds: readonly string[],
  payableMemberIds: ReadonlySet<string>,
): Promise<MyDue[]> => {
  const pointers = (
    await Promise.all(memberIds.map((memberId) => queryBySkPrefix<UserDuePointer>(userPk(memberId), USER_DUE_SK_PREFIX)))
  ).flat();
  const names = await loadMemberNames([...new Set(memberIds)]);
  const teamNames = new Map<string, string | undefined>();

  const rows = await Promise.all(
    pointers.map(async (pointer): Promise<MyDue | undefined> => {
      const { teamId, chargeId, memberId } = pointer;
      if (teamId === undefined || chargeId === undefined || memberId === undefined) return undefined;
      const [charge, due] = await Promise.all([getCharge(teamId, chargeId), getDue(teamId, chargeId, memberId)]);
      if (charge === undefined || due === undefined) return undefined;
      if (!teamNames.has(teamId)) {
        teamNames.set(teamId, (await getItem<{ name?: string }>(teamPk(teamId), teamMetaSk()))?.name);
      }
      const teamName = teamNames.get(teamId);
      const memberName = names[memberId];
      return {
        teamId,
        ...(teamName !== undefined ? { teamName } : {}),
        chargeId,
        memberId,
        ...(memberName !== undefined ? { memberName } : {}),
        title: charge.title,
        ...(charge.description !== undefined ? { description: charge.description } : {}),
        amountCents: due.amountCents,
        currency: charge.currency,
        dueDate: charge.dueDate,
        status: due.status,
        ...(due.paidAt !== undefined ? { paidAt: due.paidAt } : {}),
        canPay: payableMemberIds.has(memberId) && isOutstanding(due.status),
      };
    }),
  );

  return rows
    .filter((row): row is MyDue => row !== undefined)
    .sort((left, right) => {
      const outstanding = Number(isOutstanding(right.status)) - Number(isOutstanding(left.status));
      return outstanding !== 0 ? outstanding : left.dueDate.localeCompare(right.dueDate);
    });
};
