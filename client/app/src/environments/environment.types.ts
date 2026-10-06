/**
 * Shape of the client runtime config written by `scripts/write-environment.mjs`.
 */

export type Environment = {
  /** HTTP API origin (no trailing slash). */
  apiBaseUrl: string;
  /** WebSocket origin for live delivery. */
  wsBaseUrl: string;
  /** When true, skip Cognito Hosted UI and use the identity seed user. */
  authDisabled: boolean;
};
