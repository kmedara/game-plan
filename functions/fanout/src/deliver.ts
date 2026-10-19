/**
 * Fan-out delivery: open WebSockets first, then push when none are open.
 *
 * A live socket does not also get a push. Join requests and reminders still
 * push when a socket accepted the event. Recipients come from chat members,
 * the team roster, or `userIds` already on the job. A gone connection is
 * deleted. A throttled post is requeued for those users only.
 */

import {
  ApiGatewayManagementApiClient,
  GoneException,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { canWithRoles, rolesFromMembership } from '@gameplan/rules';
import { fanoutJobSchema } from '@gameplan/schemas';
import type { FanoutJob } from '@gameplan/types';
import {
  CHAT_MEMBER_SK_PREFIX,
  CONNECTION_SK_PREFIX,
  DEVICE_SK_PREFIX,
  TEAM_MEMBER_SK_PREFIX,
  chatPk,
  connectionSk,
  deleteItem,
  deviceSk,
  queryBySkPrefix,
  teamPk,
  userPk,
} from '../../lib/dynamo/index.js';
import { enqueueFanout } from '../../lib/fanout-enqueue.js';
import { loadRolePermissionMatrix } from '../../lib/permissions.js';
import { sendDevicePushes } from './push-send.js';

/** How many throttle retries may be enqueued before the queue's own retries take over. */
const MAX_THROTTLE_ATTEMPT = 5;

/** Result of one `PostToConnection` call. */
type PostResult = 'delivered' | 'gone' | 'throttled' | 'failed';

/** Chat member row under `CHAT#id` / `MEMBER#userId`. */
type ChatMemberItem = { userId: string };

/** Team roster row under `TEAM#id` / `MEMBER#userId`. */
type TeamMemberItem = { userId: string; role?: unknown; roles?: unknown };

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
 * Returns the distinct ids in `userIds`, preserving the first-seen order.
 *
 * @param userIds - Recipient ids from a job or a throttle retry.
 * @returns Unique user ids.
 */
const distinctUserIds = (userIds: readonly string[]): string[] => [...new Set(userIds)];

/**
 * Reads the error name from an SDK or plain object rejection.
 *
 * @param error - The rejected value.
 * @returns The name, or an empty string.
 */
const errorName = (error: unknown): string =>
  typeof error === 'object' && error !== null && 'name' in error
    ? String((error as { name: unknown }).name)
    : '';

/**
 * Reads the HTTP status from an AWS SDK error, when it has one.
 *
 * @param error - The rejected value.
 * @returns The status code, or `undefined`.
 */
const httpStatus = (error: unknown): number | undefined => {
  if (typeof error !== 'object' || error === null || !('$metadata' in error)) return undefined;
  const status = (error as { $metadata?: { httpStatusCode?: unknown } }).$metadata?.httpStatusCode;
  return typeof status === 'number' ? status : undefined;
};

/**
 * True when the management API reports that the connection is gone.
 *
 * Local servers often surface `410` as a generic error whose name contains `Gone`.
 *
 * @param error - The rejected value.
 * @returns Whether the connection id should be deleted.
 */
const isGone = (error: unknown): boolean => {
  if (error instanceof GoneException) return true;
  const name = errorName(error);
  return name === 'GoneException' || name.includes('Gone') || httpStatus(error) === 410;
};

/**
 * True when the management API throttled the post.
 *
 * @param error - The rejected value.
 * @returns Whether this recipient should be retried on a later slice.
 */
const isThrottled = (error: unknown): boolean => {
  if (isGone(error)) return false;
  const name = errorName(error);
  return (
    httpStatus(error) === 429 ||
    name === 'LimitExceededException' ||
    name === 'TooManyRequestsException' ||
    name === 'ThrottlingException'
  );
};

/**
 * Lists recipient user ids for a fan-out job.
 *
 * A job that already carries `userIds` delivers to that list. Reminders always
 * do. Other jobs load chat members, the roster, or join-request approvers.
 *
 * @param job - The delivery job.
 * @returns Distinct user ids that should receive the event.
 */
const recipientUserIds = async (job: FanoutJob): Promise<string[]> => {
  if (job.userIds !== undefined) return distinctUserIds(job.userIds);
  if (job.type === 'chat_message') {
    const members = await queryBySkPrefix<ChatMemberItem>(
      chatPk(job.chatId),
      CHAT_MEMBER_SK_PREFIX,
    );
    return distinctUserIds(members.map((member) => member.userId));
  }
  const members = await queryBySkPrefix<TeamMemberItem>(
    teamPk(job.teamId),
    TEAM_MEMBER_SK_PREFIX,
  );
  if (job.type !== 'join_requested') {
    return distinctUserIds(members.map((member) => member.userId));
  }

  const matrix = await loadRolePermissionMatrix(job.teamId);
  const approvers = members.filter((member) => {
    const roles = rolesFromMembership(member);
    return canWithRoles(roles, matrix, 'approve_join_requests');
  });
  return distinctUserIds(approvers.map((member) => member.userId));
};

/**
 * Formats minor units as a currency amount for push text.
 *
 * @param cents - Amount in minor units.
 * @param currency - ISO currency code, any case.
 * @returns Text such as `$45.00`.
 */
const money = (cents: number, currency: string): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);

