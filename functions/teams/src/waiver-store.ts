/**
 * Team waivers: the text, who must sign, and the signatures.
 *
 * Rows on `TEAM#<teamId>`:
 * - `WAIVER#<waiverId>` — the waiver at its current version: title, body,
 *   audience, due date, archive flag.
 * - `WAIVERTEXT#<waiverId>#<version>` — the title and body of each version,
 *   with their hash. Written once and never changed, so a signature can always
 *   show exactly what it covered.
 * - `WAIVERSIG#<waiverId>#<memberId>#<version>` — one signature. Signing a new
 *   version adds a row; earlier ones stay on record.
 *
 * Who must sign is worked out from the roster each time: everyone holding a
 * role in the waiver's audience. A member who joins later is asked without
 * anyone resending it. Who may sign follows the dues rules (`canSignWaiver`).
 */

import { createHash, randomUUID } from 'node:crypto';
import {
  canSignWaiver,
  mustSignWaiver,
  rolesFromMembership,
  waiverMemberStatus,
  waiverSignerIds,
} from '@gameplan/rules';
import {
  MAX_TEAM_WAIVERS,
  type CreateWaiverBody,
  type MyWaiver,
  type UpdateWaiverBody,
  type Waiver,
  type WaiverDetail,
  type WaiverMember,
  type WaiverSignature,
  type WaiverSignatureMethod,
  type WaiverSignerRelationship,
  type WaiverTemplate,
  type WaiverTemplateList,
  type WaiverTotals,
} from '@gameplan/schemas';
import type { TeamRole } from '@gameplan/types';
import { getProfile } from '../../lib/auth/index.js';
import {
  ORG_WAIVER_TEMPLATE_SK_PREFIX,
  TABLE_PK,
  TABLE_SK,
  TEAM_MEMBER_SK_PREFIX,
  USER_TEAM_SK_PREFIX,
  WAIVER_SIGNATURE_SK_PREFIX,
  WAIVER_REMINDERS_PK,
  WAIVER_SK_PREFIX,
  deleteItem,
  getItem,
  orgPk,
  orgWaiverTemplateSk,
  putItem,
  queryBySkPrefix,
  teamMemberSk,
  teamMetaSk,
  teamPk,
  transactWrite,
  userPk,
  waiverReminderSk,
  waiverSignatureSk,
  waiverSignatureSkPrefix,
  waiverSk,
  waiverTextSk,
} from '../../lib/dynamo/index.js';
import { reminderSchedule } from '../../lib/due-reminders.js';
import { listChildIds, listGuardianIds } from '../../lib/guardians.js';
import { TABLE_NAME } from '../../lib/names.js';
import { orgIdOfTeam } from '../../lib/orgs.js';

/** `TEAM#<teamId>` / `WAIVER#<waiverId>`. */
export type WaiverItem = Omit<Waiver, 'totals'>;

/** `TEAM#<teamId>` / `WAIVERTEXT#<waiverId>#<version>`. */
type WaiverTextItem = {
  teamId: string;
  waiverId: string;
  version: number;
  title: string;
  body: string;
  textHash: string;
  createdBy: string;
  createdAt: string;
};

/** `TEAM#<teamId>` / `WAIVERSIG#<waiverId>#<memberId>#<version>`. */
type SignatureItem = {
  teamId: string;
  waiverId: string;
  memberId: string;
  version: number;
  textHash: string;
  method: WaiverSignatureMethod;
  relationship: WaiverSignerRelationship;
  signerName: string;
  signedBy: string;
  signedAt: string;
};

/** A roster row, as much as waivers read of it. */
type RosterRow = { userId?: unknown; role?: unknown; roles?: unknown; displayName?: unknown };

/** `ORG#<orgId>` / `WAIVER_TEMPLATE#<templateId>`. */
type TemplateItem = WaiverTemplate;

/** A roster member who holds at least one role. */
type Member = { userId: string; roles: TeamRole[]; displayName?: string };

