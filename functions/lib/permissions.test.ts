/**
 * Unit tests for pure team permission helpers.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { canWithMatrix, canWithRoles, permissionMatrix, roleHasPermission } from '@gameplan/rules';
import { DEFAULT_ROLE_PERMISSIONS } from '@gameplan/types';
import { teamPk } from './dynamo/keys.js';

const mockQueryBySkPrefix = vi.fn();

vi.mock('./dynamo/access.js', () => ({
  queryBySkPrefix: (...args: unknown[]) => mockQueryBySkPrefix(...args),
}));

const { loadRolePermissionMatrix, normalizeRolePermissions } = await import('./permissions.js');

describe('permissions', () => {
  beforeEach(() => {
    mockQueryBySkPrefix.mockReset();
  });

  it('treats a missing matrix row as an empty permission list', () => {
    expect(canWithMatrix('coach', {}, 'manage_events')).toBe(false);
  });

  it('grants every permission to the default team admin role', () => {
    expect(
      canWithMatrix('team_admin', DEFAULT_ROLE_PERMISSIONS, 'manage_permissions'),
    ).toBe(true);
    expect(canWithMatrix('team_admin', DEFAULT_ROLE_PERMISSIONS, 'manage_team_settings')).toBe(true);
  });

  it('denies privileged permissions for coach, parent, and player by default', () => {
    expect(canWithMatrix('coach', DEFAULT_ROLE_PERMISSIONS, 'invite_members')).toBe(false);
    expect(canWithMatrix('parent', DEFAULT_ROLE_PERMISSIONS, 'assign_roles')).toBe(false);
    expect(canWithMatrix('player', DEFAULT_ROLE_PERMISSIONS, 'create_team_channels')).toBe(
      false,
    );
  });

  it('requires manage_permissions on team_admin when normalizing', () => {
    expect(() => normalizeRolePermissions('team_admin', ['invite_members'])).toThrow(
      'manage_permissions_required_for_team_admin',
    );
    expect(normalizeRolePermissions('team_admin', ['manage_permissions', 'invite_members'])).toEqual(
      ['manage_permissions', 'invite_members'],
    );
  });

  it('checks membership in a permission list', () => {
    expect(roleHasPermission(['manage_events'], 'manage_events')).toBe(true);
    expect(roleHasPermission(['manage_events'], 'invite_members')).toBe(false);
  });

  it('loads a role matrix from DynamoDB with defaults and overrides', async () => {
    mockQueryBySkPrefix.mockResolvedValueOnce([
      { role: 'team_admin', permissions: ['manage_permissions'] },
      { role: 'coach', permissions: ['manage_events', 'invite_members', 123] },
      { role: 42, permissions: ['manage_events'] },
      { role: 'unknown', permissions: ['manage_events'] },
      { role: 'player', permissions: 'not-an-array' },
    ]);
    const matrix = await loadRolePermissionMatrix('team-1');
    expect(matrix.team_admin).toEqual([...DEFAULT_ROLE_PERMISSIONS.team_admin]);
    expect(matrix.coach).toEqual(['manage_events', 'invite_members']);
    expect(matrix.player).toEqual([...DEFAULT_ROLE_PERMISSIONS.player]);
    expect(mockQueryBySkPrefix).toHaveBeenCalledWith(teamPk('team-1'), 'ROLE#');
  });

  it('grants a permission when any held role includes it', () => {
    expect(
      canWithRoles(['parent', 'coach'], { coach: ['manage_events'], parent: [] }, 'manage_events'),
    ).toBe(true);
    expect(canWithRoles(['parent'], { parent: [] }, 'manage_events')).toBe(false);
  });

  it('keys permission rows by role', () => {
    const matrix = permissionMatrix([
      { role: 'coach', permissions: ['manage_events'] },
      { role: 'player', permissions: [] },
    ]);
    expect(canWithRoles(['player', 'coach'], matrix, 'manage_events')).toBe(true);
    expect(canWithRoles(['parent'], matrix, 'manage_events')).toBe(false);
  });
});
