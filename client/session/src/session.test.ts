/**
 * Unit tests for the client session service and refresh stores.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  CapacitorRefreshStore,
  SessionService,
  WebRefreshStore,
  type PreferencesLike,
} from './index.js';

describe('WebRefreshStore', () => {
  it('never persists a readable refresh token', async () => {
    const store = new WebRefreshStore();
    await store.set('secret');
    expect(await store.get()).toBeNull();
    await store.clear();
    expect(await store.get()).toBeNull();
  });
});

describe('CapacitorRefreshStore', () => {
  it('reads and writes through Preferences', async () => {
    const memory = new Map<string, string>();
    const preferences: PreferencesLike = {
      get: async ({ key }) => ({ value: memory.get(key) ?? null }),
      set: async ({ key, value }) => {
        memory.set(key, value);
      },
      remove: async ({ key }) => {
        memory.delete(key);
      },
    };
    const store = new CapacitorRefreshStore(preferences);
    await store.set('rt-1');
    expect(await store.get()).toBe('rt-1');
    await store.clear();
    expect(await store.get()).toBeNull();
  });
});

describe('SessionService', () => {
  it('keeps access token in memory and uses cookies on web', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/login')) {
        expect(init?.credentials).toBe('include');
        expect((init?.headers as Record<string, string>)['x-refresh-delivery']).toBeUndefined();
        return new Response(
          JSON.stringify({
            accessToken: 'access-1',
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
        expect((init?.headers as Record<string, string>).authorization).toBe('Bearer access-1');
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
            accessToken: 'access-2',
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
    expect(session.getAccessToken()).toBe('access-1');
    expect(session.authorizationHeader()).toBe('Bearer access-1');
    await session.me();
    await session.refresh();
    expect(session.getAccessToken()).toBe('access-2');
  });

  it('stores refresh token for native and sends it on refresh', async () => {
    const memory = new Map<string, string>();
    const preferences: PreferencesLike = {
      get: async ({ key }) => ({ value: memory.get(key) ?? null }),
      set: async ({ key, value }) => {
        memory.set(key, value);
      },
      remove: async ({ key }) => {
        memory.delete(key);
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

    const store = new CapacitorRefreshStore(preferences);
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
});