/**
 * Event body for a socket frame or push, without queue-only retry fields.
 *
 * @param job - The delivery job.
 * @returns The payload a client already understands.
 */
const clientPayload = (job: FanoutJob): Record<string, unknown> => {
  const payload = { ...job } as Record<string, unknown>;
  delete payload.userIds;
  delete payload.attempt;
  return payload;
};

/**
 * Posts a JSON payload to one open connection.
 *
 * Gone and throttled posts are reported to the caller. Other errors are logged
 * so one bad socket does not stop the rest of the batch.
 *
 * @param connectionId - The WebSocket connection id.
 * @param payload - The JSON-serializable event body.
 * @returns How the post finished.
 */
const postToConnection = async (
  connectionId: string,
  payload: unknown,
): Promise<PostResult> => {
  const client = getManagementClient();
  if (client === undefined) return 'failed';
  try {
    await client.send(
      new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: Buffer.from(JSON.stringify(payload), 'utf8'),
      }),
    );
    return 'delivered';
  } catch (error: unknown) {
    if (isGone(error)) return 'gone';
    if (isThrottled(error)) {
      console.warn(
        JSON.stringify({
          service: 'fanout',
          event: 'post_throttled',
          connectionId,
        }),
      );
      return 'throttled';
    }
    console.warn(
      JSON.stringify({
        service: 'fanout',
        event: 'post_failed',
        connectionId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return 'failed';
  }
};

/**
 * Deletes a connection row that the management API has reported gone.
 *
 * A failed delete is logged. The post already failed, so delivery continues.
 *
 * @param userId - The recipient who owned the connection.
 * @param connectionId - The connection id from the failed post.
 */
const deleteGoneConnection = async (userId: string, connectionId: string): Promise<void> => {
  try {
    await deleteItem(userPk(userId), connectionSk(connectionId));
  } catch (error: unknown) {
    console.warn(
      JSON.stringify({
        service: 'fanout',
        event: 'connection_delete_failed',
        userId,
        connectionId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
};

/**
 * Forgets a device the push service says no longer exists, such as a browser
 * that revoked permission or an uninstalled app.
 *
 * @param userId - The device owner.
 * @param deviceId - The stored device id.
 */
const deleteGoneDevice = async (userId: string, deviceId: string): Promise<void> => {
  try {
    await deleteItem(userPk(userId), deviceSk(deviceId));
    console.info(JSON.stringify({ service: 'fanout', event: 'device_removed', userId, deviceId }));
  } catch (error: unknown) {
    console.warn(
      JSON.stringify({
        service: 'fanout',
        event: 'device_delete_failed',
        userId,
        deviceId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
};

/**
 * Enqueues one follow-up job for recipients whose posts were throttled.
 *
 * The follow-up carries only those user ids. Past the attempt cap, or when no
 * queue is configured, this throws so the current message stays on the queue.
 *
 * @param job - The job that was throttled.
 * @param userIds - Recipients to try again.
 */
const requeueThrottled = async (job: FanoutJob, userIds: readonly string[]): Promise<void> => {
  const attempt = (job.attempt ?? 0) + 1;
  const queueConfigured = (process.env.FANOUT_QUEUE_URL ?? '').length > 0;
  const deliverConfigured = (process.env.FANOUT_DELIVER_URL ?? '').length > 0;
  if (attempt > MAX_THROTTLE_ATTEMPT || (!queueConfigured && !deliverConfigured)) {
    throw new Error('fanout_throttled');
  }
  const [first, ...rest] = distinctUserIds(userIds);
  if (first === undefined) return;
  await enqueueFanout(
    { ...job, userIds: [first, ...rest], attempt },
    { delaySeconds: Math.min(60, 2 ** attempt) },
  );
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
  const topicMissing = topicArn === undefined || topicArn.length === 0;
  if (devices.length === 0 || topicMissing) {
    console.info(
      JSON.stringify({
        service: 'fanout',
        event: 'push_skipped',
        userId,
        reason: topicMissing ? 'no_topic' : 'no_devices',
        type: job.type,
      }),
    );
  }
  if (devices.length === 0) return;

  if (job.type === 'schedule_changed') return;

  const title =
    job.type === 'chat_message'
      ? 'New message'
      : job.type === 'join_requested'
        ? 'Join request'
        : job.type === 'event_reminder'
          ? 'Reminder'
          : job.type === 'dues_reminder'
            ? 'Payment reminder'
            : job.type === 'payment_received'
              ? 'Payment received'
              : job.title;
  const moved =
    job.type === 'event_moved'
      ? job.change === 'both'
        ? 'time and location changed'
        : job.change === 'time'
          ? 'time changed'
          : 'location changed'
      : undefined;
  const reminder =
    job.type === 'event_reminder'
      ? `${job.title} ${job.kind === 'hour' ? 'starts in an hour' : 'is tomorrow'}${job.location !== undefined ? ` · ${job.location}` : ''}`
      : undefined;
  const dues =
    job.type === 'dues_reminder'
      ? `${job.title} · ${money(job.amountCents, job.currency)} ${
          job.kind === 'upcoming' ? `is due ${job.dueDate}` : job.kind === 'due' ? 'is due today' : 'is overdue'
        }`
      : job.type === 'payment_received'
        ? `${job.memberDisplayName ?? 'A member'} paid ${money(job.amountCents, job.currency)} for ${job.title}`
        : undefined;
  const body =
    job.type === 'chat_message'
      ? job.body.slice(0, 180)
      : job.type === 'join_requested'
        ? `${job.requesterDisplayName} asked to join ${job.teamName}`
        : (dues ??
          reminder ??
          `${job.type === 'event_moved' ? job.title : 'Event'} ${moved ?? ''}`.trim());

  const gone = await sendDevicePushes({ title, body, data: clientPayload(job), devices });
  for (const device of gone) await deleteGoneDevice(userId, device.deviceId);
  if (topicMissing || topicArn === undefined) return;

  await getSnsClient().send(
    new PublishCommand({
      TopicArn: topicArn,
      Subject: title,
      Message: JSON.stringify({
        userId,
        title,
        body,
        data: clientPayload(job),
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
 * when devices and a topic are configured. Throttled recipients are requeued
 * on their own and are not pushed in this attempt.
 *
 * @param job - The delivery job parsed from the queue or local HTTP body.
 */
export const deliverFanoutJob = async (job: FanoutJob): Promise<void> => {
  const userIds = await recipientUserIds(job);
  const payload = clientPayload(job);
  const throttled: string[] = [];
  const pushAnyway =
    job.type === 'join_requested' ||
    job.type === 'event_reminder' ||
    job.type === 'dues_reminder' ||
    job.type === 'payment_received';

  for (const userId of userIds) {
    const connections = await queryBySkPrefix<ConnectionItem>(
      userPk(userId),
      CONNECTION_SK_PREFIX,
    );
    let deliveredToSocket = false;
    let retryUser = false;
    for (const connection of connections) {
      const result = await postToConnection(connection.connectionId, payload);
      if (result === 'delivered') deliveredToSocket = true;
      if (result === 'gone') await deleteGoneConnection(userId, connection.connectionId);
      if (result === 'throttled') retryUser = true;
    }

    if (deliveredToSocket) {
      if (pushAnyway) {
        const devices = await queryBySkPrefix<DeviceItem>(userPk(userId), DEVICE_SK_PREFIX);
        await publishPush(userId, job, devices);
      }
      continue;
    }
    if (retryUser) {
      throttled.push(userId);
      continue;
    }

    const devices = await queryBySkPrefix<DeviceItem>(userPk(userId), DEVICE_SK_PREFIX);
    await publishPush(userId, job, devices);
  }

  if (throttled.length > 0) await requeueThrottled(job, throttled);
};

/**
 * Narrows an unknown JSON body to a {@link FanoutJob}.
 *
 * @param body - Parsed JSON.
 * @returns The job, or `undefined` when the shape is wrong.
 */
export const parseFanoutJob = (body: unknown): FanoutJob | undefined => {
  const parsed = fanoutJobSchema.safeParse(body);
  if (!parsed.success) return undefined;
  return parsed.data;
};
