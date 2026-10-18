/**
 * `POST /identity/confirm` and `POST /identity/confirm/resend`.
 *
 * Cognito emails a code at signup. The account stays unconfirmed until this
 * route submits that code.
 */

import { confirmRegistrationBodySchema, resendConfirmationBodySchema } from '@gameplan/schemas';
import { getIdentityProvider } from '../../../lib/auth/index.js';
import { route, withBodyValidation } from '../../../lib/pipeline.js';
import { withIdentityErrors } from './session.js';

/**
 * Handles `POST /identity/confirm`.
 *
 * @param event - The HTTP API event.
 * @returns `204` when the code matches the emailed one.
 */
export const handleConfirmRegistration = route(
  'POST',
  '/identity/confirm',
  withIdentityErrors(),
  withBodyValidation(confirmRegistrationBodySchema),
  async ({ body }) => {
    await getIdentityProvider().confirmRegistration(body.email, body.code);
    return { statusCode: 204 };
  },
);

/**
 * Handles `POST /identity/confirm/resend`.
 *
 * @param event - The HTTP API event.
 * @returns `204` whether or not an unconfirmed account exists.
 */
export const handleResendConfirmation = route(
  'POST',
  '/identity/confirm/resend',
  withIdentityErrors(),
  withBodyValidation(resendConfirmationBodySchema),
  async ({ body }) => {
    await getIdentityProvider().resendConfirmation(body.email);
    return { statusCode: 204 };
  },
);
