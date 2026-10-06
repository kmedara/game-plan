/**
 * Unit tests for pure team permission helpers.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ROLE_PERMISSIONS } from '@gameplan/types';
import { teamMemberSk, teamPk } from './dynamo/keys.js';

const mockGetItem = vi.fn();
const mockQueryBySkPrefix = vi.fn();

vi.mock('./dynamo/access.js', () => ({
  getItem: (...args: unknown[]) => mockGetItem(...args),
  queryBySkPrefix: (...args: unknown[]) => mockQueryBySkPrefix(...args),
}));

const {
  can,
  canWithMatrix,
  loadRolePermissionMatrix,
  normalizeRolePermissions,
  roleHasPermission,
} = await import('./permissions.js');

describe('permissions', () => {
  beforeEach(() => {
    mockGetItem.mockReset();
    mockQueryBySkPrefix.mockReset();
  });

  it('treats a missing matrix row as an empty permission list', () => {
    expect(canWithMatrix('coach', {}, 'manage_events')).toBe(false);
  });

  it('grants every permission to the default team admin role', () => {
    expect(
      canWithMatrix('team_admin', DEFAULT_ROLE_PERMISSIONS, 'manage_permissions'),
    ).toBe(true);
    expect(canWithMatrix('team_admin', DEFAULT_ROLE_PERMISSIONS, 'manage_events')).toBe(true);
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
      { role: 'coach', permissions: ['manage_events', 'invite_members', 123] },
      { role: 42, permissions: ['manage_events'] },
      { role: 'unknown', permissions: ['manage_events'] },
      { role: 'player', permissions: 'not-an-array' },
    ]);
    const matrix = await loadRolePermissionMatrix('team-1');
    expect(matrix.coach).toEqual(['manage_events', 'invite_members']);
    expect(matrix.player).toEqual([...DEFAULT_ROLE_PERMISSIONS.player]);
    expect(mockQueryBySkPrefix).toHaveBeenCalledWith(teamPk('team-1'), 'ROLE#');
  });

  it('returns false from can when membership is missing or permission denied', async () => {
    mockGetItem.mockResolvedValueOnce(undefined);
    await expect(can('u1', 't1', 'manage_events')).resolves.toBe(false);

    mockGetItem.mockResolvedValueOnce({ role: 'player' });
    mockQueryBySkPrefix.mockResolvedValueOnce([]);
    await expect(can('u1', 't1', 'manage_permissions')).resolves.toBe(false);

    mockGetItem.mockResolvedValueOnce({ role: 'team_admin' });
    mockQueryBySkPrefix.mockResolvedValueOnce([]);
    await expect(can('u1', 't1', 'manage_events')).resolves.toBe(true);
    expect(mockGetItem).toHaveBeenCalledWith(teamPk('t1'), teamMemberSk('u1'));
  });
});
