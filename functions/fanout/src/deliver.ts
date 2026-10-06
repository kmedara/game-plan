/**
 * Fan-out delivery: open WebSockets first, then push when none are open.
 *
 * A live socket does not also get a push. Recipients come from chat members or
 * the team roster. Delivery failures on a single connection are ignored so one
 * stale socket does not block the rest of the batch.
 */

import {
  ApiGatewayManagementApiClient,
  GoneException,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import type { FanoutJob } from '../../lib/fanout-enqueue.js';
import {
  CHAT_MEMBER_SK_PREFIX,
  CONNECTION_SK_PREFIX,
  DEVICE_SK_PREFIX,
  TEAM_MEMBER_SK_PREFIX,
  chatPk,
  queryBySkPrefix,
  teamPk,
  userPk,
} from '../../lib/dynamo/index.js';

/** Chat member row under `CHAT#id` / `MEMBER#userId`. */
type ChatMemberItem = { userId: string };

/** Team roster row under `TEAM#id` / `MEMBER#userId`. */
type TeamMemberItem = { userId: string };

/** Socket connection under `USER#id` / `CONN#…`. */
type ConnectionItem = { connectionId: string };

/** Push device under `USER#id` / `DEVICE#…`. */
type DeviceItem = {
  deviceId: string;
  token: string;
  platform: string;
};

/** Lazily created management API client for PostToConnection. */
let managementClient: ApiGatewayManagementApiClient | undefined;

/** Lazily created SNS client for offline push. */
let snsClient: SNSClient | undefined;

/**
 * Returns the WebSocket management client, or `undefined` when unset locally.
 *
 * @returns The client pointed at `WEBSOCKET_CALLBACK_URL`.
 */
const getManagementClient = (): ApiGatewayManagementApiClient | undefined => {
  const endpoint = process.env.WEBSOCKET_CALLBACK_URL;
  if (endpoint === undefined || endpoint.length === 0) return undefined;
  managementClient ??= new ApiGatewayManagementApiClient({
    endpoint,
    region: process.env.AWS_REGION ?? 'us-east-1',
    ...(endpoint.startsWith('http://127.0.0.1') || endpoint.startsWith('http://localhost')
      ? {
          credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
          // Local socket server does not verify SigV4.
          requestHandler: undefined,
        }
      : {}),
  });
  return managementClient;
};

/**
 * Returns the SNS client used for offline push.
 *
 * @returns The shared SNS client.
 */
const getSnsClient = (): SNSClient => {
  snsClient ??= new SNSClient({});
  return snsClient;
};

/**
 * Resets cached clients (tests only).
 */
export const resetFanoutClients = (): void => {
  managementClient = undefined;
  snsClient = undefined;
};

/**
 * Lists recipient user ids for a fan-out job.
 *
 * @param job - The delivery job.
 * @returns Distinct user ids that should receive the event.
 */
const recipientUserIds = async (job: FanoutJob): Promise<string[]> => {
  if (job.type === 'chat_message') {
    const members = await queryBySkPrefix<ChatMemberItem>(
      chatPk(job.chatId),
      CHAT_MEMBER_SK_PREFIX,
    );
    return [...new Set(members.map((member) => member.userId))];
  }
  const members = await queryBySkPrefix<TeamMemberItem>(
    teamPk(job.teamId),
    TEAM_MEMBER_SK_PREFIX,
  );
  return [...new Set(members.map((member) => member.userId))];
};

/**
 * Posts a JSON payload to one open connection.
 *
 * Gone connections are ignored; other errors are logged and swallowed so the
 * rest of the fan-out can continue.
 *
 * @param connectionId - The WebSocket connection id.
 * @param payload - The JSON-serializable event body.
 * @returns `true` when the post succeeded.
 */
const postToConnection = async (
  connectionId: string,
  payload: unknown,
): Promise<boolean> => {
  const client = getManagementClient();
  if (client === undefined) return false;
  try {
    await client.send(
      new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: Buffer.from(JSON.stringify(payload), 'utf8'),
      }),
    );
    return true;
  } catch (error: unknown) {
    if (error instanceof GoneException) return false;
    const name =
      typeof error === 'object' && error !== null && 'name' in error
        ? String((error as { name: unknown }).name)
        : '';
    // Local servers often surface 410 as a generic error.
    if (name === 'GoneException' || name.includes('Gone')) return false;
    console.warn(
      JSON.stringify({
        service: 'fanout',
        event: 'post_failed',
        connectionId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return false;
  }
};

/**
 * Publishes an offline push for one user when no socket accepted the event.
 *
 * @param userId - The recipient user id.
 * @param job - The original fan-out job.
 * @param devices - Registered device tokens for that user.
 */
const publishPush = async (
  userId: string,
  job: FanoutJob,
  devices: DeviceItem[],
): Promise<void> => {
  const topicArn = process.env.PUSH_TOPIC_ARN;
  if (topicArn === undefined || topicArn.length === 0 || devices.length === 0) {
    console.info(
      JSON.stringify({
        service: 'fanout',
        event: 'push_skipped',
        userId,
        reason:
          topicArn === undefined || topicArn.length === 0
            ? 'no_topic'
            : 'no_devices',
        type: job.type,
      }),
    );
    return;
  }

  const title = job.type === 'chat_message' ? 'New message' : 'Schedule updated';
  const body =
    job.type === 'chat_message'
      ? job.body.slice(0, 180)
      : `Event ${job.eventId} changed`;

  await getSnsClient().send(
    new PublishCommand({
      TopicArn: topicArn,
      Subject: title,
      Message: JSON.stringify({
        userId,
        title,
        body,
        data: job,
        devices: devices.map((device) => ({
          deviceId: device.deviceId,
          token: device.token,
          platform: device.platform,
        })),
      }),
    }),
  );
};

/**
 * Delivers one fan-out job to every recipient.
 *
 * Open sockets get the WebSocket frame. Users with no live socket get a push
 * when devices and a topic are configured.
 *
 * @param job - The delivery job parsed from the queue or local HTTP body.
 */
export const deliverFanoutJob = async (job: FanoutJob): Promise<void> => {
  const userIds = await recipientUserIds(job);
  const payload = job;

  for (const userId of userIds) {
    const connections = await queryBySkPrefix<ConnectionItem>(
      userPk(userId),
      CONNECTION_SK_PREFIX,
    );
    let deliveredToSocket = false;
    for (const connection of connections) {
      const ok = await postToConnection(connection.connectionId, payload);
      if (ok) deliveredToSocket = true;
    }

    if (!deliveredToSocket) {
      const devices = await queryBySkPrefix<DeviceItem>(userPk(userId), DEVICE_SK_PREFIX);
      await publishPush(userId, job, devices);
    }
  }
};

/**
 * Narrows an unknown JSON body to a {@link FanoutJob}.
 *
 * @param body - Parsed JSON.
 * @returns The job, or `undefined` when the shape is wrong.
 */
export const parseFanoutJob = (body: unknown): FanoutJob | undefined => {
  if (typeof body !== 'object' || body === null) return undefined;
  const record = body as Record<string, unknown>;
  if (record.type === 'schedule_changed') {
    if (typeof record.teamId !== 'string' || typeof record.eventId !== 'string') {
      return undefined;
    }
    return {
      type: 'schedule_changed',
      teamId: record.teamId,
      eventId: record.eventId,
    };
  }
  if (record.type === 'chat_message') {
    if (
      typeof record.chatId !== 'string' ||
      typeof record.messageId !== 'string' ||
      typeof record.senderId !== 'string' ||
      typeof record.body !== 'string' ||
      typeof record.createdAt !== 'string'
    ) {
      return undefined;
    }
    const job: FanoutJob = {
      type: 'chat_message',
      chatId: record.chatId,
      messageId: record.messageId,
      senderId: record.senderId,
      body: record.body,
      createdAt: record.createdAt,
    };
    if (Array.isArray(record.attachmentKeys)) {
      job.attachmentKeys = record.attachmentKeys.filter(
        (key): key is string => typeof key === 'string',
      );
    }
    return job;
  }
  return undefined;
};
