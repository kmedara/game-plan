/**
 * Invite-code parsing, role labels, and team error keys.
 */

import { inviteCodeFromInput, inviteErrorMessage, joinRequestMessage, roleLabel, roleNames } from './roles';

describe('roles', () => {
  it('reads a code from a link or plain text', () => {
    expect(inviteCodeFromInput('')).toBe('');
    expect(inviteCodeFromInput('  ABC  ')).toBe('ABC');
    expect(inviteCodeFromInput('https://gameplan.example/invite/team-code')).toBe('team-code');
  });

  it('maps known roles and invite errors', () => {
    expect(roleLabel('coach')).toBe('role.coach');
    expect(roleLabel('captain')).toBe('captain');
    expect(inviteErrorMessage(new Error('not_found'))).toBe('errors.invite.notValid');
    expect(inviteErrorMessage(new Error('minor_cannot_be_team_admin'))).toBe('errors.invite.roleUnavailable');
    expect(inviteErrorMessage('nope')).toBe('errors.invite.failed');
  });

  it('uses the shared sentence for minor rules on join requests', () => {
    expect(joinRequestMessage(new Error('minor_cannot_be_team_admin'))).toBe('errors.roles.minorCannotBeTeamAdmin');
    expect(joinRequestMessage(new Error('not_found'))).toBe('errors.join.notPending');
    expect(joinRequestMessage(new Error('http_500'))).toBe('errors.join.updateFailed');
  });

  it('lists every held role, highest rank first', () => {
    const t = (key: string): string => key;
    expect(roleNames({ role: 'player' }, t)).toBe('role.player');
    expect(roleNames({ role: 'coach', roles: ['parent', 'coach'] }, t)).toBe('role.coach, role.parent');
  });
});
