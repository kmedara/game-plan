/**
 * Unit tests for the client session service and refresh stores.
 */

import { describe, expect, it, vi } from 'vitest';
import { ACCESS_REFRESH_LEEWAY_MS, SessionService, WebRefreshStore, type RefreshStore } from './index.js';

describe('WebRefreshStore', () => {
  it('never persists a readable refresh token', async () => {
    const store = new WebRefreshStore();
    await store.set('secret');
    expect(await store.get()).toBeNull();
    await store.clear();
    expect(await store.get()).toBeNull();
  });
});

describe('SessionService', () => {
  it('holds no token on web and relies on the session cookies', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/login')) {
        expect(init?.credentials).toBe('include');
        expect((init?.headers as Record<string, string>)['x-refresh-delivery']).toBeUndefined();
        return new Response(
          JSON.stringify({
            expiresIn: 3600,
            user: {
              userId: 'u1',
              email: 'a@example.com',
              displayName: 'Ada',
              accountKind: 'adult',
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.endsWith('/me')) {
        expect(init?.credentials).toBe('include');
        expect((init?.headers as Record<string, string>).authorization).toBeUndefined();
        return new Response(
          JSON.stringify({
            userId: 'u1',
            email: 'a@example.com',
            displayName: 'Ada',
            accountKind: 'adult',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.endsWith('/refresh')) {
        expect(init?.credentials).toBe('include');
        expect(JSON.parse(String(init?.body))).toEqual({});
        return new Response(
          JSON.stringify({
            expiresIn: 3600,
            user: {
              userId: 'u1',
              email: 'a@example.com',
              displayName: 'Ada',
              accountKind: 'adult',
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      throw new Error(`unexpected ${url}`);
    });

    const session = new SessionService({
      baseUrl: 'http://127.0.0.1:3000/identity',
      refreshStore: new WebRefreshStore(),
      mode: 'web',
      fetch: fetchMock as unknown as typeof fetch,
    });

    await session.login({ email: 'a@example.com', password: 'Password1' });
    expect(session.isAuthenticated()).toBe(true);
    expect(session.getAccessToken()).toBeUndefined();
    expect(session.needsAccessRefresh()).toBe(false);
    expect(session.authorizationHeader()).toBeUndefined();
    await session.me();
    await session.refresh();
    expect(session.getAccessToken()).toBeUndefined();
    expect(session.isAuthenticated()).toBe(true);
  });

  it('ignores an access token a web response still carries', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          accessToken: 'stray',
          expiresIn: 3600,
          user: { userId: 'u1', email: 'a@example.com', displayName: 'Ada', accountKind: 'adult' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const session = new SessionService({
      baseUrl: 'http://127.0.0.1:3000/identity',
      refreshStore: new WebRefreshStore(),
      mode: 'web',
      fetch: fetchMock as unknown as typeof fetch,
    });
    await session.refresh();
    expect(session.getAccessToken()).toBeUndefined();
    expect(session.authorizationHeader()).toBeUndefined();
  });

  it('stores refresh token for native and sends it on refresh', async () => {
    const memory = new Map<string, string>();
    const store: RefreshStore = {
      get: async () => memory.get('refresh') ?? null,
      set: async (token) => {
        memory.set('refresh', token);
      },
      clear: async () => {
        memory.delete('refresh');
      },
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/login')) {
        expect((init?.headers as Record<string, string>)['x-refresh-delivery']).toBe('body');
        expect(init?.credentials).toBe('omit');
        return new Response(
          JSON.stringify({
            accessToken: 'access-n',
            expiresIn: 3600,
            refreshToken: 'refresh-n',
            user: {
              userId: 'u2',
              email: 'n@example.com',
              displayName: 'Ned',
              accountKind: 'adult',
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.endsWith('/refresh')) {
        expect(JSON.parse(String(init?.body))).toEqual({ refreshToken: 'refresh-n' });
        return new Response(
          JSON.stringify({
            accessToken: 'access-n2',
            expiresIn: 3600,
            refreshToken: 'refresh-n2',
            user: {
              userId: 'u2',
              email: 'n@example.com',
              displayName: 'Ned',
              accountKind: 'adult',
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      throw new Error(`unexpected ${url}`);
    });

    const session = new SessionService({
      baseUrl: 'http://127.0.0.1:3000/identity',
      refreshStore: store,
      mode: 'native',
      fetch: fetchMock as unknown as typeof fetch,
    });

    await session.login({ email: 'n@example.com', password: 'Password1' });
    expect(await store.get()).toBe('refresh-n');
    await session.refresh();
    expect(await store.get()).toBe('refresh-n2');
    expect(session.getAccessToken()).toBe('access-n2');
  });

  it('shares one refresh request among overlapping callers', async () => {
    let release!: (value: Response) => void;
    const held = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (!String(input).endsWith('/refresh')) throw new Error(`unexpected ${String(input)}`);
      return held;
    });
    const session = new SessionService({
      baseUrl: 'http://127.0.0.1:3000/identity',
      refreshStore: new WebRefreshStore(),
      mode: 'web',
      fetch: fetchMock as unknown as typeof fetch,
    });

    const first = session.refresh();
    const second = session.refresh();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    release(
      new Response(
        JSON.stringify({
          accessToken: 'access-shared',
          expiresIn: 3600,
          user: {
            userId: 'u1',
            email: 'a@example.com',
            displayName: 'Ada',
            accountKind: 'adult',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ accessToken: 'access-shared' }),
      expect.objectContaining({ accessToken: 'access-shared' }),
    ]);
    expect(session.isAuthenticated()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          accessToken: 'access-next',
          expiresIn: 3600,
          user: {
            userId: 'u1',
            email: 'a@example.com',
            displayName: 'Ada',
            accountKind: 'adult',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    await expect(session.refresh()).resolves.toEqual(expect.objectContaining({ accessToken: 'access-next' }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('lets a later refresh run after an overlapping refresh fails', async () => {
    let release!: (value: Response) => void;
    const held = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (!String(input).endsWith('/refresh')) throw new Error(`unexpected ${String(input)}`);
      return held;
    });
    const session = new SessionService({
      baseUrl: 'http://127.0.0.1:3000/identity',
      refreshStore: new WebRefreshStore(),
      mode: 'web',
      fetch: fetchMock as unknown as typeof fetch,
    });

    const first = session.refresh();
    const second = session.refresh();
    release(new Response(JSON.stringify({ error: 'invalid_token' }), { status: 401 }));
    await expect(first).rejects.toThrow('invalid_token');
    await expect(second).rejects.toThrow('invalid_token');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          accessToken: 'access-retry',
          expiresIn: 3600,
          user: {
            userId: 'u1',
            email: 'a@example.com',
            displayName: 'Ada',
            accountKind: 'adult',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    await expect(session.refresh()).resolves.toEqual(expect.objectContaining({ accessToken: 'access-retry' }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refreshes when the next request would fall inside the last five minutes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-17T12:00:00.000Z'));
    const user = {
      userId: 'u1',
      email: 'a@example.com',
      displayName: 'Ada',
      accountKind: 'adult' as const,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/login')) {
        return new Response(JSON.stringify({ expiresIn: 3600, user }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.endsWith('/refresh')) {
        return new Response(JSON.stringify({ expiresIn: 3600, user }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`unexpected ${url}`);
    });
    const session = new SessionService({
      baseUrl: 'http://127.0.0.1:3000/identity',
      refreshStore: new WebRefreshStore(),
      mode: 'web',
      fetch: fetchMock as unknown as typeof fetch,
    });

    try {
      await session.login({ email: 'a@example.com', password: 'Password1' });
      expect(session.needsAccessRefresh()).toBe(false);

      vi.setSystemTime(new Date(Date.now() + 3600 * 1000 - ACCESS_REFRESH_LEEWAY_MS - 1));
      expect(session.needsAccessRefresh()).toBe(false);

      vi.setSystemTime(new Date(Date.now() + 1));
      expect(session.needsAccessRefresh()).toBe(true);
      await session.refresh();
      expect(session.needsAccessRefresh()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