/**
 * The hash a signature records, so a printed copy can be checked against it.
 *
 * @param title - The waiver title at that version.
 * @param body - The waiver body at that version.
 * @returns SHA-256, hex.
 */
export const waiverTextHash = (title: string, body: string): string =>
  createHash('sha256').update(`${title}\n\n${body}`, 'utf8').digest('hex');

/**
 * Wraps an item as a transaction `Put` that fails if the row already exists.
 *
 * @param item - The full item, including `PK` and `SK`.
 * @returns The transaction entry.
 */
const putNew = (item: Record<string, unknown>) => ({
  Put: {
    TableName: TABLE_NAME,
    Item: item,
    ConditionExpression: 'attribute_not_exists(#pk)',
    ExpressionAttributeNames: { '#pk': TABLE_PK },
  },
});

/**
 * Drops table keys from a stored row.
 *
 * @param row - The stored row.
 * @returns The row without `PK` and `SK`.
 */
const withoutKeys = <T extends Record<string, unknown>>(row: T & { PK?: unknown; SK?: unknown }): T => {
  const { PK: _pk, SK: _sk, ...rest } = row;
  return rest as unknown as T;
};

/**
 * Roster members with their roles. Rows without a usable id or role are skipped.
 *
 * @param teamId - The team.
 * @returns Members in roster order.
 */
const loadMembers = async (teamId: string): Promise<Member[]> =>
  (await queryBySkPrefix<RosterRow>(teamPk(teamId), TEAM_MEMBER_SK_PREFIX)).flatMap((row) => {
    const roles = rolesFromMembership(row);
    if (typeof row.userId !== 'string' || roles.length === 0) return [];
    return [
      {
        userId: row.userId,
        roles,
        ...(typeof row.displayName === 'string' ? { displayName: row.displayName } : {}),
      },
    ];
  });

/**
 * Each member's latest signature on each waiver.
 *
 * @param rows - Signature rows, in sort-key order (version order per member).
 * @returns Latest signature keyed by `<waiverId>#<memberId>`.
 */
const latestSignatures = (rows: readonly SignatureItem[]): Map<string, SignatureItem> => {
  const latest = new Map<string, SignatureItem>();
  for (const row of rows) {
    const key = `${row.waiverId}#${row.memberId}`;
    const seen = latest.get(key);
    if (seen === undefined || row.version > seen.version) latest.set(key, row);
  }
  return latest;
};

/**
 * Counts who must sign a waiver and who has signed its current version.
 *
 * @param waiver - The waiver.
 * @param members - The roster.
 * @param latest - Latest signatures from {@link latestSignatures}.
 * @returns Totals for the staff list.
 */
const totalsFor = (
  waiver: WaiverItem,
  members: readonly Member[],
  latest: ReadonlyMap<string, SignatureItem>,
): WaiverTotals => {
  const asked = members.filter((member) => mustSignWaiver(member.roles, waiver.audience));
  const signed = asked.filter(
    (member) =>
      waiverMemberStatus(waiver.version, latest.get(`${waiver.waiverId}#${member.userId}`)?.version) === 'signed',
  ).length;
  return { members: asked.length, signed, missing: asked.length - signed };
};

/**
 * Loads one waiver.
 *
 * @param teamId - The team.
 * @param waiverId - The waiver.
 * @returns The stored waiver.
 * @throws `waiver_not_found`.
 */
const requireWaiver = async (teamId: string, waiverId: string): Promise<WaiverItem> => {
  const row = await getItem<WaiverItem & Record<string, unknown>>(teamPk(teamId), waiverSk(waiverId));
  if (row === undefined) throw new Error('waiver_not_found');
  return withoutKeys(row);
};

/**
 * Loads the text of one version.
 *
 * @param teamId - The team.
 * @param waiverId - The waiver.
 * @param version - The version.
 * @returns The stored text.
 * @throws `waiver_not_found` when that version was never written.
 */
