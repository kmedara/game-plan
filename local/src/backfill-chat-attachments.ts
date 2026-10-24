/**
 * One-off: indexes the attachments of chat messages sent before the index existed.
 *
 * Media downloads read only the index, so run this in each environment right
 * after deploying the code that writes it. See `chat-attachment-backfill.ts`.
 *
 * Usage: `npm run backfill:chat-attachments -- [--dry-run] [--profile <name>]`
 *
 * Without `--profile` it writes to DynamoDB Local (`DYNAMODB_ENDPOINT`, default
 * `http://localhost:8000`). With it, it writes to the table in that profile's
 * AWS account, in `AWS_REGION` (default `us-east-1`).
 */

import { getDocClient } from '../../functions/lib/dynamo/index.js';
import { TABLE_NAME } from '../../functions/lib/names.js';
import { backfillChatAttachments } from './chat-attachment-backfill.js';

/** Counts what would be written and writes nothing. */
const DRY_RUN_FLAG = '--dry-run';

/** Names the AWS profile; without it the script stays on DynamoDB Local. */
const PROFILE_FLAG = '--profile';

/**
 * Picks the target, runs the backfill, and prints the totals.
 */
const main = async (): Promise<void> => {
  const profileAt = process.argv.indexOf(PROFILE_FLAG);
  const profile = profileAt === -1 ? undefined : process.argv[profileAt + 1];
  if (profileAt !== -1 && (profile === undefined || profile.startsWith('--'))) {
    throw new Error(`Usage: npm run backfill:chat-attachments -- [${DRY_RUN_FLAG}] [${PROFILE_FLAG} <name>]`);
  }
  if (profile === undefined) {
    if (process.env.DYNAMODB_ENDPOINT === undefined || process.env.DYNAMODB_ENDPOINT.trim() === '') {
      process.env.DYNAMODB_ENDPOINT = 'http://localhost:8000';
    }
  } else {
    process.env.AWS_PROFILE = profile;
    delete process.env.DYNAMODB_ENDPOINT;
  }

  const dryRun = process.argv.includes(DRY_RUN_FLAG);
  const region = await getDocClient().config.region();
  const target =
    profile === undefined
      ? `DynamoDB Local at ${process.env.DYNAMODB_ENDPOINT}`
      : `AWS profile ${profile} in ${region}`;
  console.info(`${dryRun ? 'dry run: ' : ''}table ${TABLE_NAME} on ${target}`);

  const result = await backfillChatAttachments({
    dryRun,
    onPage: (progress) => console.info(`... ${progress.messages} messages with attachments so far`),
  });
  for (const skip of result.skipped) {
    console.warn(JSON.stringify({ msg: 'attachment_not_indexed', ...skip }));
  }
  console.info(
    `${result.messages} messages with attachments; ${dryRun ? 'would index' : 'indexed'} ${result.indexed} keys; skipped ${result.skipped.length}`,
  );
};

await main();
