/**
 * Media route handlers.
 */

import type { HttpRoute } from '../../../lib/pipeline.js';
import { handleAddAlbumItem, handleAlbumUpload, handleListAlbum, handleRemoveAlbumItem } from './album.js';
import { handleDeleteDevice, handleRegisterDevice } from './devices.js';
import { handleLocalGetObject, handleLocalPutObject } from './local-objects.js';
import { handlePresignDownload, handlePresignUpload } from './presign.js';

export {
  handleAddAlbumItem,
  handleAlbumUpload,
  handleDeleteDevice,
  handleListAlbum,
  handleLocalGetObject,
  handleLocalPutObject,
  handlePresignDownload,
  handlePresignUpload,
  handleRegisterDevice,
  handleRemoveAlbumItem,
};

/** Every media HTTP route, matched by method and path. */
export const httpRoutes: readonly HttpRoute[] = [
  handlePresignUpload,
  handlePresignDownload,
  handleRegisterDevice,
  handleDeleteDevice,
  handleLocalPutObject,
  handleLocalGetObject,
  handleListAlbum,
  handleAlbumUpload,
  handleAddAlbumItem,
  handleRemoveAlbumItem,
];
