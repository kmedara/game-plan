import { TestBed } from '@angular/core/testing';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: vi.fn(),
    set: vi.fn(),
    remove: vi.fn(),
  },
}));
import { environment } from '../../environments/environment';
import { ApiClientService } from './api-client.service';

describe('ApiClientService', () => {
  let api: ApiClientService;
  let fetchMock: ReturnType<typeof vi.fn>;

  const jsonResponse = (body: unknown, status = 200): Response =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }) as Response;

  beforeEach(() => {
    TestBed.resetTestingModule();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(false);
    vi.mocked(Preferences.get).mockResolvedValue({ value: null });
    vi.mocked(Preferences.set).mockResolvedValue(undefined);
    vi.mocked(Preferences.remove).mockResolvedValue(undefined);
    TestBed.configureTestingModule({});
    api = TestBed.inject(ApiClientService);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('restores and persists the selected team id', async () => {
    expect(await api.restoreTeamId()).toBeUndefined();
    vi.mocked(Preferences.get).mockResolvedValue({ value: 'team-1' });
    expect(await api.restoreTeamId()).toBe('team-1');
    expect(await api.restoreTeamId()).toBe('team-1');

    api.setTeamId('team-2');
    await vi.waitFor(() => {
      expect(Preferences.set).toHaveBeenCalledWith({
        key: 'selected-team-id',
        value: 'team-2',
      });
    });
    api.setTeamId(undefined);
    await vi.waitFor(() => {
      expect(Preferences.remove).toHaveBeenCalledWith({ key: 'selected-team-id' });
    });

    vi.mocked(Preferences.get).mockRejectedValue(new Error('denied'));
    api.selectedTeamId.set(undefined);
    expect(await api.restoreTeamId()).toBeUndefined();

    vi.mocked(Preferences.set).mockRejectedValue(new Error('denied'));
    api.setTeamId('team-3');
    expect(api.getTeamId()).toBe('team-3');
  });

  it('registers, logs in, refreshes, and loads the profile', async () => {
    const user = {
      userId: 'u1',
      email: 'a@b.c',
      displayName: 'A',
      accountKind: 'player' as const,
      needsProfileCompletion: false,
    };
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ accessToken: 'a', refreshToken: 'r', user }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ accessToken: 'a', refreshToken: 'r', user }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ accessToken: 'a2', refreshToken: 'r2', user }),
      )
      .mockResolvedValueOnce(jsonResponse(user))
      .mockResolvedValueOnce(jsonResponse({ ...user, displayName: 'B' }))
      .mockResolvedValueOnce(jsonResponse(user));

    await api.register({
      email: 'a@b.c',
      password: 'secret',
      displayName: 'A',
      accountKind: 'player',
    });
    await api.login({ email: 'a@b.c', password: 'secret' });
    expect(api.isAuthenticated()).toBe(true);
    expect(api.user).toEqual(user);

    await expect(api.refreshSession()).resolves.toBe(true);
    expect(api.accessToken()).toBe('a2');
    await expect(api.getMe()).resolves.toEqual(user);
    await expect(api.updateProfile({ displayName: 'B' })).resolves.toMatchObject({
      displayName: 'B',
    });
    await api.completeProfile({
      displayName: 'A',
      accountKind: 'player',
    });
  });

  it('returns false when refresh fails', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 401));
    await expect(api.refreshSession()).resolves.toBe(false);
  });

  it('logs out locally when auth is disabled', async () => {
    const previous = environment.authDisabled;
    environment.authDisabled = true;
    fetchMock.mockResolvedValue(jsonResponse({}));
    try {
      await api.logout();
      expect(api.hasTeams()).toBe(false);
      expect(api.getTeamId()).toBeUndefined();
    } finally {
      environment.authDisabled = previous;
    }
  });

  it('uses hosted logout when auth is enabled', async () => {
    const previous = environment.authDisabled;
    environment.authDisabled = false;
    try {
      await api.logout();
      expect(api.getTeamId()).toBeUndefined();
      expect(api.hasTeams()).toBe(false);
    } finally {
      environment.authDisabled = previous;
    }
  });

  it('covers team, schedule, chat, media, and places helpers', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.endsWith('/teams') && method === 'GET') {
        return jsonResponse({ teams: [{ teamId: 't1', name: 'T', timeZone: 'UTC', role: 'player' }] });
      }
      if (url.endsWith('/teams') && method === 'POST') {
        return jsonResponse({ teamId: 't2', name: 'New', timeZone: 'UTC', role: 'coach' });
      }
      if (url.includes('/teams/directory')) {
        return jsonResponse({ teams: [], nextCursor: undefined });
      }
      if (url.includes('/join-requests') && method === 'GET') {
        return jsonResponse({ joinRequests: [{ requestId: 'r1', userId: 'u2' }] });
      }
      if (url.includes('/approve')) {
        return jsonResponse({ teamId: 't1', userId: 'u2', role: 'player' });
      }
      if (url.includes('/reject')) return jsonResponse({}, 204);
      if (url.includes('/invites') && method === 'GET') {
        return jsonResponse({ invites: [{ code: 'abc', role: 'player' }] });
      }
      if (url.includes('/invites') && method === 'POST') {
        return jsonResponse({ code: 'xyz', role: 'player' });
      }
      if (url.includes('/invite/abc') && method === 'GET') {
        return jsonResponse({ code: 'abc', teamName: 'T', role: 'player' });
      }
      if (url.includes('/accept')) {
        return jsonResponse({ teamId: 't1', role: 'player' });
      }
      if (url.match(/\/members\/[^/?]+$/u)) {
        return jsonResponse({
          userId: 'u1',
          role: 'player',
          joinedAt: '2026-01-01T00:00:00.000Z',
          displayName: 'Ada',
        });
      }
      if (url.includes('/members')) {
        return jsonResponse({ members: [{ userId: 'u1', role: 'player' }] });
      }
      if (url.includes('/permissions') && method === 'GET') {
        return jsonResponse({ roles: {} });
      }
      if (url.includes('/permissions') && method === 'PUT') {
        return jsonResponse({ roles: { player: [] } });
      }
      if (url.includes('/schedule/')) {
        if (method === 'POST') return jsonResponse({ eventId: 'e1' });
        if (method === 'PUT') return jsonResponse({ status: 'yes' });
        return jsonResponse({ events: [] });
      }
      if (url.includes('/places/autocomplete')) {
        return jsonResponse({ suggestions: [{ id: 'p1', primaryText: 'Park' }] });
      }
      if (url.includes('/places/resolve')) {
        return jsonResponse({ label: 'Park', latitude: 1, longitude: 2 });
      }
      if (url.includes('/places/reverse')) {
        return jsonResponse({ label: 'Corner', latitude: 3, longitude: 4 });
      }
      if (url.endsWith('/chat')) return jsonResponse({ chats: [{ chatId: 'c1' }] });
      if (url.includes('/chat/users/search')) {
        return jsonResponse({
          user: {
            userId: 'u2',
            email: 'ada@example.com',
            displayName: 'Ada',
            accountKind: 'adult',
          },
        });
      }
      if (url.endsWith('/chat/private') && method === 'POST') {
        return jsonResponse({ chatId: 'p1', kind: 'private', name: 'Private chat' });
      }
      if (url.endsWith('/chat/channels') && method === 'POST') {
        return jsonResponse({
          chatId: 'ch1',
          kind: 'channel',
          name: 'Parents',
          teamId: 't1',
        });
      }
      if (url.includes('/messages') && method === 'GET') {
        return jsonResponse({ messages: [] });
      }
      if (url.includes('/messages') && method === 'POST') {
        return jsonResponse({ messageId: 'm1', body: 'hi' });
      }
      if (url.includes('/media/presign-upload')) {
        return jsonResponse({ uploadUrl: 'https://up', objectKey: 'k' });
      }
      if (url.includes('/media/presign-download')) {
        return jsonResponse({ downloadUrl: 'https://dl', objectKey: 'k' });
      }
      if (url.includes('/media/devices/')) {
        return jsonResponse({ deviceId: 'd1', platform: 'web' });
      }
      if (url.includes('/positions')) {
        return jsonResponse({ teamId: 't1', name: 'T', timeZone: 'UTC', role: 'player' });
      }
      if (url.match(/\/teams\/t1$/) && method === 'GET') {
        return jsonResponse({ teamId: 't1', name: 'T', timeZone: 'UTC', role: 'player' });
      }
      if (url.match(/\/teams\/t1$/) && method === 'PATCH') {
        return jsonResponse({ teamId: 't1', name: 'Renamed', timeZone: 'UTC', role: 'player' });
      }
      if (url.includes('/join-requests') && method === 'POST' && !url.includes('approve')) {
        return jsonResponse({ requestId: 'r1' });
      }
      return jsonResponse({ error: 'unexpected' }, 500);
    });

    await expect(api.listTeams()).resolves.toHaveLength(1);
    expect(api.hasTeams()).toBe(true);
    await api.createTeam({ name: 'New', timeZone: 'UTC' });
    await api.getTeam('t1');
    await api.setPositions('t1', ['pitcher']);
    await api.updateTeam('t1', { name: 'Renamed' });
    await api.searchTeams('  ');
    await api.searchTeams('hawks', { limit: 5, cursor: 'c' });
    await api.requestJoin('t1');
    await expect(api.listJoinRequests('t1')).resolves.toHaveLength(1);
    await api.approveJoinRequest('t1', 'r1', 'player');
    await api.rejectJoinRequest('t1', 'r1');
    await expect(api.listInvites('t1')).resolves.toHaveLength(1);
    await api.createInvite('t1');
    await api.createInvite('t1', 'coach');
    await api.getInvite('abc');
    await api.acceptInvite('abc');
    await api.listMembers('t1');
    await api.getMember('t1', 'u1');
    await api.getPermissions('t1');
    await api.putPermissions('t1', { player: [] } as never);
    await api.getSchedule('t1', '2026-01-01', '2026-01-31');
    await api.createEvent('t1', {
      title: 'Game',
      startsAt: '2026-01-01T18:00:00.000Z',
      endsAt: '2026-01-01T20:00:00.000Z',
    } as never);
    await api.putRsvp('t1', { eventId: 'e1', status: 'yes' } as never);
    await expect(api.autocompletePlaces('park')).resolves.toHaveLength(1);
    await api.resolvePlace('p1');
    await api.reverseGeocodePlace(3, 4);
    await api.listChats();
    await expect(api.searchChatUser('ada@example.com')).resolves.toMatchObject({
      userId: 'u2',
    });
    await expect(api.createPrivateChat(['u2'])).resolves.toMatchObject({ chatId: 'p1' });
    await expect(api.createTeamChannel('t1', 'Parents')).resolves.toMatchObject({
      chatId: 'ch1',
    });
    await api.listMessages('c1');
    await api.sendMessage('c1', { body: 'hi' });
    await api.presignUpload('image/png', 12);
    await api.presignDownload('k');
    await api.registerDevice('d1', 'tok', 'web');
  });

  it('omits credentials and replays the stored refresh token on native platforms', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Preferences.get).mockResolvedValue({ value: 'stored-refresh' });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const nativeApi = TestBed.inject(ApiClientService);

    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, 401))
      .mockResolvedValueOnce(
        jsonResponse({
          accessToken: 'native-access',
          refreshToken: 'native-refresh',
          user: {
            userId: 'u1',
            email: 'a@b.c',
            displayName: 'A',
            accountKind: 'player',
            needsProfileCompletion: false,
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ teamId: 't2', name: 'New', timeZone: 'UTC', role: 'coach' }),
      );

    await nativeApi.createTeam({ name: 'New', timeZone: 'UTC' });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ credentials: 'omit' });
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      credentials: 'omit',
      body: JSON.stringify({ refreshToken: 'stored-refresh' }),
    });
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({
      credentials: 'omit',
      headers: { authorization: 'Bearer native-access' },
    });
    expect(Preferences.set).toHaveBeenCalledWith({
      key: 'ts_refresh',
      value: 'native-refresh',
    });
  });

  it('retries once after a 401 and surfaces API error codes', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, 401))
      .mockResolvedValueOnce(
        jsonResponse({
          accessToken: 'a',
          refreshToken: 'r',
          user: {
            userId: 'u1',
            email: 'a@b.c',
            displayName: 'A',
            accountKind: 'player',
            needsProfileCompletion: false,
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ teams: [] }))
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: 'bad_request' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 502,
        json: async () => {
          throw new Error('no json');
        },
      } as Response);

    await expect(api.listTeams()).resolves.toEqual([]);
    await expect(api.getTeam('t1')).rejects.toThrow('bad_request');
    await expect(api.getTeam('t1')).rejects.toThrow('http_502');
  });
});
