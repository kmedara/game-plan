/**
 * Invite-code parsing and role label keys.
 */

import { inviteCodeFromInput, inviteErrorMessage, roleLabel } from './roles';

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
    expect(inviteErrorMessage('nope')).toBe('errors.invite.failed');
  });
});