const requireText = async (teamId: string, waiverId: string, version: number): Promise<WaiverTextItem> => {
  const row = await getItem<WaiverTextItem>(teamPk(teamId), waiverTextSk(waiverId, version));
  if (row === undefined) throw new Error('waiver_not_found');
  return row;
};

/**
 * A member's signatures on one waiver, oldest version first.
 *
 * @param teamId - The team.
 * @param waiverId - The waiver.
 * @param memberId - The member.
 * @returns Signature rows.
 */
const memberSignatures = (teamId: string, waiverId: string, memberId: string): Promise<SignatureItem[]> =>
  queryBySkPrefix<SignatureItem>(teamPk(teamId), waiverSignatureSkPrefix(waiverId, memberId));

/**
 * Writes the dated reminder rows for a waiver's due date.
 *
 * Each row carries the due date it was written for. The sweep drops a row
 * whose waiver has since moved its date, been archived, or been signed by
 * everyone, so a changed date needs no cleanup here.
 *
 * @param waiver - The waiver as stored.
 * @param today - Today's date, `YYYY-MM-DD`.
 */
const scheduleReminders = async (waiver: WaiverItem, today: string): Promise<void> => {
  if (waiver.dueDate === undefined || waiver.archived) return;
  const dueDate = waiver.dueDate;
  await Promise.all(
    reminderSchedule(dueDate, today).map((reminder) =>
      putItem({
        [TABLE_PK]: WAIVER_REMINDERS_PK,
        [TABLE_SK]: waiverReminderSk(reminder.sendOn, waiver.teamId, waiver.waiverId, reminder.kind),
        teamId: waiver.teamId,
        waiverId: waiver.waiverId,
        dueDate,
        kind: reminder.kind,
        sendOn: reminder.sendOn,
      }),
    ),
  );
};

/**
 * Everyone who can still sign a waiver for a member who has not signed its current version.
 *
 * Members with no in-app signer (a minor with no linked guardian) are left to staff.
 *
 * @param waiver - The waiver.
 * @returns Distinct signer user ids.
 */
export const outstandingSignerIds = async (waiver: WaiverItem): Promise<string[]> => {
  const [members, signatures] = await Promise.all([
    loadMembers(waiver.teamId),
    queryBySkPrefix<SignatureItem>(teamPk(waiver.teamId), waiverSignatureSkPrefix(waiver.waiverId)),
  ]);
  const latest = latestSignatures(signatures);
  const signers = new Set<string>();
  for (const member of members) {
    if (!mustSignWaiver(member.roles, waiver.audience)) continue;
    const signed = latest.get(`${waiver.waiverId}#${member.userId}`)?.version;
    if (waiverMemberStatus(waiver.version, signed) === 'signed') continue;
    const facts = await signerFacts(member.userId);
    if (facts === undefined) continue;
    for (const signerId of waiverSignerIds({ userId: member.userId, ...facts })) signers.add(signerId);
  }
  return [...signers];
};

/**
 * Loads one waiver, or `undefined` when it is gone.
 *
 * @param teamId - The team.
 * @param waiverId - The waiver.
 * @returns The stored waiver.
 */
export const findWaiver = async (teamId: string, waiverId: string): Promise<WaiverItem | undefined> => {
  const row = await getItem<WaiverItem & Record<string, unknown>>(teamPk(teamId), waiverSk(waiverId));
  return row === undefined ? undefined : withoutKeys(row);
};

/**
 * Every waiver on a team, archived ones included, with signed and missing counts.
 *
 * @param teamId - The team.
 * @returns Open waivers first, then by due date, then newest.
 */
