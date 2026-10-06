/**
 * Unit tests for minor account rules and the minor chat membership rule.
 */

import { describe, expect, it } from 'vitest';
import {
  accountKindFromBirthday,
  canAddChatMember,
  canBeTeamAdmin,
  canCreateTeam,
  canHoldManagePermissions,
  isMinorChatMembershipAllowed,
  sharesTeam,
  type ChatParticipant,
} from './minor-chat.js';

/** Builds a chat participant for the minor-rule tests. */
const person = (
  userId: string,
  accountKind: 'adult' | 'minor',
  teamIds: string[],
): ChatParticipant => ({ userId, accountKind, teamIds });

describe('account rules', () => {
  it('blocks minors from creating a team, being admin, or holding manage_permissions', () => {
    expect(canCreateTeam('minor')).toBe(false);
    expect(canBeTeamAdmin('minor')).toBe(false);
    expect(canHoldManagePermissions('minor')).toBe(false);
    expect(canCreateTeam('adult')).toBe(true);
    expect(canBeTeamAdmin('adult')).toBe(true);
    expect(canHoldManagePermissions('adult')).toBe(true);
  });

  it('derives minor vs adult from birthday', () => {
    const now = new Date('2026-09-30T12:00:00.000Z');
    expect(accountKindFromBirthday('2008-09-30', now)).toBe('adult');
    expect(accountKindFromBirthday('2008-10-01', now)).toBe('minor');
    expect(accountKindFromBirthday('2010-01-01', now)).toBe('minor');
    expect(accountKindFromBirthday('1990-05-15', now)).toBe('adult');
  });

  it('rejects a future or malformed birthday', () => {
    const now = new Date('2026-09-30T12:00:00.000Z');
    expect(() => accountKindFromBirthday('2026-10-01', now)).toThrow('invalid_birthday');
    expect(() => accountKindFromBirthday('not-a-date', now)).toThrow('invalid_birthday');
    expect(() => accountKindFromBirthday('2020-02-30', now)).toThrow('invalid_birthday');
  });
});

describe('minor chat rule', () => {
  it('allows a chat of adults from different teams', () => {
    const members = [person('a', 'adult', ['t1']), person('b', 'adult', ['t2'])];
    expect(isMinorChatMembershipAllowed(members)).toBe(true);
  });

  it('allows a minor only with people who share a team', () => {
    const members = [person('m', 'minor', ['t1']), person('a', 'adult', ['t1', 't2'])];
    expect(isMinorChatMembershipAllowed(members)).toBe(true);
  });

  it('rejects a minor with an outsider who shares no team', () => {
    const members = [person('m', 'minor', ['t1']), person('x', 'adult', ['t9'])];
    expect(isMinorChatMembershipAllowed(members)).toBe(false);
  });

  it('rejects adding an outsider when a minor is already in the chat', () => {
    const existing = [person('m', 'minor', ['t1']), person('a', 'adult', ['t1'])];
    const outsider = person('x', 'adult', ['t9']);
    expect(canAddChatMember(existing, outsider)).toBe(false);
  });

  it('rejects adding a minor when an outsider is already in the chat', () => {
    const existing = [person('a', 'adult', ['t1']), person('x', 'adult', ['t9'])];
    const minor = person('m', 'minor', ['t1']);
    expect(canAddChatMember(existing, minor)).toBe(false);
  });

  it('detects shared teams', () => {
    expect(sharesTeam(['t1', 't2'], ['t2'])).toBe(true);
    expect(sharesTeam(['t1'], ['t9'])).toBe(false);
    expect(sharesTeam([], ['t1'])).toBe(false);
    expect(sharesTeam(['t1'], [])).toBe(false);
  });

  it('allows adding a member when the minor rule passes', () => {
    const existing = [person('a', 'adult', ['t1'])];
    const teammate = person('b', 'adult', ['t1']);
    expect(canAddChatMember(existing, teammate)).toBe(true);
  });
});
