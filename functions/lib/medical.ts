/**
 * Emergency and medical info at `USER#<userId>` / `MEDICAL`.
 *
 * The record follows the person, not a team, so a parent fills it in once
 * for every team their child plays on. Each staff read through a team is
 * logged on that team (`MEDREAD#`), kept for a year.
 */

import { toE164Phone, type MedicalInfo, type MedicalInfoBody } from '@gameplan/schemas';
import { getProfile } from './auth/index.js';
import { TABLE_PK, TABLE_SK, getItem, medicalReadSk, medicalSk, putItem, teamPk, userPk } from './dynamo/index.js';
import { listGuardianIds } from './guardians.js';
import type { MedicalSubject } from '@gameplan/rules';

/** How long a staff read stays in the team's log. */
const READ_LOG_TTL_SECONDS = 365 * 24 * 60 * 60;

/** Stored record. */
type MedicalItem = MedicalInfoBody & { userId: string; updatedAt?: string; updatedBy?: string };

/**
 * A person's record. Someone who never filled it in has an empty one.
 *
 * @param userId - The person.
 * @returns Their info.
 */
export const getMedicalInfo = async (userId: string): Promise<MedicalInfo> => {
  const item = await getItem<MedicalItem & { PK?: string; SK?: string }>(userPk(userId), medicalSk());
  if (item === undefined) return { userId, emergencyContacts: [] };
  const { PK: _pk, SK: _sk, updatedBy: _by, ...info } = item;
  return info;
};

/**
 * Replaces a person's record.
 *
 * @param userId - The person.
 * @param body - The whole new record.
 * @param editorId - Who saved it.
 * @returns The stored info.
 */
export const putMedicalInfo = async (userId: string, body: MedicalInfoBody, editorId: string): Promise<MedicalInfo> => {
  const updatedAt = new Date().toISOString();
  const emergencyContacts = body.emergencyContacts.map((contact) => ({
    ...contact,
    phone: toE164Phone(contact.phone) ?? contact.phone,
  }));
  const info: MedicalInfo = { userId, ...body, emergencyContacts, updatedAt };
  await putItem({ [TABLE_PK]: userPk(userId), [TABLE_SK]: medicalSk(), ...info, updatedBy: editorId });
  return info;
};

/**
 * The facts the medical rules need about a person.
 *
 * @param userId - The person.
 * @returns Their account kind and guardians, or `undefined` when there is no profile.
 */
export const medicalSubject = async (userId: string): Promise<MedicalSubject | undefined> => {
  const profile = await getProfile(userId);
  if (profile === undefined) return undefined;
  const guardianIds = profile.accountKind === 'minor' ? await listGuardianIds(userId) : [];
  return { userId, accountKind: profile.accountKind, guardianIds };
};

/**
 * Records that a staff member read a member's info through a team.
 *
 * @param input - Team, viewer, and member.
 */
export const logMedicalRead = async (input: { teamId: string; viewerId: string; memberId: string }): Promise<void> => {
  const at = new Date();
  await putItem({
    [TABLE_PK]: teamPk(input.teamId),
    [TABLE_SK]: medicalReadSk(at.toISOString(), input.viewerId, input.memberId),
    ...input,
    at: at.toISOString(),
    ttl: Math.floor(at.getTime() / 1000) + READ_LOG_TTL_SECONDS,
  });
};
