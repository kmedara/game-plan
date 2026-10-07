/**
 * Unit tests for DynamoDB key builders.
 */

import { describe, expect, it } from 'vitest';
import {
  chatMemberSk,
  chatMetaSk,
  chatPk,
  connectionSk,
  deviceSk,
  eventSk,
  inviteMetaSk,
  invitePk,
  joinRequestSk,
  messageSk,
  profileSk,
  rolePermissionsSk,
  rsvpSk,
  rsvpSkLegacy,
  rsvpSkRange,
  teamDirectoryPk,
  teamDirectorySk,
  teamDirectorySkPrefix,
  teamInviteSk,
  teamMemberSk,
  teamMetaSk,
  teamPk,
  userChatSk,
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
    expect(teamDirectorySkPrefix()).toBe('NAME#');
    expect(teamDirectorySkPrefix('  ')).toBe('NAME#');
  });

  it('builds remaining chat, team, and user sort keys', () => {
    expect(teamMetaSk()).toBe('META');
    expect(rolePermissionsSk('coach')).toBe('ROLE#coach');
    expect(teamMemberSk('u1')).toBe('MEMBER#u1');
    expect(teamInviteSk('code')).toBe('INVITE#code');
    expect(joinRequestSk('req-1')).toBe('JOIN#req-1');
    expect(eventSk('evt-1')).toBe('EVT#evt-1');
    expect(userChatSk('c1')).toBe('CHAT#c1');
    expect(deviceSk('d1')).toBe('DEVICE#d1');
    expect(connectionSk('conn-1')).toBe('CONN#conn-1');
    expect(chatMetaSk()).toBe('META');
    expect(chatMemberSk('u1')).toBe('MEMBER#u1');
    expect(inviteMetaSk()).toBe('META');
  });

  it('builds message and RSVP sort keys for reverse and range queries', () => {
    expect(messageSk('2026-09-29T12:00:00.000Z', 'm1')).toBe(
      'MSG#2026-09-29T12:00:00.000Z#m1',
    );
    expect(rsvpSk('2026-09-29T18:00:00.000Z', 'evt-1', 'u1')).toBe(
      'RSVP#2026-09-29T18:00:00.000Z#evt-1#u1',
    );
    expect(rsvpSkLegacy('2026-09-29T18:00:00.000Z', 'u1')).toBe(
      'RSVP#2026-09-29T18:00:00.000Z#u1',
    );
    expect(rsvpSkRange('2026-09-01T00:00:00.000Z', '2026-09-30T23:59:59.999Z')).toEqual({
      lo: 'RSVP#2026-09-01T00:00:00.000Z',
      hi: 'RSVP#2026-09-30T23:59:59.999Z#\uffff',
    });
  });
});
