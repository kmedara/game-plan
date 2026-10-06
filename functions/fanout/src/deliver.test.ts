/**
 * Fan-out job parsing and delivery coverage.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHAT_MEMBER_SK_PREFIX,
  CONNECTION_SK_PREFIX,
  DEVICE_SK_PREFIX,
  TEAM_MEMBER_SK_PREFIX,
  chatPk,
  teamPk,
  userPk,
} from '../../lib/dynamo/keys.js';

const {
  queryBySkPrefix,
  managementSend,
  snsSend,
  ApiGatewayManagementApiClientMock,
} = vi.hoisted(() => ({
  queryBySkPrefix: vi.fn(),
  managementSend: vi.fn(),
  snsSend: vi.fn(),
  ApiGatewayManagementApiClientMock: vi.fn(function ApiGatewayManagementApiClient(this: {
    send: typeof managementSend;
  }) {
    this.send = managementSend;
  }),
}));

vi.mock('../../lib/dynamo/access.js', () => ({
  queryBySkPrefix: (...args: unknown[]) => queryBySkPrefix(...args),
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
});

describe('deliverFanoutJob', () => {
  beforeEach(() => {
    queryBySkPrefix.mockReset();
    managementSend.mockReset();
    snsSend.mockReset();
    ApiGatewayManagementApiClientMock.mockClear();
    vi.mocked(SNSClient).mockClear();
    delete process.env.WEBSOCKET_CALLBACK_URL;
    delete process.env.PUSH_TOPIC_ARN;
    delete process.env.AWS_REGION;
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

    expect(snsSend).toHaveBeenCalledTimes(1);
    const command = snsSend.mock.calls[0]?.[0] as { input?: { Subject?: string; Message?: string } };
    expect(command.input?.Subject).toBe('Schedule updated');
    const message = JSON.parse(command.input?.Message ?? '{}') as { body?: string };
    expect(message.body).toBe('Event e1 changed');
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

    await deliverFanoutJob(chatJob);
    const snsCallsAfterFirst = vi.mocked(SNSClient).mock.calls.length;

    resetFanoutClients();
    await deliverFanoutJob(chatJob);

    expect(vi.mocked(SNSClient).mock.calls.length).toBeGreaterThan(snsCallsAfterFirst);
  });
});
