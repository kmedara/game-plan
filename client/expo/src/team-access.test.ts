/**
 * Team permissions: one request per team, any held role grants access.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';
import { permissionsQuery, rememberTeamPermissions } from './queries/teams';
import { createTestQueryClient, queryWrapper } from './test-query';
import { useTeamAccess } from './team-access';

const mockGetPermissions = jest.fn();

jest.mock('./state', () => {
  const app = { api: { getPermissions: (...args: unknown[]) => mockGetPermissions(...args) } };
  return { useApp: () => app };
});

describe('team access', () => {
  const api = { getPermissions: mockGetPermissions };

  beforeEach(() => {
    mockGetPermissions.mockReset();
  });

  it('grants a permission held by any of the caller roles', async () => {
    mockGetPermissions.mockResolvedValueOnce({
      roles: [
        { role: 'parent', permissions: [] },
        { role: 'coach', permissions: ['create_team_channels'] },
      ],
    });
    const { result } = renderHook(
      () => useTeamAccess({ teamId: 't1', role: 'coach', roles: ['coach', 'parent'] }),
      { wrapper: queryWrapper(createTestQueryClient()) },
    );
    expect(result.current.can('create_team_channels')).toBe(false);
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.can('create_team_channels')).toBe(true);
    expect(result.current.can('manage_events')).toBe(false);
  });

  it('shares one request per team and uses saved rows', async () => {
    mockGetPermissions.mockResolvedValue({ roles: [{ role: 'coach', permissions: ['manage_events'] }] });
    const client = createTestQueryClient();
    const wrapper = queryWrapper(client);
    const first = renderHook(() => useTeamAccess({ teamId: 't1', role: 'coach', roles: ['coach'] }), { wrapper });
    const second = renderHook(() => useTeamAccess({ teamId: 't1', role: 'coach', roles: ['coach'] }), { wrapper });
    await waitFor(() => expect(first.result.current.ready).toBe(true));
    await waitFor(() => expect(second.result.current.ready).toBe(true));
    expect(mockGetPermissions).toHaveBeenCalledTimes(1);

    act(() => {
      rememberTeamPermissions(client, 't1', [{ role: 'coach', permissions: [] }]);
    });
    await expect(client.fetchQuery(permissionsQuery(api as never, 't1'))).resolves.toEqual([
      { role: 'coach', permissions: [] },
    ]);
    expect(mockGetPermissions).toHaveBeenCalledTimes(1);
  });

  it('asks again after a failed request', async () => {
    mockGetPermissions.mockRejectedValueOnce(new Error('http_500')).mockResolvedValueOnce({ roles: [] });
    const client = createTestQueryClient();
    await expect(client.fetchQuery(permissionsQuery(api as never, 't1'))).rejects.toThrow('http_500');
    await expect(client.fetchQuery(permissionsQuery(api as never, 't1'))).resolves.toEqual([]);
  });

  it('is not ready and grants nothing without a team', () => {
    const { result } = renderHook(() => useTeamAccess(undefined), {
      wrapper: queryWrapper(createTestQueryClient()),
    });
    expect(result.current).toMatchObject({ roles: [], ready: false });
    expect(mockGetPermissions).not.toHaveBeenCalled();
  });
});
