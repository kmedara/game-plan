/**
 * Public surface of the client session package.
 */

export { CONTENT_SHA256_HEADER, sha256Hex, withContentHash } from './content-hash.js';
export { WebRefreshStore, type RefreshStore } from './refresh-store.js';

export {
  SessionService,
  type AccountKind,
  type LoginBody,
  type RegisterBody,
  type SessionMode,
  type SessionServiceOptions,
  type SessionTokens,
  type UserProfile,
} from './session-service.js';
