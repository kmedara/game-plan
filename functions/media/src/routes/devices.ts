/**
 * Device token registration routes.
 */

import { registerDeviceBodySchema } from '@gameplan/schemas';
import { requireUser } from '../../../lib/auth/index.js';
import { badRequest, json } from '../../../lib/http.js';
import { asStep, route, withBodyValidation, type Step } from '../../../lib/pipeline.js';
import { deleteDevice, putDevice } from '../device-store.js';
import { withMediaErrors } from './errors.js';

/**
 * Rejects an empty or oversized device id before the body is read.
 *
 * @returns A step that responds `400` when `deviceId` is out of range.
 */
const validDeviceId = (): Step<{ deviceId: string }, object> =>
  asStep<{ deviceId: string }, object>(async (ctx, next) => {
    if (ctx.deviceId.length === 0 || ctx.deviceId.length > 128) return badRequest('invalid_body');
    return next(ctx);
  });

/**
 * Handles `PUT /media/devices/:deviceId`.
 *
 * @param event - The HTTP API event.
 * @param deviceId - The client-generated device id.
 * @returns The stored device summary.
 */
export const handleRegisterDevice = route(
  ['deviceId'],
  withMediaErrors(),
  validDeviceId(),
  withBodyValidation(registerDeviceBodySchema),
  requireUser(),
  async ({ deviceId, user, body }) => {
    const item = await putDevice({
      userId: user.userId,
      deviceId,
      token: body.token,
      platform: body.platform,
    });
    return json(200, {
      deviceId: item.deviceId,
      platform: item.platform,
      updatedAt: item.updatedAt,
    });
  },
);

/**
 * Handles `DELETE /media/devices/:deviceId`.
 *
 * @param event - The HTTP API event.
 * @param deviceId - The device id to remove.
 * @returns An empty `204`.
 */
export const handleDeleteDevice = route(
  ['deviceId'],
  withMediaErrors(),
  requireUser(),
  async ({ deviceId, user }) => {
    if (deviceId.length === 0 || deviceId.length > 128) return badRequest('invalid_body');
    await deleteDevice(user.userId, deviceId);
    return { statusCode: 204 };
  },
);
