/**
 * Unit tests for native OAuth handoff codes.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TABLE_PK, TABLE_SK, handoffPk, handoffSk } from './dynamo/keys.js';

const store = new Map<string, Record<string, unknown>>();
const itemKey = (pk: string, sk: string): string => `${pk}\0${sk}`;

const send = vi.fn(
  async (command: {
    input?: {
      Item?: Record<string, unknown>;
      Key?: { PK?: string; SK?: string };
    };
  }) => {
    const input = command.input ?? {};
    if (input.Item !== undefined) {
      store.set(itemKey(String(input.Item[TABLE_PK]), String(input.Item[TABLE_SK])), input.Item);
      return {};
    }
    const key = input.Key;
    if (key?.PK === undefined || key.SK === undefined) return {};
    const existing = store.get(itemKey(key.PK, key.SK));
    if (existing === undefined) {
      const error = new Error('ConditionalCheckFailed');
      error.name = 'ConditionalCheckFailedException';
      throw error;
    }
    store.delete(itemKey(key.PK, key.SK));
    return { Attributes: existing };
  },
);

vi.mock('./dynamo/client.js', () => ({
  getDocClient: () => ({ send }),
  resetDocClient: () => undefined,
}));

const { issueOAuthHandoff, redeemOAuthHandoff } = await import('./oauth-handoff.js');

describe('oauth handoff', () => {
  beforeEach(() => {
    store.clear();
    send.mockReset();
    send.mockImplementation(
      async (command: {
        input?: {
          Item?: Record<string, unknown>;
          Key?: { PK?: string; SK?: string };
        };
      }) => {
        const input = command.input ?? {};
        if (input.Item !== undefined) {
          store.set(itemKey(String(input.Item[TABLE_PK]), String(input.Item[TABLE_SK])), input.Item);
          return {};
        }
        const key = input.Key;
        if (key?.PK === undefined || key.SK === undefined) return {};
        const existing = store.get(itemKey(key.PK, key.SK));
        if (existing === undefined) {
          const error = new Error('ConditionalCheckFailed');
          error.name = 'ConditionalCheckFailedException';
          throw error;
        }
        store.delete(itemKey(key.PK, key.SK));
        return { Attributes: existing };
      },
    );
  });

  it('redeems a code once and rejects the second use', async () => {
    const code = await issueOAuthHandoff('refresh-1', 'teams');
    expect(code.length).toBeGreaterThan(20);
    await expect(redeemOAuthHandoff(code)).resolves.toEqual({
      refreshToken: 'refresh-1',
      next: 'teams',
    });
    await expect(redeemOAuthHandoff(code)).resolves.toBeUndefined();
  });

  it('rejects an empty, missing, expired, or incomplete row', async () => {
    await expect(redeemOAuthHandoff('')).resolves.toBeUndefined();
    await expect(redeemOAuthHandoff('missing')).resolves.toBeUndefined();

    const expired = 'expired-code';
    store.set(itemKey(handoffPk(expired), handoffSk()), {
      [TABLE_PK]: handoffPk(expired),
      [TABLE_SK]: handoffSk(),
      refreshToken: 'refresh',
      next: 'teams',
      ttl: Math.floor(Date.now() / 1000) - 1,
    });
    await expect(redeemOAuthHandoff(expired)).resolves.toBeUndefined();

    store.set(itemKey(handoffPk('blank'), handoffSk()), {
      [TABLE_PK]: handoffPk('blank'),
      [TABLE_SK]: handoffSk(),
      refreshToken: '',
      next: 'teams',
      ttl: Math.floor(Date.now() / 1000) + 60,
    });
    await expect(redeemOAuthHandoff('blank')).resolves.toBeUndefined();

    store.set(itemKey(handoffPk('bad-next'), handoffSk()), {
      [TABLE_PK]: handoffPk('bad-next'),
      [TABLE_SK]: handoffSk(),
      refreshToken: 'refresh',
      next: 'elsewhere',
      ttl: Math.floor(Date.now() / 1000) + 60,
    });
    await expect(redeemOAuthHandoff('bad-next')).resolves.toBeUndefined();

    send.mockResolvedValueOnce({});
    await expect(redeemOAuthHandoff('ghost')).resolves.toBeUndefined();

    send.mockResolvedValueOnce({
      Attributes: { refreshToken: 4, next: 'teams', ttl: Math.floor(Date.now() / 1000) + 60 },
    });
    await expect(redeemOAuthHandoff('numeric')).resolves.toBeUndefined();

    store.set(itemKey(handoffPk('no-ttl'), handoffSk()), {
      [TABLE_PK]: handoffPk('no-ttl'),
      [TABLE_SK]: handoffSk(),
      refreshToken: 'refresh-3',
      next: 'complete-profile',
    });
    await expect(redeemOAuthHandoff('no-ttl')).resolves.toEqual({
      refreshToken: 'refresh-3',
      next: 'complete-profile',
    });

    send.mockRejectedValueOnce(new Error('throttled'));
    await expect(redeemOAuthHandoff('again')).rejects.toThrow('throttled');
  });
});