export const listWaivers = async (teamId: string): Promise<Waiver[]> => {
  const [waivers, members, signatures] = await Promise.all([
    queryBySkPrefix<WaiverItem & Record<string, unknown>>(teamPk(teamId), WAIVER_SK_PREFIX),
    loadMembers(teamId),
    queryBySkPrefix<SignatureItem>(teamPk(teamId), WAIVER_SIGNATURE_SK_PREFIX),
  ]);
  const latest = latestSignatures(signatures);
  return waivers
    .map((row) => {
      const waiver = withoutKeys<WaiverItem>(row);
      return { ...waiver, totals: totalsFor(waiver, members, latest) };
    })
    .sort((left, right) => {
      if (left.archived !== right.archived) return left.archived ? 1 : -1;
      const leftDue = left.dueDate ?? '9999-12-31';
      const rightDue = right.dueDate ?? '9999-12-31';
      return leftDue === rightDue ? right.createdAt.localeCompare(left.createdAt) : leftDue.localeCompare(rightDue);
    });
};

/**
 * Creates a waiver at version 1.
 *
 * @param input - The team, the author, the text, and where it was copied from.
 * @returns The new waiver with its counts.
 * @throws `too_many_waivers` past {@link MAX_TEAM_WAIVERS}.
 */
export const createWaiver = async (input: {
  teamId: string;
  userId: string;
  body: CreateWaiverBody;
  source?: { orgId: string; templateId: string };
  now?: Date;
}): Promise<Waiver> => {
  const existing = await queryBySkPrefix(teamPk(input.teamId), WAIVER_SK_PREFIX);
  if (existing.length >= MAX_TEAM_WAIVERS) throw new Error('too_many_waivers');

  const at = (input.now ?? new Date()).toISOString();
  const waiver: WaiverItem = {
    teamId: input.teamId,
    waiverId: randomUUID(),
    title: input.body.title,
    body: input.body.body,
    version: 1,
    audience: input.body.audience,
    ...(input.body.dueDate !== undefined ? { dueDate: input.body.dueDate } : {}),
    archived: false,
    ...(input.source !== undefined ? { orgId: input.source.orgId, templateId: input.source.templateId } : {}),
    createdBy: input.userId,
    createdAt: at,
    updatedAt: at,
  };
  const text: WaiverTextItem = {
    teamId: waiver.teamId,
    waiverId: waiver.waiverId,
    version: 1,
    title: waiver.title,
    body: waiver.body,
    textHash: waiverTextHash(waiver.title, waiver.body),
    createdBy: input.userId,
    createdAt: at,
  };
  await transactWrite([
    putNew({ [TABLE_PK]: teamPk(waiver.teamId), [TABLE_SK]: waiverSk(waiver.waiverId), ...waiver }),
    putNew({ [TABLE_PK]: teamPk(text.teamId), [TABLE_SK]: waiverTextSk(text.waiverId, 1), ...text }),
  ]);
  await scheduleReminders(waiver, at.slice(0, 10));
  const members = await loadMembers(input.teamId);
  return { ...waiver, totals: totalsFor(waiver, members, new Map()) };
};

/**
 * The waiver templates of the organization a team belongs to.
 *
 * @param teamId - The team.
 * @returns The organization and its templates, or none for an independent team.
 */
export const listTeamWaiverTemplates = async (teamId: string): Promise<WaiverTemplateList> => {
  const orgId = await orgIdOfTeam(teamId);
  if (orgId === undefined) return { templates: [] };
  const rows = await queryBySkPrefix<TemplateItem & Record<string, unknown>>(
    orgPk(orgId),
    ORG_WAIVER_TEMPLATE_SK_PREFIX,
  );
  return {
    orgId,
    templates: rows.map((row) => withoutKeys<TemplateItem>(row)).sort((a, b) => a.title.localeCompare(b.title)),
  };
};

/**
 * Copies one of the team's organization's templates onto the team.
 *
 * The copy is the team's from then on: editing the template later leaves it alone.
 *
 * @param input - The team, the author, the template, and an optional due date.
 * @returns The new waiver.
 * @throws `template_not_found` when the team's organization has no such template.
 */
