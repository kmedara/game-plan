/**
 * Device token registration routes.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { registerDeviceBodySchema } from '@gameplan/schemas';
import { badRequest, json, withBodyValidation } from '../../../lib/http.js';
import { requireUser } from '../../../lib/auth/index.js';

import { deleteDevice, putDevice } from '../device-store.js';

import { withMediaErrors } from './errors.js';

/**
 * Handles `PUT /media/devices/:deviceId`.
 *
 * @param event - The HTTP API event.
 * @param deviceId - The client-generated device id.
 * @returns The stored device summary.
 */
export const handleRegisterDevice = (
  event: APIGatewayProxyEventV2,
  deviceId: string,
): Promise<APIGatewayProxyStructuredResultV2> =>
  withMediaErrors(async () => {
    if (deviceId.length === 0 || deviceId.length > 128) return badRequest('invalid_body');
    return withBodyValidation(registerDeviceBodySchema, async (event, body) => {
      const user = await requireUser(event);
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
    })(event);
  });

/**
 * Handles `DELETE /media/devices/:deviceId`.
 *
 * @param event - The HTTP API event.
 * @param deviceId - The device id to remove.
 * @returns An empty `204`.
 */
export const handleDeleteDevice = (
  event: APIGatewayProxyEventV2,
  deviceId: string,
): Promise<APIGatewayProxyStructuredResultV2> =>
  withMediaErrors(async () => {
    const user = await requireUser(event);
    if (deviceId.length === 0 || deviceId.length > 128) return badRequest('invalid_body');
    await deleteDevice(user.userId, deviceId);
    return { statusCode: 204 };
  });
