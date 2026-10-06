/**
 * Public surface of the client session package.
 */

export {
  CAPACITOR_REFRESH_KEY,
  CapacitorRefreshStore,
  WebRefreshStore,
  type PreferencesLike,
  type RefreshStore,
} from './refresh-store.js';

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
