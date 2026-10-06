/**
 * Device store list helper coverage.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TABLE_PK, TABLE_SK, deviceSk, userPk } from '../../lib/dynamo/keys.js';

const store = new Map<string, Record<string, unknown>>();
const itemKey = (pk: string, sk: string): string => `${pk}\0${sk}`;

vi.mock('../../lib/dynamo/access.js', () => ({
  getItem: async <T extends Record<string, unknown>>(pk: string, sk: string) =>
    store.get(itemKey(pk, sk)) as T | undefined,
  putItem: async (item: Record<string, unknown>): Promise<void> => {
    store.set(itemKey(String(item[TABLE_PK]), String(item[TABLE_SK])), item);
  },
  deleteItem: async (pk: string, sk: string): Promise<void> => {
    store.delete(itemKey(pk, sk));
  },
  queryBySkPrefix: async <T extends Record<string, unknown>>(pk: string, skPrefix: string) => {
    const items: T[] = [];
    for (const [key, item] of store) {
      const [itemPk, itemSk] = key.split('\0');
      if (itemPk === pk && itemSk.startsWith(skPrefix)) items.push(item as T);
    }
    return items;
  },
  queryAll: async () => [],
  queryPage: async () => ({ items: [] }),
  queryPartition: async () => [],
  encodeCursor: () => undefined,
  decodeCursor: () => undefined,
}));

const { listDevicesForUser, putDevice } = await import('./device-store.js');

describe('device-store', () => {
  beforeEach(() => store.clear());
  afterEach(() => store.clear());

  it('lists devices registered for a user', async () => {
    await putDevice({
      userId: 'user-1',
      deviceId: 'phone',
      token: 'tok',
      platform: 'ios',
    });
    const devices = await listDevicesForUser('user-1');
    expect(devices).toHaveLength(1);
    expect(devices[0]?.deviceId).toBe('phone');
  });
});