export const createWaiverFromTemplate = async (input: {
  teamId: string;
  userId: string;
  templateId: string;
  dueDate?: string;
}): Promise<Waiver> => {
  const orgId = await orgIdOfTeam(input.teamId);
  if (orgId === undefined) throw new Error('template_not_found');
  const template = await getItem<TemplateItem>(orgPk(orgId), orgWaiverTemplateSk(input.templateId));
  if (template === undefined) throw new Error('template_not_found');
  return createWaiver({
    teamId: input.teamId,
    userId: input.userId,
    body: {
      title: template.title,
      body: template.body,
      audience: template.audience,
      ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
    },
    source: { orgId, templateId: template.templateId },
  });
};

/**
 * Changes a waiver. A new title or body makes the next version, which
 * everyone signs again; other fields change in place.
 *
 * @param input - The team, the waiver, the editor, and the changes.
 * @returns The stored waiver with its counts.
 * @throws `waiver_not_found`, or `TransactionCanceledException` when another edit won.
 */
export const updateWaiver = async (input: {
  teamId: string;
  waiverId: string;
  userId: string;
  body: UpdateWaiverBody;
  now?: Date;
}): Promise<Waiver> => {
  const current = await requireWaiver(input.teamId, input.waiverId);
  const title = input.body.title ?? current.title;
  const body = input.body.body ?? current.body;
  const textChanged = title !== current.title || body !== current.body;
  const at = (input.now ?? new Date()).toISOString();
  const dueDate = input.body.dueDate === null ? undefined : (input.body.dueDate ?? current.dueDate);
  const { dueDate: _previousDue, ...rest } = current;
  const next: WaiverItem = {
    ...rest,
    title,
    body,
    version: textChanged ? current.version + 1 : current.version,
    audience: input.body.audience ?? current.audience,
    ...(dueDate !== undefined ? { dueDate } : {}),
    archived: input.body.archived ?? current.archived,
    updatedAt: at,
  };

  const text: WaiverTextItem | undefined = textChanged
    ? {
        teamId: next.teamId,
        waiverId: next.waiverId,
        version: next.version,
        title,
        body,
        textHash: waiverTextHash(title, body),
        createdBy: input.userId,
        createdAt: at,
      }
    : undefined;
  // Two edits of the text at once both try to write the next version's text row; one fails.
  await transactWrite([
    {
      Put: {
        TableName: TABLE_NAME,
        Item: { [TABLE_PK]: teamPk(next.teamId), [TABLE_SK]: waiverSk(next.waiverId), ...next },
        ConditionExpression: '#version = :version',
        ExpressionAttributeNames: { '#version': 'version' },
        ExpressionAttributeValues: { ':version': current.version },
      },
    },
    ...(text !== undefined
      ? [putNew({ [TABLE_PK]: teamPk(text.teamId), [TABLE_SK]: waiverTextSk(text.waiverId, text.version), ...text })]
      : []),
  ]);
  if (next.dueDate !== current.dueDate || (current.archived && !next.archived)) {
    await scheduleReminders(next, at.slice(0, 10));
  }

  const [members, signatures] = await Promise.all([
    loadMembers(next.teamId),
    queryBySkPrefix<SignatureItem>(teamPk(next.teamId), waiverSignatureSkPrefix(next.waiverId)),
  ]);
  return { ...next, totals: totalsFor(next, members, latestSignatures(signatures)) };
};

/**
 * Whether a member has someone who can sign for them in the app, and who.
 *
 * @param memberId - The member.
 * @returns Their account kind and the ids allowed to sign.
 */
const signerFacts = async (
  memberId: string,
): Promise<{ accountKind: 'adult' | 'minor'; guardianIds: string[] } | undefined> => {
  const profile = await getProfile(memberId);
  if (profile === undefined) return undefined;
  const guardianIds = profile.accountKind === 'minor' ? await listGuardianIds(memberId) : [];
  return { accountKind: profile.accountKind, guardianIds };
};

