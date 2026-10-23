/**
 * An invite opened before an account exists is joined once the profile can hold a role.
 */

import { consumePendingInvite, inviteCodeFromPath, inviteCodeToRemember, readPendingInvite, savePendingInvite } from './pending-invite';

const mockStore = new Map<string, string>();

jest.mock('./refresh-store', () => ({
  readPreference: async (key: string) => mockStore.get(key),
  writePreference: async (key: string, value: string | undefined) => {
    if (value === undefined) mockStore.delete(key);
    else mockStore.set(key, value);
  },
}));

const cache = { invalidateQueries: jest.fn(async () => undefined) };

describe('pending invite', () => {
  beforeEach(() => {
    mockStore.clear();
    cache.invalidateQueries.mockClear();
  });

  it('reads a code from the invite path', () => {
    expect(inviteCodeFromPath('/invite/abc')).toBe('abc');
    expect(inviteCodeFromPath('/invite/ab%2Fcd')).toBe('ab/cd');
    expect(inviteCodeFromPath('/schedule')).toBeUndefined();
    expect(inviteCodeFromPath('/invite/')).toBeUndefined();
  });

  it('remembers a code only when login or profile completion will leave the page', () => {
    expect(inviteCodeToRemember('/invite/abc', false, false)).toBe('abc');
    expect(inviteCodeToRemember('/invite/abc', true, true)).toBe('abc');
    expect(inviteCodeToRemember('/invite/abc', true, false)).toBeUndefined();
    expect(inviteCodeToRemember('/teams', false, false)).toBeUndefined();
  });

  it('joins from the stored code and reloads the team list', async () => {
    await savePendingInvite('code-1');
    const acceptInvite = jest.fn(async () => ({ teamId: 'team-1' }));
    const getInvite = jest.fn();
    const result = await consumePendingInvite({ acceptInvite, getInvite }, cache);
    expect(result).toEqual({ status: 'joined', teamId: 'team-1' });
    expect(acceptInvite).toHaveBeenCalledWith('code-1');
    expect(getInvite).not.toHaveBeenCalled();
    expect(cache.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['teams'] });
    await expect(readPendingInvite()).resolves.toBeUndefined();
  });

  it('treats an existing membership as a successful join', async () => {
    await savePendingInvite('code-1');
    const acceptInvite = jest.fn(async () => {
      throw new Error('already_a_member');
    });
    const getInvite = jest.fn(async () => ({ teamId: 'team-1' }));
    await expect(consumePendingInvite({ acceptInvite, getInvite }, cache)).resolves.toEqual({
      status: 'joined',
      teamId: 'team-1',
    });
    await expect(readPendingInvite()).resolves.toBeUndefined();
  });

  it('drops a code that can no longer be used', async () => {
    await savePendingInvite('code-1');
    const acceptInvite = jest.fn(async () => {
      throw new Error('not_found');
    });
    await expect(consumePendingInvite({ acceptInvite, getInvite: jest.fn() }, cache)).resolves.toEqual({
      status: 'failed',
      code: 'code-1',
    });
    await expect(readPendingInvite()).resolves.toBeUndefined();
    expect(cache.invalidateQueries).not.toHaveBeenCalled();
  });

  it('does nothing when no code is stored', async () => {
    const acceptInvite = jest.fn();
    await expect(consumePendingInvite({ acceptInvite, getInvite: jest.fn() }, cache)).resolves.toEqual({
      status: 'none',
    });
    expect(acceptInvite).not.toHaveBeenCalled();
  });

  it('shares one accept when the join is requested twice', async () => {
    await savePendingInvite('code-1');
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const acceptInvite = jest.fn(async () => {
      await gate;
      return { teamId: 'team-1' };
    });
    const api = { acceptInvite, getInvite: jest.fn() };
    const first = consumePendingInvite(api, cache);
    const second = consumePendingInvite(api, cache);
    release?.();
    await expect(Promise.all([first, second])).resolves.toEqual([
      { status: 'joined', teamId: 'team-1' },
      { status: 'joined', teamId: 'team-1' },
    ]);
    expect(acceptInvite).toHaveBeenCalledTimes(1);
  });
});
