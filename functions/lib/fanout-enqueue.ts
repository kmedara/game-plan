/**
 * Best-effort enqueue onto the fan-out Amazon Simple Queue Service (SQS) queue.
 *
 * Chat and schedule write the durable row first, then notify open sockets (or
 * push) through this queue. Local day-to-day work posts to the fan-out HTTP
 * deliver route when `FANOUT_DELIVER_URL` is set and the queue URL is unset.
 */

import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import type { FanoutJob } from '@gameplan/types';

/** Lazily created SQS client shared by area Lambdas that enqueue fan-out jobs. */
let client: SQSClient | undefined;

/**
 * Returns the shared SQS client, creating it on first use.
 *
 * @returns The SQS client.
 */
const getClient = (): SQSClient => {
  client ??= new SQSClient({});
  return client;
};

/**
 * Resets the cached client (tests only).
 */
export const resetFanoutSqsClient = (): void => {
  client = undefined;
};

/** Options for one fan-out enqueue. */
export type FanoutEnqueueOptions = {
  /**
   * Seconds before the message becomes visible.
   *
   * Used when a throttled slice is put back on the queue. The local deliver
   * URL has no delay; that path posts immediately.
   */
  delaySeconds?: number;
};

/**
 * Clamps a queue delay to the range Amazon Simple Queue Service accepts.
 *
 * @param value - Requested delay in seconds.
 * @returns An integer from 1 to 900, or `undefined` when no delay applies.
 */
const delaySeconds = (value: number | undefined): number | undefined => {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.min(900, Math.floor(value));
};

/**
 * Enqueues a fan-out job when a queue URL or local deliver URL is configured.
 *
 * @param job - The delivery job body.
 * @param options - Optional queue delay for a throttle retry.
 */
export const enqueueFanout = async (
  job: FanoutJob,
  options?: FanoutEnqueueOptions,
): Promise<void> => {
  const queueUrl = process.env.FANOUT_QUEUE_URL;
  if (queueUrl !== undefined && queueUrl.length > 0) {
    const delay = delaySeconds(options?.delaySeconds);
    await getClient().send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(job),
        ...(delay !== undefined ? { DelaySeconds: delay } : {}),
      }),
    );
    return;
  }

  const deliverUrl = process.env.FANOUT_DELIVER_URL;
  if (deliverUrl === undefined || deliverUrl.length === 0) return;

  const response = await fetch(deliverUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(job),
  });
  if (!response.ok) {
    throw new Error(`fanout_deliver_failed_${response.status}`);
  }
};