/**
 * One waiver and where every member who must sign stands: the staff missing list.
 *
 * @param teamId - The team.
 * @param waiverId - The waiver.
 * @returns The waiver and its members, missing first, then by name.
 * @throws `waiver_not_found`.
 */
export const waiverDetail = async (teamId: string, waiverId: string): Promise<WaiverDetail> => {
  const [waiver, members, signatures] = await Promise.all([
    requireWaiver(teamId, waiverId),
    loadMembers(teamId),
    queryBySkPrefix<SignatureItem>(teamPk(teamId), waiverSignatureSkPrefix(waiverId)),
  ]);
  const latest = latestSignatures(signatures);
  const asked = members.filter((member) => mustSignWaiver(member.roles, waiver.audience));
  const rows = await Promise.all(
    asked.map(async (member): Promise<WaiverMember> => {
      const signature = latest.get(`${waiverId}#${member.userId}`);
      const facts = await signerFacts(member.userId);
      const signers = facts === undefined ? 0 : facts.accountKind === 'adult' ? 1 : facts.guardianIds.length;
      return {
        memberId: member.userId,
        ...(member.displayName !== undefined ? { memberName: member.displayName } : {}),
        ...(facts !== undefined ? { accountKind: facts.accountKind } : {}),
        status: waiverMemberStatus(waiver.version, signature?.version),
        ...(signature !== undefined
          ? {
              signedVersion: signature.version,
              signedAt: signature.signedAt,
              signerName: signature.signerName,
              method: signature.method,
            }
          : {}),
        canSignInApp: signers > 0,
      };
    }),
  );
  const order = { missing: 0, outdated: 1, signed: 2 } as const;
  return {
    waiver: { ...waiver, totals: totalsFor(waiver, members, latest) },
    members: rows.sort((left, right) =>
      left.status === right.status
        ? (left.memberName ?? '').localeCompare(right.memberName ?? '')
        : order[left.status] - order[right.status],
    ),
  };
};

/**
 * Loads a member's roles and checks the waiver asks them to sign.
 *
 * @param waiver - The waiver.
 * @param memberId - The member.
 * @throws `member_not_asked` when they are not on the team or hold no role in the audience.
 */
const requireAsked = async (waiver: WaiverItem, memberId: string): Promise<void> => {
  const row = await getItem<RosterRow>(teamPk(waiver.teamId), teamMemberSk(memberId));
  if (row === undefined || !mustSignWaiver(rolesFromMembership(row), waiver.audience)) {
    throw new Error('member_not_asked');
  }
};

/**
 * Writes a signature on the waiver's current version.
 *
 * @param waiver - The waiver.
 * @param signature - Who signed, how, and when.
 * @returns The signature with the text it covers.
 * @throws `already_signed` when the member already has a signature on this version.
 */
const writeSignature = async (
  waiver: WaiverItem,
  signature: Omit<SignatureItem, 'teamId' | 'waiverId' | 'version' | 'textHash'>,
): Promise<WaiverSignature> => {
  const text = await requireText(waiver.teamId, waiver.waiverId, waiver.version);
  const item: SignatureItem = {
    teamId: waiver.teamId,
    waiverId: waiver.waiverId,
    version: waiver.version,
    textHash: text.textHash,
    ...signature,
  };
  try {
    await putItem(
      {
        [TABLE_PK]: teamPk(item.teamId),
        [TABLE_SK]: waiverSignatureSk(item.waiverId, item.memberId, item.version),
        ...item,
      },
      { conditionExpression: 'attribute_not_exists(#pk)', expressionAttributeNames: { '#pk': TABLE_PK } },
    );
  } catch (error) {
    if (error instanceof Error && error.name === 'ConditionalCheckFailedException') throw new Error('already_signed');
    throw error;
  }
  return { ...item, title: text.title, body: text.body };
};

