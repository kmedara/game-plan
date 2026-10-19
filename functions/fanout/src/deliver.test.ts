/**
 * Fan-out job parsing and delivery coverage.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHAT_MEMBER_SK_PREFIX,
  CONNECTION_SK_PREFIX,
  DEVICE_SK_PREFIX,
  ROLE_PERMISSIONS_SK_PREFIX,
  TEAM_MEMBER_SK_PREFIX,
  chatPk,
  connectionSk,
  teamPk,
  userPk,
} from '../../lib/dynamo/keys.js';

const {
  queryBySkPrefix,
  deleteItem,
  enqueueFanout,
  managementSend,
  snsSend,
  sendDevicePushes,
  ApiGatewayManagementApiClientMock,
} = vi.hoisted(() => ({
  queryBySkPrefix: vi.fn(),
  deleteItem: vi.fn(),
  enqueueFanout: vi.fn(),
  managementSend: vi.fn(),
  snsSend: vi.fn(),
  sendDevicePushes: vi.fn(),
  ApiGatewayManagementApiClientMock: vi.fn(function ApiGatewayManagementApiClient(this: {
    send: typeof managementSend;
  }) {
    this.send = managementSend;
  }),
}));

vi.mock('../../lib/dynamo/access.js', () => ({
  queryBySkPrefix: (...args: unknown[]) => queryBySkPrefix(...args),
  deleteItem: (...args: unknown[]) => deleteItem(...args),
}));

vi.mock('../../lib/fanout-enqueue.js', () => ({
  enqueueFanout: (...args: unknown[]) => enqueueFanout(...args),
}));

vi.mock('@aws-sdk/client-apigatewaymanagementapi', () => {
  class GoneException extends Error {
    override name = 'GoneException';
  }
  return {
    ApiGatewayManagementApiClient: ApiGatewayManagementApiClientMock,
    GoneException,
    PostToConnectionCommand: vi.fn((input: unknown) => ({ input })),
  };
});

vi.mock('./push-send.js', () => ({
  sendDevicePushes: (...args: unknown[]) => sendDevicePushes(...args),
}));

vi.mock('@aws-sdk/client-sns', () => ({
  SNSClient: vi.fn(function SNSClient(this: { send: typeof snsSend }) {
    this.send = snsSend;
  }),
  PublishCommand: vi.fn((input: unknown) => ({ input })),
}));

const chatJob = {
  type: 'chat_message' as const,
  chatId: 'c1',
  messageId: 'm1',
  senderId: 'u1',
  body: 'hello world',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const scheduleJob = {
  type: 'schedule_changed' as const,
  teamId: 't1',
  eventId: 'e1',
};

const { deliverFanoutJob, parseFanoutJob, resetFanoutClients } = await import('./deliver.js');
const { GoneException } = await import('@aws-sdk/client-apigatewaymanagementapi');
const { ApiGatewayManagementApiClient } = await import('@aws-sdk/client-apigatewaymanagementapi');
const { SNSClient } = await import('@aws-sdk/client-sns');

describe('parseFanoutJob', () => {
  it('accepts a chat message job', () => {
    expect(parseFanoutJob(chatJob)).toMatchObject({ type: 'chat_message', chatId: 'c1' });
  });

  it('rejects an unknown shape', () => {
    expect(parseFanoutJob({ type: 'nope' })).toBeUndefined();
  });

  it('accepts a throttle slice and rejects an attempt past the cap', () => {
    expect(parseFanoutJob({ ...chatJob, userIds: ['u2'], attempt: 1 })).toMatchObject({
      userIds: ['u2'],
      attempt: 1,
    });
    expect(parseFanoutJob({ ...chatJob, attempt: 6 })).toBeUndefined();
  });
});

describe('deliverFanoutJob', () => {
  beforeEach(() => {
    queryBySkPrefix.mockReset();
    deleteItem.mockReset();
    deleteItem.mockResolvedValue(undefined);
    enqueueFanout.mockReset();
    enqueueFanout.mockResolvedValue(undefined);
    managementSend.mockReset();
    snsSend.mockReset();
    sendDevicePushes.mockReset();
    sendDevicePushes.mockResolvedValue([]);
    ApiGatewayManagementApiClientMock.mockClear();
    vi.mocked(SNSClient).mockClear();
    delete process.env.WEBSOCKET_CALLBACK_URL;
    delete process.env.PUSH_TOPIC_ARN;
    delete process.env.AWS_REGION;
    delete process.env.FANOUT_QUEUE_URL;
    delete process.env.FANOUT_DELIVER_URL;
    resetFanoutClients();
  });

  afterEach(() => {
    resetFanoutClients();
    vi.restoreAllMocks();
  });

  it('loads chat_message recipients from chat members', async () => {
    queryBySkPrefix.mockImplementation(async (pk: string, prefix: string) => {
      if (pk === chatPk('c1') && prefix === CHAT_MEMBER_SK_PREFIX) {
        return [{ userId: 'u1' }, { userId: 'u2' }];
      }
      return [];
    });
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await deliverFanoutJob(chatJob);

    expect(queryBySkPrefix).toHaveBeenCalledWith(chatPk('c1'), CHAT_MEMBER_SK_PREFIX);
    expect(queryBySkPrefix).toHaveBeenCalledWith(userPk('u1'), CONNECTION_SK_PREFIX);
    expect(queryBySkPrefix).toHaveBeenCalledWith(userPk('u2'), CONNECTION_SK_PREFIX);
    expect(info).toHaveBeenCalled();
    info.mockRestore();
  });

  it('deduplicates chat member user ids', async () => {
    queryBySkPrefix.mockImplementation(async (pk: string, prefix: string) => {
      if (pk === chatPk('c1') && prefix === CHAT_MEMBER_SK_PREFIX) {
        return [{ userId: 'u1' }, { userId: 'u1' }];
      }
      if (prefix === CONNECTION_SK_PREFIX) return [];
      if (prefix === DEVICE_SK_PREFIX) return [];
      return [];
    });
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await deliverFanoutJob(chatJob);

    const connectionCalls = queryBySkPrefix.mock.calls.filter(
      ([, skPrefix]) => skPrefix === CONNECTION_SK_PREFIX,
    );
    expect(connectionCalls).toHaveLength(1);
    info.mockRestore();
  });

  it('loads schedule_changed recipients from team members', async () => {
    queryBySkPrefix.mockImplementation(async (pk: string, prefix: string) => {
      if (pk === teamPk('t1') && prefix === TEAM_MEMBER_SK_PREFIX) {
        return [{ userId: 'u9' }];
      }
      return [];
    });
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await deliverFanoutJob(scheduleJob);

    expect(queryBySkPrefix).toHaveBeenCalledWith(teamPk('t1'), TEAM_MEMBER_SK_PREFIX);
    expect(queryBySkPrefix).toHaveBeenCalledWith(userPk('u9'), CONNECTION_SK_PREFIX);
    info.mockRestore();
  });

  it('posts to an open connection when WEBSOCKET_CALLBACK_URL is set', async () => {
    process.env.WEBSOCKET_CALLBACK_URL = 'https://abc.execute-api.us-east-1.amazonaws.com/prod';
    process.env.AWS_REGION = 'us-west-2';
    queryBySkPrefix.mockImplementation(async (pk: string, prefix: string) => {
      if (pk === chatPk('c1') && prefix === CHAT_MEMBER_SK_PREFIX) return [{ userId: 'u1' }];
      if (pk === userPk('u1') && prefix === CONNECTION_SK_PREFIX) {
        return [{ connectionId: 'conn-1' }];
      }
      return [];
    });
    managementSend.mockResolvedValue(undefined);

    await deliverFanoutJob(chatJob);

    expect(ApiGatewayManagementApiClientMock).toHaveBeenCalledWith({
      endpoint: process.env.WEBSOCKET_CALLBACK_URL,
      region: 'us-west-2',
    });
    expect(managementSend).toHaveBeenCalledTimes(1);
    expect(snsSend).not.toHaveBeenCalled();
  });

  it('uses local credentials for a localhost management endpoint', async () => {
    process.env.WEBSOCKET_CALLBACK_URL = 'http://localhost:4001';
    queryBySkPrefix.mockImplementation(async (pk: string, prefix: string) => {
      if (pk === chatPk('c1') && prefix === CHAT_MEMBER_SK_PREFIX) return [{ userId: 'u1' }];
      if (pk === userPk('u1') && prefix === CONNECTION_SK_PREFIX) {
        return [{ connectionId: 'conn-local' }];
      }
      return [];
    });
    managementSend.mockResolvedValue(undefined);

    await deliverFanoutJob(chatJob);

    expect(ApiGatewayManagementApiClientMock).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: 'http://localhost:4001',
        credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
        requestHandler: undefined,
      }),
    );
  });

  it('uses local credentials for a 127.0.0.1 management endpoint', async () => {
    process.env.WEBSOCKET_CALLBACK_URL = 'http://127.0.0.1:4001';
    queryBySkPrefix.mockImplementation(async (pk: string, prefix: string) => {
      if (pk === chatPk('c1') && prefix === CHAT_MEMBER_SK_PREFIX) return [{ userId: 'u1' }];
      if (pk === userPk('u1') && prefix === CONNECTION_SK_PREFIX) {
        return [{ connectionId: 'conn-local' }];
      }
      return [];
    });
    managementSend.mockResolvedValue(undefined);

    await deliverFanoutJob(chatJob);

    expect(ApiGatewayManagementApiClientMock).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: 'http://127.0.0.1:4001',
        credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
      }),
    );
  });

  it('ignores GoneException without logging a warning', async () => {
    process.env.WEBSOCKET_CALLBACK_URL = 'https://ws.example.com';
    queryBySkPrefix.mockImplementation(async (pk: string, prefix: string) => {
      if (pk === chatPk('c1') && prefix === CHAT_MEMBER_SK_PREFIX) return [{ userId: 'u1' }];
      if (pk === userPk('u1') && prefix === CONNECTION_SK_PREFIX) {
        return [{ connectionId: 'gone-1' }];
      }
      if (pk === userPk('u1') && prefix === DEVICE_SK_PREFIX) return [];
      return [];
    });
    managementSend.mockRejectedValue(new GoneException({ message: 'gone', $metadata: {} }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await deliverFanoutJob(chatJob);

    expect(warn).not.toHaveBeenCalled();
    expect(deleteItem).toHaveBeenCalledWith(userPk('u1'), connectionSk('gone-1'));
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining('"event":"push_skipped"'),
    );
    warn.mockRestore();
    info.mockRestore();
  });

  it('ignores generic errors whose name is GoneException', async () => {
    process.env.WEBSOCKET_CALLBACK_URL = 'https://ws.example.com';
    queryBySkPrefix.mockImplementation(async (pk: string, prefix: string) => {
      if (pk === chatPk('c1') && prefix === CHAT_MEMBER_SK_PREFIX) return [{ userId: 'u1' }];
      if (pk === userPk('u1') && prefix === CONNECTION_SK_PREFIX) {
        return [{ connectionId: 'gone-2' }];
      }
      if (pk === userPk('u1') && prefix === DEVICE_SK_PREFIX) return [];
      return [];
    });
    managementSend.mockRejectedValue({ name: 'GoneException', message: 'stale' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await deliverFanoutJob(chatJob);

    expect(warn).not.toHaveBeenCalled();
    expect(deleteItem).toHaveBeenCalledWith(userPk('u1'), connectionSk('gone-2'));
    info.mockRestore();
    warn.mockRestore();
  });

  it('ignores generic errors whose name includes Gone', async () => {
    process.env.WEBSOCKET_CALLBACK_URL = 'https://ws.example.com';
    queryBySkPrefix.mockImplementation(async (pk: string, prefix: string) => {
      if (pk === chatPk('c1') && prefix === CHAT_MEMBER_SK_PREFIX) return [{ userId: 'u1' }];
      if (pk === userPk('u1') && prefix === CONNECTION_SK_PREFIX) {
        return [{ connectionId: 'gone-3' }];
      }
      if (pk === userPk('u1') && prefix === DEVICE_SK_PREFIX) return [];
      return [];
    });
    managementSend.mockRejectedValue({ name: 'SomethingGoneWrong', message: '410' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await deliverFanoutJob(chatJob);

    expect(warn).not.toHaveBeenCalled();
    expect(deleteItem).toHaveBeenCalledWith(userPk('u1'), connectionSk('gone-3'));
    info.mockRestore();
    warn.mockRestore();
  });

  it('logs and continues when the post error has no name property', async () => {
    process.env.WEBSOCKET_CALLBACK_URL = 'https://ws.example.com';
    queryBySkPrefix.mockImplementation(async (pk: string, prefix: string) => {
      if (pk === chatPk('c1') && prefix === CHAT_MEMBER_SK_PREFIX) return [{ userId: 'u1' }];
      if (pk === userPk('u1') && prefix === CONNECTION_SK_PREFIX) {
        return [{ connectionId: 'primitive-err' }];
      }
      if (pk === userPk('u1') && prefix === DEVICE_SK_PREFIX) return [];
      return [];
    });
    managementSend.mockRejectedValue('socket reset');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await deliverFanoutJob(chatJob);

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('"error":"socket reset"'),
    );
    warn.mockRestore();
    info.mockRestore();
  });

  it('treats an empty WEBSOCKET_CALLBACK_URL as unset', async () => {
    process.env.WEBSOCKET_CALLBACK_URL = '';
    queryBySkPrefix.mockImplementation(async (pk: string, prefix: string) => {
      if (pk === chatPk('c1') && prefix === CHAT_MEMBER_SK_PREFIX) return [{ userId: 'u1' }];
      if (prefix === CONNECTION_SK_PREFIX) return [{ connectionId: 'c1' }];
      if (prefix === DEVICE_SK_PREFIX) return [];
      return [];
    });
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await deliverFanoutJob(chatJob);

    expect(ApiGatewayManagementApiClientMock).not.toHaveBeenCalled();
    info.mockRestore();
  });

  it('treats an empty PUSH_TOPIC_ARN as missing', async () => {
    process.env.PUSH_TOPIC_ARN = '';
    queryBySkPrefix.mockImplementation(async (pk: string, prefix: string) => {
      if (pk === chatPk('c1') && prefix === CHAT_MEMBER_SK_PREFIX) return [{ userId: 'u1' }];
      if (prefix === CONNECTION_SK_PREFIX) return [];
      if (prefix === DEVICE_SK_PREFIX) {
        return [{ deviceId: 'd1', token: 't', platform: 'ios' }];
      }
      return [];
    });
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await deliverFanoutJob(chatJob);

    expect(info).toHaveBeenCalledWith(expect.stringContaining('"reason":"no_topic"'));
    expect(snsSend).not.toHaveBeenCalled();
    info.mockRestore();
  });

  it('defaults the management client region when AWS_REGION is unset', async () => {
    process.env.WEBSOCKET_CALLBACK_URL = 'https://ws.example.com';
    queryBySkPrefix.mockImplementation(async (pk: string, prefix: string) => {
      if (pk === chatPk('c1') && prefix === CHAT_MEMBER_SK_PREFIX) return [{ userId: 'u1' }];
      if (pk === userPk('u1') && prefix === CONNECTION_SK_PREFIX) {
        return [{ connectionId: 'c-reg' }];
      }
      return [];
    });
    managementSend.mockResolvedValue(undefined);

    await deliverFanoutJob(chatJob);

    expect(ApiGatewayManagementApiClientMock).toHaveBeenCalledWith(
      expect.objectContaining({ region: 'us-east-1' }),
    );
  });

  it('logs and continues on other post errors', async () => {
    process.env.WEBSOCKET_CALLBACK_URL = 'https://ws.example.com';
    queryBySkPrefix.mockImplementation(async (pk: string, prefix: string) => {
      if (pk === chatPk('c1') && prefix === CHAT_MEMBER_SK_PREFIX) return [{ userId: 'u1' }];
      if (pk === userPk('u1') && prefix === CONNECTION_SK_PREFIX) {
        return [{ connectionId: 'bad-1' }, { connectionId: 'ok-1' }];
      }
      if (pk === userPk('u1') && prefix === DEVICE_SK_PREFIX) return [];
      return [];
    });
    managementSend.mockImplementation(async (command: { input?: { ConnectionId?: string } }) => {
      if (command.input?.ConnectionId === 'bad-1') throw new Error('network down');
      return undefined;
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await deliverFanoutJob(chatJob);

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('"event":"post_failed"'),
    );
    expect(managementSend).toHaveBeenCalledTimes(2);
    expect(info).not.toHaveBeenCalled();
    warn.mockRestore();
    info.mockRestore();
  });

  it('falls through to push when no management client is configured', async () => {
    queryBySkPrefix.mockImplementation(async (pk: string, prefix: string) => {
      if (pk === chatPk('c1') && prefix === CHAT_MEMBER_SK_PREFIX) return [{ userId: 'u1' }];
      if (pk === userPk('u1') && prefix === CONNECTION_SK_PREFIX) {
        return [{ connectionId: 'conn-1' }];
      }
      if (pk === userPk('u1') && prefix === DEVICE_SK_PREFIX) return [];
      return [];
    });
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await deliverFanoutJob(chatJob);

    expect(ApiGatewayManagementApiClientMock).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining('"reason":"no_topic"'),
    );
    info.mockRestore();
  });

  it('skips push when the topic is missing', async () => {
    queryBySkPrefix.mockImplementation(async (pk: string, prefix: string) => {
      if (pk === chatPk('c1') && prefix === CHAT_MEMBER_SK_PREFIX) return [{ userId: 'u1' }];
      if (prefix === CONNECTION_SK_PREFIX) return [];
      if (prefix === DEVICE_SK_PREFIX) return [{ deviceId: 'd1', token: 't', platform: 'ios' }];
      return [];
    });
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await deliverFanoutJob(chatJob);

    expect(info).toHaveBeenCalledWith(
      expect.stringContaining('"reason":"no_topic"'),
    );
    expect(snsSend).not.toHaveBeenCalled();
    info.mockRestore();
  });

  it('skips push when the user has no devices', async () => {
    process.env.PUSH_TOPIC_ARN = 'arn:aws:sns:us-east-1:123:push';
    queryBySkPrefix.mockImplementation(async (pk: string, prefix: string) => {
      if (pk === chatPk('c1') && prefix === CHAT_MEMBER_SK_PREFIX) return [{ userId: 'u1' }];
      if (prefix === CONNECTION_SK_PREFIX) return [];
      if (prefix === DEVICE_SK_PREFIX) return [];
      return [];
    });
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await deliverFanoutJob(chatJob);

    expect(info).toHaveBeenCalledWith(
      expect.stringContaining('"reason":"no_devices"'),
    );
    expect(snsSend).not.toHaveBeenCalled();
    info.mockRestore();
  });

  it('publishes push for chat_message when topic and devices exist', async () => {
    process.env.PUSH_TOPIC_ARN = 'arn:aws:sns:us-east-1:123:push';
    queryBySkPrefix.mockImplementation(async (pk: string, prefix: string) => {
      if (pk === chatPk('c1') && prefix === CHAT_MEMBER_SK_PREFIX) return [{ userId: 'u1' }];
      if (prefix === CONNECTION_SK_PREFIX) return [];
      if (pk === userPk('u1') && prefix === DEVICE_SK_PREFIX) {
        return [{ deviceId: 'dev-1', token: 'tok', platform: 'android' }];
      }
      return [];
    });
    snsSend.mockResolvedValue(undefined);

    await deliverFanoutJob(chatJob);

    expect(snsSend).toHaveBeenCalledTimes(1);
    const command = snsSend.mock.calls[0]?.[0] as { input?: { Subject?: string; Message?: string } };
    expect(command.input?.Subject).toBe('New message');
    const message = JSON.parse(command.input?.Message ?? '{}') as { body?: string; title?: string };
    expect(message.title).toBe('New message');
    expect(message.body).toBe('hello world');
  });

  it('publishes push for schedule_changed when topic and devices exist', async () => {
    process.env.PUSH_TOPIC_ARN = 'arn:aws:sns:us-east-1:123:push';
    queryBySkPrefix.mockImplementation(async (pk: string, prefix: string) => {
      if (pk === teamPk('t1') && prefix === TEAM_MEMBER_SK_PREFIX) return [{ userId: 'u1' }];
      if (prefix === CONNECTION_SK_PREFIX) return [];
      if (pk === userPk('u1') && prefix === DEVICE_SK_PREFIX) {
        return [{ deviceId: 'dev-2', token: 'tok2', platform: 'ios' }];
      }
      return [];
    });
    snsSend.mockResolvedValue(undefined);

    await deliverFanoutJob(scheduleJob);

    expect(snsSend).not.toHaveBeenCalled();
    expect(sendDevicePushes).not.toHaveBeenCalled();
  });

  it('does not push event_moved when a socket accepts the event', async () => {
    process.env.WEBSOCKET_CALLBACK_URL = 'https://ws.example.com';
    process.env.PUSH_TOPIC_ARN = 'arn:aws:sns:us-east-1:123:push';
    queryBySkPrefix.mockImplementation(async (pk: string, prefix: string) => {
      if (pk === teamPk('t1') && prefix === TEAM_MEMBER_SK_PREFIX) return [{ userId: 'u1' }];
      if (pk === userPk('u1') && prefix === CONNECTION_SK_PREFIX) return [{ connectionId: 'conn-1' }];
      if (pk === userPk('u1') && prefix === DEVICE_SK_PREFIX) {
        return [{ deviceId: 'dev-2', token: 'tok2', platform: 'ios' }];
      }
      return [];
    });
    managementSend.mockResolvedValue(undefined);

    await deliverFanoutJob({
      type: 'event_moved',
      teamId: 't1',
      eventId: 'e1',
      title: 'Saturday game',
      change: 'location',
    });

    expect(managementSend).toHaveBeenCalledTimes(1);
    expect(queryBySkPrefix).not.toHaveBeenCalledWith(userPk('u1'), DEVICE_SK_PREFIX);
    expect(sendDevicePushes).not.toHaveBeenCalled();
    expect(snsSend).not.toHaveBeenCalled();
  });

  it('pushes event_moved when no socket is open', async () => {
    process.env.PUSH_TOPIC_ARN = 'arn:aws:sns:us-east-1:123:push';
    queryBySkPrefix.mockImplementation(async (pk: string, prefix: string) => {
      if (pk === teamPk('t1') && prefix === TEAM_MEMBER_SK_PREFIX) return [{ userId: 'u1' }];
      if (prefix === CONNECTION_SK_PREFIX) return [];
      if (pk === userPk('u1') && prefix === DEVICE_SK_PREFIX) {
        return [{ deviceId: 'dev-2', token: 'tok2', platform: 'ios' }];
      }
      return [];
    });
    snsSend.mockResolvedValue(undefined);

    await deliverFanoutJob({
      type: 'event_moved',
      teamId: 't1',
      eventId: 'e1',
      title: 'Saturday game',
      change: 'location',
    });

    expect(sendDevicePushes).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Saturday game',
        body: 'Saturday game location changed',
      }),
    );
  });

  it('pushes a join request to approvers even when a socket is open', async () => {
    process.env.WEBSOCKET_CALLBACK_URL = 'https://ws.example.com';
    queryBySkPrefix.mockImplementation(async (pk: string, prefix: string) => {
      if (pk === teamPk('t1') && prefix === TEAM_MEMBER_SK_PREFIX) {
        return [
          { userId: 'admin', role: 'team_admin' },
          { userId: 'coach', role: 'coach' },
        ];
      }
      if (pk === teamPk('t1') && prefix === ROLE_PERMISSIONS_SK_PREFIX) {
        return [
          { role: 'team_admin', permissions: ['approve_join_requests'] },
          { role: 'coach', permissions: ['manage_events'] },
        ];
      }
      if (pk === userPk('admin') && prefix === CONNECTION_SK_PREFIX) {
        return [{ connectionId: 'conn-admin' }];
      }
      if (pk === userPk('admin') && prefix === DEVICE_SK_PREFIX) {
        return [{ deviceId: 'phone', token: 'ExponentPushToken[abc]', platform: 'ios' }];
      }
      return [];
    });
    managementSend.mockResolvedValue(undefined);

    await deliverFanoutJob({
      type: 'join_requested',
      teamId: 't1',
      requestId: 'r1',
      teamName: 'Hawks',
      requesterDisplayName: 'Ada',
    });

    expect(managementSend).toHaveBeenCalledTimes(1);
    expect(queryBySkPrefix).not.toHaveBeenCalledWith(userPk('coach'), CONNECTION_SK_PREFIX);
    expect(sendDevicePushes).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Join request',
        body: 'Ada asked to join Hawks',
      }),
    );
  });

  it('pushes dues reminders and payment receipts to the listed users only', async () => {
    process.env.WEBSOCKET_CALLBACK_URL = 'https://ws.example.com';
    queryBySkPrefix.mockImplementation(async (pk: string, prefix: string) => {
      if (prefix === CONNECTION_SK_PREFIX) return [{ connectionId: `conn-${pk}` }];
      if (prefix === DEVICE_SK_PREFIX) return [{ deviceId: 'phone', token: 'ExponentPushToken[abc]', platform: 'ios' }];
      return [{ userId: 'roster-should-not-load' }];
    });
    managementSend.mockResolvedValue(undefined);

    await deliverFanoutJob({
      type: 'dues_reminder',
      teamId: 't1',
      chargeId: 'c1',
      title: 'Spring dues',
      amountCents: 4500,
      currency: 'usd',
      dueDate: '2030-03-10',
      kind: 'upcoming',
      userIds: ['parent'],
    });
    await deliverFanoutJob({
      type: 'payment_received',
      teamId: 't1',
      chargeId: 'c1',
      memberId: 'kid',
      title: 'Spring dues',
      amountCents: 4500,
      currency: 'usd',
      memberDisplayName: 'Mo',
      userIds: ['coach'],
    });

    expect(queryBySkPrefix).not.toHaveBeenCalledWith(teamPk('t1'), TEAM_MEMBER_SK_PREFIX);
    expect(sendDevicePushes).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Payment reminder', body: 'Spring dues · $45.00 is due 2030-03-10' }),
    );
    expect(sendDevicePushes).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Payment received', body: 'Mo paid $45.00 for Spring dues' }),
    );
  });

  it('forgets devices the push service reports gone', async () => {
    queryBySkPrefix.mockImplementation(async (pk: string, prefix: string) => {
      if (prefix === CONNECTION_SK_PREFIX) return [];
      if (pk === userPk('u1') && prefix === DEVICE_SK_PREFIX) {
        return [
          { deviceId: 'web-live', token: '{}', platform: 'web' },
          { deviceId: 'web-dead', token: '{}', platform: 'web' },
        ];
      }
      return [];
    });
    sendDevicePushes.mockImplementationOnce(async ({ devices }: { devices: { deviceId: string }[] }) =>
      devices.filter((device) => device.deviceId === 'web-dead'),
    );
    vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await deliverFanoutJob({
      type: 'event_reminder',
      teamId: 't1',
      eventId: 'e1',
      title: 'Practice',
      occurrenceStartsAt: '2026-01-02T15:00:00.000Z',
      kind: 'hour',
      userIds: ['u1'],
    });

    expect(deleteItem).toHaveBeenCalledTimes(1);
    expect(deleteItem).toHaveBeenCalledWith(userPk('u1'), 'DEVICE#web-dead');
  });

  it('delivers an event reminder without loading the roster', async () => {
    queryBySkPrefix.mockImplementation(async (pk: string, prefix: string) => {
      if (pk === userPk('u1') && prefix === CONNECTION_SK_PREFIX) return [];
      if (prefix === DEVICE_SK_PREFIX) return [];
      return [{ userId: 'roster-should-not-load' }];
    });
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await deliverFanoutJob({
      type: 'event_reminder',
      teamId: 't1',
      eventId: 'e1',
      title: 'Practice',
      occurrenceStartsAt: '2026-01-02T15:00:00.000Z',
      kind: 'hour',
      userIds: ['u1'],
    });

    expect(queryBySkPrefix).not.toHaveBeenCalledWith(teamPk('t1'), TEAM_MEMBER_SK_PREFIX);
    expect(queryBySkPrefix).toHaveBeenCalledWith(userPk('u1'), CONNECTION_SK_PREFIX);
    info.mockRestore();
  });

  it('delivers a chat slice without loading chat members', async () => {
    queryBySkPrefix.mockImplementation(async (pk: string, prefix: string) => {
      if (pk === userPk('u2') && prefix === CONNECTION_SK_PREFIX) return [];
      if (prefix === DEVICE_SK_PREFIX) return [];
      return [];
    });
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await deliverFanoutJob({ ...chatJob, userIds: ['u2'], attempt: 1 });

    expect(queryBySkPrefix).not.toHaveBeenCalledWith(chatPk('c1'), CHAT_MEMBER_SK_PREFIX);
    expect(queryBySkPrefix).toHaveBeenCalledWith(userPk('u2'), CONNECTION_SK_PREFIX);
    info.mockRestore();
  });

  it('deletes a gone connection and requeues only the throttled recipient', async () => {
    process.env.WEBSOCKET_CALLBACK_URL = 'https://ws.example.com';
    process.env.FANOUT_QUEUE_URL = 'https://sqs.example/fanout';
    queryBySkPrefix.mockImplementation(async (pk: string, prefix: string) => {
      if (pk === chatPk('c1') && prefix === CHAT_MEMBER_SK_PREFIX) {
        return [{ userId: 'u1' }, { userId: 'u2' }];
      }
      if (pk === userPk('u1') && prefix === CONNECTION_SK_PREFIX) {
        return [{ connectionId: 'gone-u1' }];
      }
      if (pk === userPk('u2') && prefix === CONNECTION_SK_PREFIX) {
        return [{ connectionId: 'slow-u2' }];
      }
      if (prefix === DEVICE_SK_PREFIX) return [];
      return [];
    });
    managementSend.mockImplementation(async (command: { input?: { ConnectionId?: string } }) => {
      if (command.input?.ConnectionId === 'gone-u1') {
        throw new GoneException({ message: 'gone', $metadata: {} });
      }
      throw Object.assign(new Error('Rate exceeded'), {
        name: 'LimitExceededException',
        $metadata: { httpStatusCode: 429 },
      });
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await deliverFanoutJob(chatJob);

    expect(deleteItem).toHaveBeenCalledWith(userPk('u1'), connectionSk('gone-u1'));
    expect(enqueueFanout).toHaveBeenCalledWith(
      { ...chatJob, userIds: ['u2'], attempt: 1 },
      { delaySeconds: 2 },
    );
    const posted = managementSend.mock.calls.map(
      (call) => JSON.parse(Buffer.from(call[0].input.Data).toString('utf8')) as Record<string, unknown>,
    );
    expect(posted.every((body) => !('userIds' in body) && !('attempt' in body))).toBe(true);
    expect(sendDevicePushes).not.toHaveBeenCalled();
    warn.mockRestore();
    info.mockRestore();
  });

  it('fails the current message when the throttle attempt cap is reached', async () => {
    process.env.WEBSOCKET_CALLBACK_URL = 'https://ws.example.com';
    process.env.FANOUT_QUEUE_URL = 'https://sqs.example/fanout';
    queryBySkPrefix.mockImplementation(async (pk: string, prefix: string) => {
      if (pk === userPk('u2') && prefix === CONNECTION_SK_PREFIX) {
        return [{ connectionId: 'slow-u2' }];
      }
      return [];
    });
    managementSend.mockRejectedValue(
      Object.assign(new Error('Rate exceeded'), { name: 'LimitExceededException' }),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(
      deliverFanoutJob({ ...chatJob, userIds: ['u2'], attempt: 5 }),
    ).rejects.toThrow('fanout_throttled');
    expect(enqueueFanout).not.toHaveBeenCalled();
    expect(sendDevicePushes).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('fails the current message when a throttled post cannot be requeued', async () => {
    process.env.WEBSOCKET_CALLBACK_URL = 'https://ws.example.com';
    queryBySkPrefix.mockImplementation(async (pk: string, prefix: string) => {
      if (pk === chatPk('c1') && prefix === CHAT_MEMBER_SK_PREFIX) return [{ userId: 'u1' }];
      if (pk === userPk('u1') && prefix === CONNECTION_SK_PREFIX) {
        return [{ connectionId: 'slow-u1' }];
      }
      return [];
    });
    managementSend.mockRejectedValue({ $metadata: { httpStatusCode: 429 }, message: 'slow' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(deliverFanoutJob(chatJob)).rejects.toThrow('fanout_throttled');
    expect(enqueueFanout).not.toHaveBeenCalled();
    expect(sendDevicePushes).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('continues delivery when deleting a gone connection fails', async () => {
    process.env.WEBSOCKET_CALLBACK_URL = 'https://ws.example.com';
    queryBySkPrefix.mockImplementation(async (pk: string, prefix: string) => {
      if (pk === chatPk('c1') && prefix === CHAT_MEMBER_SK_PREFIX) return [{ userId: 'u1' }];
      if (pk === userPk('u1') && prefix === CONNECTION_SK_PREFIX) {
        return [{ connectionId: 'gone-1' }];
      }
      if (prefix === DEVICE_SK_PREFIX) return [];
      return [];
    });
    managementSend.mockRejectedValue(new GoneException({ message: 'gone', $metadata: {} }));
    deleteItem.mockRejectedValue(new Error('conditional'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await deliverFanoutJob(chatJob);

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('"event":"connection_delete_failed"'),
    );
    info.mockRestore();
    warn.mockRestore();
  });

  it('resetFanoutClients allows a new management client on the next delivery', async () => {
    process.env.WEBSOCKET_CALLBACK_URL = 'https://ws.example.com';
    queryBySkPrefix.mockImplementation(async (pk: string, prefix: string) => {
      if (pk === chatPk('c1') && prefix === CHAT_MEMBER_SK_PREFIX) return [{ userId: 'u1' }];
      if (pk === userPk('u1') && prefix === CONNECTION_SK_PREFIX) {
        return [{ connectionId: 'c1' }];
      }
      return [];
    });
    managementSend.mockResolvedValue(undefined);

    await deliverFanoutJob(chatJob);
    expect(ApiGatewayManagementApiClientMock).toHaveBeenCalledTimes(1);

    resetFanoutClients();
    await deliverFanoutJob(chatJob);
    expect(ApiGatewayManagementApiClientMock).toHaveBeenCalledTimes(2);
  });
});

describe('resetFanoutClients', () => {
  it('clears cached SNS and management clients', async () => {
    process.env.WEBSOCKET_CALLBACK_URL = 'https://ws.example.com';
    process.env.PUSH_TOPIC_ARN = 'arn:aws:sns:us-east-1:123:push';
    queryBySkPrefix.mockImplementation(async (pk: string, prefix: string) => {
      if (pk === chatPk('c1') && prefix === CHAT_MEMBER_SK_PREFIX) return [{ userId: 'u1' }];
      if (prefix === CONNECTION_SK_PREFIX) return [];
      if (prefix === DEVICE_SK_PREFIX) {
        return [{ deviceId: 'd', token: 't', platform: 'ios' }];
      }
      return [];
    });
    snsSend.mockResolvedValue(undefined);
    managementSend.mockResolvedValue(undefined);
    sendDevicePushes.mockResolvedValue([]);

    await deliverFanoutJob(chatJob);
    const snsCallsAfterFirst = vi.mocked(SNSClient).mock.calls.length;

    resetFanoutClients();
    await deliverFanoutJob(chatJob);

    expect(vi.mocked(SNSClient).mock.calls.length).toBeGreaterThan(snsCallsAfterFirst);
  });
});
