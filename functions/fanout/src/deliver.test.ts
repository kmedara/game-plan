/**
 * Fan-out job parsing and delivery smoke coverage.
 */

import { describe, expect, it, vi } from 'vitest';
import { parseFanoutJob } from './deliver.js';

vi.mock('../../lib/dynamo/access.js', () => ({
  queryBySkPrefix: async () => [],
}));

describe('parseFanoutJob', () => {
  it('accepts a chat message job', () => {
    expect(
      parseFanoutJob({
        type: 'chat_message',
        chatId: 'c1',
        messageId: 'm1',
        senderId: 'u1',
        body: 'hello',
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toMatchObject({ type: 'chat_message', chatId: 'c1' });
  });

  it('rejects an unknown shape', () => {
    expect(parseFanoutJob({ type: 'nope' })).toBeUndefined();
  });
});
