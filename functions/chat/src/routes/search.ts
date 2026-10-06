/**
 * Exact-email adult search route.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { searchUsersQuerySchema } from '@gameplan/schemas';
import { json, withQueryValidation } from '../../../lib/http.js';
import { requireUser } from '../../../lib/auth/index.js';

import { searchAdultByEmail } from '../chat-store.js';

import { withChatErrors } from './errors.js';

/**
 * Handles `GET /chat/users/search?email=`.
 *
 * @param event - The HTTP API event.
 * @returns The matching adult profile, or `user_not_found`.
 */
export const handleSearchUsers = (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> =>
  withChatErrors(async () =>
    withQueryValidation(searchUsersQuerySchema, async (event, query) => {
      await requireUser(event);
      const user = await searchAdultByEmail(query.email);
      return json(200, { user });
    })(event),
  );