/**
 * Signs a waiver in the app, for oneself or for a child.
 *
 * The signer need not be on the team: a guardian signs for a child wherever the child plays.
 *
 * @param input - The waiver, the member it is for, the signer, and what they typed.
 * @returns The stored signature with the text it covers.
 * @throws `waiver_not_found`, `waiver_archived`, `member_not_asked`, `not_signer`,
 *   `waiver_changed` when the text changed since the signer loaded it, or `already_signed`.
 */
export const signWaiver = async (input: {
  teamId: string;
  waiverId: string;
  memberId: string;
  signerId: string;
  version: number;
  signerName: string;
  now?: Date;
}): Promise<WaiverSignature> => {
  const waiver = await requireWaiver(input.teamId, input.waiverId);
  if (waiver.archived) throw new Error('waiver_archived');
  await requireAsked(waiver, input.memberId);
  const facts = await signerFacts(input.memberId);
  if (facts === undefined || !canSignWaiver(input.signerId, { userId: input.memberId, ...facts })) {
    throw new Error('not_signer');
  }
  if (input.version !== waiver.version) throw new Error('waiver_changed');
  return writeSignature(waiver, {
    memberId: input.memberId,
    method: 'electronic',
    relationship: input.signerId === input.memberId ? 'self' : 'guardian',
    signerName: input.signerName,
    signedBy: input.signerId,
    signedAt: (input.now ?? new Date()).toISOString(),
  });
};

/**
 * Staff record a paper form for a member, on the current version.
 *
 * @param input - The waiver, the member, the staff member, and the name on the form.
 * @returns The stored signature.
 * @throws `waiver_not_found`, `member_not_asked`, or `already_signed`.
 */
export const recordPaperSignature = async (input: {
  teamId: string;
  waiverId: string;
  memberId: string;
  staffId: string;
  signerName: string;
  now?: Date;
}): Promise<WaiverSignature> => {
  const waiver = await requireWaiver(input.teamId, input.waiverId);
  await requireAsked(waiver, input.memberId);
  return writeSignature(waiver, {
    memberId: input.memberId,
    method: 'paper',
    relationship: 'staff',
    signerName: input.signerName,
    signedBy: input.staffId,
    signedAt: (input.now ?? new Date()).toISOString(),
  });
};

/**
 * Removes a paper form staff recorded by mistake. A signature given in the app stays.
 *
 * @param input - The waiver and the member.
 * @throws `waiver_not_found`, `signature_not_found`, or `signed_in_app`.
 */
export const removePaperSignature = async (input: {
  teamId: string;
  waiverId: string;
  memberId: string;
}): Promise<void> => {
  const waiver = await requireWaiver(input.teamId, input.waiverId);
  const current = (await memberSignatures(input.teamId, input.waiverId, input.memberId)).find(
    (row) => row.version === waiver.version,
  );
  if (current === undefined) throw new Error('signature_not_found');
  if (current.method !== 'paper') throw new Error('signed_in_app');
  await deleteItem(teamPk(input.teamId), waiverSignatureSk(input.waiverId, input.memberId, current.version));
};

/**
 * A member's latest signature on a waiver, with the exact text they signed.
 *
 * @param teamId - The team.
 * @param waiverId - The waiver.
 * @param memberId - The member.
 * @returns The signature.
 * @throws `signature_not_found`.
 */
export const getSignature = async (teamId: string, waiverId: string, memberId: string): Promise<WaiverSignature> => {
  const latest = (await memberSignatures(teamId, waiverId, memberId)).at(-1);
  if (latest === undefined) throw new Error('signature_not_found');
  const text = await requireText(teamId, waiverId, latest.version);
  const { PK: _pk, SK: _sk, ...signature } = latest as SignatureItem & { PK?: unknown; SK?: unknown };
  return { ...signature, title: text.title, body: text.body };
};

/**
 * Whether a caller may see a member's signature without being staff: the
 * member themselves, or anyone who may sign for them.
 *
 * @param callerId - The caller.
 * @param memberId - The member.
 * @returns `true` for the member or a linked guardian.
 */
