/**
 * Media route handlers.
 */

import type { HttpRoute } from '../../../lib/pipeline.js';
import { handleDeleteDevice, handleRegisterDevice } from './devices.js';
import { handleLocalGetObject, handleLocalPutObject } from './local-objects.js';
import { handlePresignDownload, handlePresignUpload } from './presign.js';

export {
  handleDeleteDevice,
  handleLocalGetObject,
  handleLocalPutObject,
  handlePresignDownload,
  handlePresignUpload,
  handleRegisterDevice,
};

/** Every media HTTP route, matched by method and path. */
export const httpRoutes: readonly HttpRoute[] = [
  handlePresignUpload,
  handlePresignDownload,
  handleRegisterDevice,
  handleDeleteDevice,
  handleLocalPutObject,
  handleLocalGetObject,
];
