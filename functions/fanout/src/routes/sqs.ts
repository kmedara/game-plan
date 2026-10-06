/**
 * Fan-out Amazon Simple Queue Service (SQS) consumer route.
 */

import type { SQSBatchResponse, SQSEvent } from 'aws-lambda';
import { deliverFanoutJob, parseFanoutJob } from '../deliver.js';

/**
 * Delivers each SQS record and reports per-message failures for partial retry.
 *
 * @param event - The SQS batch from the fan-out queue.
 * @returns Batch item failures for records that could not be delivered.
 */
export const handleSqs = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const batchItemFailures: { itemIdentifier: string }[] = [];

  for (const record of event.Records) {
    try {
      const parsed = JSON.parse(record.body) as unknown;
      const job = parseFanoutJob(parsed);
      if (job === undefined) {
        console.warn(
          JSON.stringify({
            service: 'fanout',
            event: 'invalid_job',
            messageId: record.messageId,
          }),
        );
        continue;
      }
      await deliverFanoutJob(job);
    } catch (error: unknown) {
      console.error(
        JSON.stringify({
          service: 'fanout',
          event: 'deliver_failed',
          messageId: record.messageId,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
};
