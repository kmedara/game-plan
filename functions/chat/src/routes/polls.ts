/**
 * Poll routes: post a poll, and vote on one.
 */

import { createPollBodySchema, pollVoteBodySchema } from '@gameplan/schemas';
import { requireUser } from '../../../lib/auth/index.js';
import { json } from '../../../lib/http.js';
import { route, withBodyValidation } from '../../../lib/pipeline.js';
import { createPoll, votePoll } from '../polls.js';
import { withChatErrors } from './errors.js';

/** `POST /chat/:chatId/polls` — posts a poll as a message. */
export const handleCreatePoll = route(
  'POST',
  '/chat/:chatId/polls',
  withChatErrors(),
  requireUser(),
  withBodyValidation(createPollBodySchema),
  async ({ chatId, user, body }) => json(201, await createPoll({ chatId, userId: user.userId, body })),
);

/** `PUT /chat/:chatId/polls/:messageId/vote` — sets the caller's choices; an empty list takes the vote back. */
export const handleVotePoll = route(
  'PUT',
  '/chat/:chatId/polls/:messageId/vote',
  withChatErrors(),
  requireUser(),
  withBodyValidation(pollVoteBodySchema),
  async ({ chatId, messageId, user, body }) =>
    json(200, await votePoll({ chatId, messageId, userId: user.userId, optionIds: body.optionIds })),
);
