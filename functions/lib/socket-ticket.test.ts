/**
 * Unit tests for one-time WebSocket connect tickets.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TABLE_PK, TABLE_SK, ticketPk, ticketSk } from './dynamo/keys.js';

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

const { issueSocketTicket, redeemSocketTicket } = await import('./socket-ticket.js');

describe('socket ticket', () => {
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

  it('redeems a ticket once and rejects the second use', async () => {
    const issued = await issueSocketTicket('user-1');
    expect(issued.expiresIn).toBe(60);
    expect(issued.ticket.length).toBeGreaterThan(20);

    await expect(redeemSocketTicket(issued.ticket)).resolves.toBe('user-1');
    await expect(redeemSocketTicket(issued.ticket)).resolves.toBeUndefined();
    expect(store.size).toBe(0);
  });

  it('rejects an empty, missing, or expired ticket', async () => {
    await expect(redeemSocketTicket('')).resolves.toBeUndefined();
    await expect(redeemSocketTicket('missing')).resolves.toBeUndefined();

    const ticket = 'expired-ticket';
    store.set(itemKey(ticketPk(ticket), ticketSk()), {
      [TABLE_PK]: ticketPk(ticket),
      [TABLE_SK]: ticketSk(),
      userId: 'user-1',
      ttl: Math.floor(Date.now() / 1000) - 1,
    });
    await expect(redeemSocketTicket(ticket)).resolves.toBeUndefined();
    expect(store.has(itemKey(ticketPk(ticket), ticketSk()))).toBe(false);
  });

  it('rejects a ticket row that has no user id and rethrows unexpected deletes', async () => {
    store.set(itemKey(ticketPk('blank'), ticketSk()), {
      [TABLE_PK]: ticketPk('blank'),
      [TABLE_SK]: ticketSk(),
      userId: '',
      ttl: Math.floor(Date.now() / 1000) + 60,
    });
    await expect(redeemSocketTicket('blank')).resolves.toBeUndefined();

    send.mockResolvedValueOnce({});
    await expect(redeemSocketTicket('ghost')).resolves.toBeUndefined();

    send.mockResolvedValueOnce({
      Attributes: { userId: 4, ttl: Math.floor(Date.now() / 1000) + 60 },
    });
    await expect(redeemSocketTicket('numeric')).resolves.toBeUndefined();

    store.set(itemKey(ticketPk('no-ttl'), ticketSk()), {
      [TABLE_PK]: ticketPk('no-ttl'),
      [TABLE_SK]: ticketSk(),
      userId: 'user-3',
    });
    await expect(redeemSocketTicket('no-ttl')).resolves.toBe('user-3');

    send.mockRejectedValueOnce(new Error('throttled'));
    await expect(redeemSocketTicket('again')).rejects.toThrow('throttled');
  });

  it('writes the ticket under the ticket partition', async () => {
    const issued = await issueSocketTicket('user-2');
    const item = store.get(itemKey(ticketPk(issued.ticket), ticketSk()));
    expect(item).toMatchObject({
      [TABLE_PK]: ticketPk(issued.ticket),
      [TABLE_SK]: ticketSk(),
      userId: 'user-2',
    });
    expect(item?.ttl).toEqual(expect.any(Number));
  });
});
