/**
 * Fan-out route handlers.
 */

import type { HttpRoute } from '../../../lib/pipeline.js';
import { handleDeliver } from './deliver.js';
import { handleSqs } from './sqs.js';

export { handleDeliver, handleSqs };

/** The local HTTP deliver route. SQS batches are not matched here. */
export const httpRoutes: readonly HttpRoute[] = [handleDeliver];
