import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CAPACITOR_REFRESH_KEY,
  CapacitorRefreshStore,
  SessionService,
  WebRefreshStore,
} from './session.service';

describe('WebRefreshStore', () => {
  it('is a no-op store for cookie-based web refresh', async () => {
    const store = new WebRefreshStore();
    await expect(store.get()).resolves.toBeNull();
    await expect(store.set('token')).resolves.toBeUndefined();
    await expect(store.clear()).resolves.toBeUndefined();
  });
});

describe('CapacitorRefreshStore', () => {
  it('reads, writes, and clears the preferences key', async () => {
    const preferences = {
      get: vi.fn().mockResolvedValue({ value: 'refresh' }),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    const store = new CapacitorRefreshStore(preferences);
    await expect(store.get()).resolves.toBe('refresh');
    expect(preferences.get).toHaveBeenCalledWith({ key: CAPACITOR_REFRESH_KEY });
    await store.set('next');
    expect(preferences.set).toHaveBeenCalledWith({
      key: CAPACITOR_REFRESH_KEY,
      value: 'next',
    });
    await store.clear();
    expect(preferences.remove).toHaveBeenCalledWith({ key: CAPACITOR_REFRESH_KEY });
  });
});

describe('SessionService', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let store: {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    clear: ReturnType<typeof vi.fn>;
  };
  let session: SessionService;

  beforeEach(() => {
    fetchMock = vi.fn();
    store = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    };
    session = new SessionService({
      baseUrl: 'http://api.test/identity',
      mode: 'native',
      refreshStore: store,
      fetch: fetchMock as unknown as typeof fetch,
    });
  });

  it('registers, logs in, and exposes auth state', async () => {
    const user = {
      userId: 'u1',
      email: 'a@b.c',
      displayName: 'A',
      accountKind: 'player' as const,
      needsProfileCompletion: false,
    };
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        accessToken: 'access',
        refreshToken: 'refresh',
        user,
      }),
    });

    await session.login({ email: 'a@b.c', password: 'secret' });
    expect(session.isAuthenticated()).toBe(true);
    expect(session.getAccessToken()).toBe('access');
    expect(session.getUser()).toEqual(user);
    expect(session.authorizationHeader()).toBe('Bearer access');
    expect(store.set).toHaveBeenCalledWith('refresh');
  });

  it('refreshes from the store and logs out', async () => {
    store.get.mockResolvedValue('refresh');
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          accessToken: 'access-2',
          refreshToken: 'refresh-2',
          user: {
            userId: 'u1',
            email: 'a@b.c',
            displayName: 'A',
            accountKind: 'player',
            needsProfileCompletion: false,
          },
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    await session.refresh();
    expect(session.getAccessToken()).toBe('access-2');
    await session.logout();
    expect(session.isAuthenticated()).toBe(false);
    expect(store.clear).toHaveBeenCalled();
  });

  it('throws when refresh has no stored token', async () => {
    store.get.mockResolvedValue(null);
    await expect(session.refresh()).rejects.toThrow();
  });

  it('logs out natively without a stored refresh token', async () => {
    store.get.mockResolvedValue(null);
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });

    await session.logout();

    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.test/identity/logout',
      expect.objectContaining({ body: '{}', credentials: 'omit' }),
    );
    expect(store.clear).toHaveBeenCalled();
  });

  it('uses cookies and skips the store when running in web mode', async () => {
    const webFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ accessToken: 'web-access', user: undefined }),
    });
    const web = new SessionService({
      baseUrl: 'http://api.test/identity/',
      mode: 'web',
      refreshStore: store,
      fetch: webFetch as unknown as typeof fetch,
    });

    await web.refresh();
    await web.logout();

    expect(webFetch).toHaveBeenNthCalledWith(
      1,
      'http://api.test/identity/refresh',
      expect.objectContaining({ body: '{}', credentials: 'include' }),
    );
    expect(store.get).not.toHaveBeenCalled();
    expect(store.set).not.toHaveBeenCalled();
    expect(web.isAuthenticated()).toBe(false);
  });

  it('registers over cookies in web mode and falls back to the global fetch', async () => {
    const globalFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ accessToken: 'web-access', user: undefined }),
    });
    vi.stubGlobal('fetch', globalFetch);
    try {
      const web = new SessionService({
        baseUrl: 'http://api.test/identity',
        mode: 'web',
        refreshStore: store,
      });
      expect(web.authorizationHeader()).toBeUndefined();

      await web.register({} as never);

      expect(globalFetch).toHaveBeenCalledWith(
        'http://api.test/identity/register',
        expect.objectContaining({ credentials: 'include' }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rejects when login or refresh responds with an error status', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    await expect(session.login({ email: 'a@b.c', password: 'bad' })).rejects.toThrow('http_401');

    store.get.mockResolvedValue('refresh');
    await expect(session.refresh()).rejects.toThrow('http_401');
  });

  it('rejects a native session that has no refresh token', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ accessToken: 'access', user: undefined }),
    });
    await expect(session.register({} as never)).rejects.toThrow('missing_refresh_token');
  });

  it('replaces the cached profile and adds a bearer header on request', () => {
    const user = { userId: 'u1' } as never;
    session.setUser(user);
    expect(session.getUser()).toBe(user);

    const headers = (
      session as unknown as { headers: (token?: string) => Record<string, string> }
    ).headers('tok');
    expect(headers['authorization']).toBe('Bearer tok');
    expect(headers['x-refresh-delivery']).toBe('body');
  });
});
