/**
 * Unit tests for DynamoDB key builders.
 */

import { describe, expect, it } from 'vitest';
import {
  chatPk,
  invitePk,
  messageSk,
  profileSk,
  rsvpSk,
  rsvpSkRange,
  teamDirectoryPk,
  teamDirectorySk,
  teamDirectorySkPrefix,
  teamPk,
  userPk,
  userTeamSk,
} from './keys.js';

describe('dynamo keys', () => {
  it('builds user, team, chat, and invite partitions', () => {
    expect(userPk('u1')).toBe('USER#u1');
    expect(profileSk()).toBe('PROFILE');
    expect(userTeamSk('t1')).toBe('TEAM#t1');
    expect(teamPk('t1')).toBe('TEAM#t1');
    expect(chatPk('c1')).toBe('CHAT#c1');
    expect(invitePk('abc')).toBe('INVITE#abc');
    expect(teamDirectoryPk()).toBe('TEAM_DIR');
    expect(teamDirectorySk('Tigers', 't1')).toBe('NAME#tigers#t1');
    expect(teamDirectorySkPrefix('Ti')).toBe('NAME#ti');
  });

  it('builds message and RSVP sort keys for reverse and range queries', () => {
    expect(messageSk('2026-09-29T12:00:00.000Z', 'm1')).toBe(
      'MSG#2026-09-29T12:00:00.000Z#m1',
    );
    expect(rsvpSk('2026-09-29T18:00:00.000Z', 'u1')).toBe(
      'RSVP#2026-09-29T18:00:00.000Z#u1',
    );
    expect(rsvpSkRange('2026-09-01T00:00:00.000Z', '2026-09-30T23:59:59.999Z')).toEqual({
      lo: 'RSVP#2026-09-01T00:00:00.000Z',
      hi: 'RSVP#2026-09-30T23:59:59.999Z#\uffff',
    });
  });
});
