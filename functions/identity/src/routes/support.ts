/**
 * `POST /identity/support` — emails the caller's message to GamePlan support.
 */

import { supportRequestBodySchema } from '@gameplan/schemas';
import { getProfile, requireUser } from '../../../lib/auth/index.js';
import { route, withBodyValidation } from '../../../lib/pipeline.js';
import { sendSupportMail } from '../support-mail.js';
import { withIdentityErrors } from './session.js';

/** `POST /identity/support` */
export const handleSupportRequest = route(
  'POST',
  '/identity/support',
  withIdentityErrors(),
  requireUser(),
  withBodyValidation(supportRequestBodySchema),
  async ({ user, body }) => {
    const profile = await getProfile(user.userId);
    if (profile === undefined) throw new Error('profile_not_found');
    await sendSupportMail({
      subject: body.subject,
      message: body.message,
      replyTo: profile.email,
      displayName: profile.displayName,
      userId: user.userId,
    });
    return { statusCode: 204 };
  },
);
