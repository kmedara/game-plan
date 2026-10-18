/**
 * Device store list helper coverage.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryTable } from '../../lib/dynamo/memory-table.js';
import { TABLE_PK, TABLE_SK, deviceSk, userPk } from '../../lib/dynamo/keys.js';

const { store, itemKey } = memoryTable;

vi.mock('../../lib/dynamo/access.js', async () => (await import('../../lib/dynamo/memory-table.js')).memoryAccess);

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
