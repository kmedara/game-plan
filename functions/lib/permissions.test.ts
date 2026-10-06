/**
 * Unit tests for pure team permission helpers.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLE_PERMISSIONS } from '@gameplan/types';
import { canWithMatrix, normalizeRolePermissions, roleHasPermission } from './permissions.js';

describe('permissions', () => {
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
});
