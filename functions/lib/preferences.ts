/**
 * Per-person settings stored at `USER#<userId>` / `PREFS`.
 *
 * A missing row or field means the default, so a new account needs no write.
 */

import {
  DEFAULT_EVENING_HOUR,
  DEFAULT_LEAD_MINUTES,
  type Preferences,
  type UpdatePreferencesBody,
} from '@gameplan/schemas';
import { TABLE_PK, TABLE_SK, getItem, prefsSk, putItem, userPk } from './dynamo/index.js';

/** Stored row; absent fields fall back to the defaults. */
type PrefsItem = Partial<Preferences> & { userId: string; updatedAt?: string };

/** Settings for someone who has never chosen. */
export const DEFAULT_PREFERENCES: Preferences = {
  reminderEveningHour: DEFAULT_EVENING_HOUR as Preferences['reminderEveningHour'],
  reminderLeadMinutes: DEFAULT_LEAD_MINUTES as Preferences['reminderLeadMinutes'],
};

/**
 * Fills defaults into a stored row.
 *
 * @param item - The stored row, if any.
 * @returns Complete preferences.
 */
const withDefaults = (item: PrefsItem | undefined): Preferences => ({
  reminderEveningHour:
    item?.reminderEveningHour === undefined ? DEFAULT_PREFERENCES.reminderEveningHour : item.reminderEveningHour,
  reminderLeadMinutes:
    item?.reminderLeadMinutes === undefined ? DEFAULT_PREFERENCES.reminderLeadMinutes : item.reminderLeadMinutes,
});

/**
 * A person's settings, with defaults filled in.
 *
 * @param userId - The person.
 * @returns Their preferences.
 */
export const loadPreferences = async (userId: string): Promise<Preferences> =>
  withDefaults(await getItem<PrefsItem>(userPk(userId), prefsSk()));

/**
 * Changes some settings and keeps the rest.
 *
 * @param userId - The person.
 * @param changes - Fields to change; `null` turns a reminder off.
 * @returns The saved preferences.
 */
export const savePreferences = async (userId: string, changes: UpdatePreferencesBody): Promise<Preferences> => {
  const next = { ...(await loadPreferences(userId)), ...changes };
  await putItem({
    [TABLE_PK]: userPk(userId),
    [TABLE_SK]: prefsSk(),
    userId,
    ...next,
    updatedAt: new Date().toISOString(),
  });
  return next;
};
