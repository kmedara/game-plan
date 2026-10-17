/**
 * Retry, persistence, and online-state rules for the query client.
 */

import { isOnlineState, isTransientError, retryTransient, shouldPersistMutation, shouldPersistQuery } from './query-policy';

describe('query policy', () => {
  it('retries network and http_5xx failures twice', () => {
    expect(isTransientError(new TypeError('network'))).toBe(true);
    expect(isTransientError(new Error('http_503'))).toBe(true);
    expect(isTransientError(new Error('forbidden'))).toBe(false);
    expect(retryTransient(0, new Error('http_500'))).toBe(true);
    expect(retryTransient(2, new Error('http_500'))).toBe(false);
    expect(retryTransient(0, new Error('http_404'))).toBe(false);
  });

  it('persists settled values of known kinds only', () => {
    expect(shouldPersistQuery({ queryKey: ['teams'], state: { status: 'success' } } as never)).toBe(true);
    expect(shouldPersistQuery({ queryKey: ['messages', 'c1'], state: { status: 'success' } } as never)).toBe(false);
    expect(shouldPersistQuery({ queryKey: ['teams'], state: { status: 'pending' } } as never)).toBe(false);
  });

  it('persists paused writes of known kinds only', () => {
    expect(
      shouldPersistMutation({ options: { mutationKey: ['rsvp'] }, state: { isPaused: true } }),
    ).toBe(true);
    expect(
      shouldPersistMutation({ options: { mutationKey: ['rsvp'] }, state: { isPaused: false } }),
    ).toBe(false);
    expect(
      shouldPersistMutation({ options: { mutationKey: ['sendMessage'] }, state: { isPaused: true } }),
    ).toBe(false);
  });

  it('treats unknown connectivity as online', () => {
    expect(isOnlineState({ isConnected: null, isInternetReachable: null })).toBe(true);
    expect(isOnlineState({ isConnected: true, isInternetReachable: true })).toBe(true);
    expect(isOnlineState({ isConnected: false, isInternetReachable: true })).toBe(false);
    expect(isOnlineState({ isConnected: true, isInternetReachable: false })).toBe(false);
  });
});