export const mayReadOwnSignature = async (callerId: string, memberId: string): Promise<boolean> => {
  if (callerId === memberId) return true;
  return (await listGuardianIds(memberId)).includes(callerId);
};

/** `USER#<userId>` / `TEAM#<teamId>`. */
type UserTeamRow = { teamId?: unknown };

/**
 * Every open waiver the caller or their children are asked to sign, across every team.
 *
 * @param callerId - The signed-in user.
 * @returns Waivers needing a signature first, then by due date.
 */
export const listMyWaivers = async (callerId: string): Promise<MyWaiver[]> => {
  const [profile, childIds] = await Promise.all([getProfile(callerId), listChildIds(callerId)]);
  const people = [callerId, ...childIds.filter((id) => id !== callerId)];
  const teamWaivers = new Map<string, Promise<WaiverItem[]>>();
  const teamNames = new Map<string, Promise<string | undefined>>();
  const waiversOf = (teamId: string): Promise<WaiverItem[]> => {
    let pending = teamWaivers.get(teamId);
    if (pending === undefined) {
      pending = queryBySkPrefix<WaiverItem & Record<string, unknown>>(teamPk(teamId), WAIVER_SK_PREFIX).then((rows) =>
        rows.map((row) => withoutKeys<WaiverItem>(row)).filter((waiver) => !waiver.archived),
      );
      teamWaivers.set(teamId, pending);
    }
    return pending;
  };
  const nameOf = (teamId: string): Promise<string | undefined> => {
    let pending = teamNames.get(teamId);
    if (pending === undefined) {
      pending = getItem<{ name?: string }>(teamPk(teamId), teamMetaSk()).then((row) => row?.name);
      teamNames.set(teamId, pending);
    }
    return pending;
  };

  const rows = await Promise.all(
    people.map(async (memberId) => {
      const memberProfile = memberId === callerId ? profile : await getProfile(memberId);
      if (memberProfile === undefined) return [];
      // A linked child is signed for by the caller; the caller signs their own only as an adult.
      const canSign = memberId === callerId ? memberProfile.accountKind === 'adult' : true;
      const teamIds = (await queryBySkPrefix<UserTeamRow>(userPk(memberId), USER_TEAM_SK_PREFIX)).flatMap((row) =>
        typeof row.teamId === 'string' ? [row.teamId] : [],
      );
      const perTeam = await Promise.all(
        teamIds.map(async (teamId) => {
          const [waivers, roster] = await Promise.all([
            waiversOf(teamId),
            getItem<RosterRow>(teamPk(teamId), teamMemberSk(memberId)),
          ]);
          if (roster === undefined) return [];
          const roles = rolesFromMembership(roster);
          const asked = waivers.filter((waiver) => mustSignWaiver(roles, waiver.audience));
          if (asked.length === 0) return [];
          const teamName = await nameOf(teamId);
          return Promise.all(
            asked.map(async (waiver): Promise<MyWaiver> => {
              const latest = (await memberSignatures(teamId, waiver.waiverId, memberId)).at(-1);
              const status = waiverMemberStatus(waiver.version, latest?.version);
              return {
                teamId,
                ...(teamName !== undefined ? { teamName } : {}),
                waiverId: waiver.waiverId,
                memberId,
                memberName: memberProfile.displayName,
                title: waiver.title,
                body: waiver.body,
                version: waiver.version,
                ...(waiver.dueDate !== undefined ? { dueDate: waiver.dueDate } : {}),
                status,
                ...(latest !== undefined ? { signedAt: latest.signedAt } : {}),
                canSign: canSign && status !== 'signed',
              };
            }),
          );
        }),
      );
      return perTeam.flat();
    }),
  );

  return rows.flat().sort((left, right) => {
    const open = Number(right.status !== 'signed') - Number(left.status !== 'signed');
    if (open !== 0) return open;
    return (left.dueDate ?? '9999-12-31').localeCompare(right.dueDate ?? '9999-12-31');
  });
};
