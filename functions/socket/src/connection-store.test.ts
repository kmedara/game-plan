/**
 * Connection store list helper coverage.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryTable } from '../../lib/dynamo/memory-table.js';
import { TABLE_PK, TABLE_SK, connectionSk, userPk } from '../../lib/dynamo/keys.js';

const { store, itemKey } = memoryTable;

vi.mock('../../lib/dynamo/access.js', async () => (await import('../../lib/dynamo/memory-table.js')).memoryAccess);

vi.mock('../../lib/dynamo/client.js', () => ({
  getDocClient: () => ({ send: async () => ({ Items: [] }) }),
  resetDocClient: (): void => undefined,
}));

const { listConnectionsForUser, putConnection } = await import('./connection-store.js');

describe('connection-store', () => {
  beforeEach(() => store.clear());
  afterEach(() => store.clear());

  it('lists connections for a user', async () => {
    await putConnection('user-1', 'conn-a');
    await putConnection('user-1', 'conn-b');
    const rows = await listConnectionsForUser('user-1');
    expect(rows.map((row) => row.connectionId).sort()).toEqual(['conn-a', 'conn-b']);
    expect(store.has(itemKey(userPk('user-1'), connectionSk('conn-a')))).toBe(true);
  });
});
