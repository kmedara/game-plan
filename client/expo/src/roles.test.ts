/**
 * Invite-code parsing and role label keys.
 */

import { heldRoles, inviteCodeFromInput, inviteErrorMessage, memberHasPermission, roleLabel } from './roles';

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

  it('reads a role set and unions permissions', () => {
    expect(heldRoles({ role: 'player' })).toEqual(['player']);
    expect(heldRoles({ role: 'coach', roles: ['coach', 'parent'] })).toEqual(['coach', 'parent']);
    expect(
      memberHasPermission(
        ['parent', 'coach'],
        [
          { role: 'parent', permissions: [] },
          { role: 'coach', permissions: ['manage_events'] },
        ],
        'manage_events',
      ),
    ).toBe(true);
  });
});
