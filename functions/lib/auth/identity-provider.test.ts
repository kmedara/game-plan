/**
 * Unit tests for identity provider wire mapping.
 */

import { describe, expect, it } from 'vitest';
import { toUserProfile, type UserProfileItem } from './identity-provider.js';

describe('toUserProfile', () => {
  it('maps optional birthday, photo, and phone fields', () => {
    const complete: UserProfileItem = {
      PK: 'USER#u1',
      SK: 'PROFILE',
      userId: 'u1',
      email: 'a@example.com',
      displayName: 'Ada',
      accountKind: 'adult',
      birthday: '1990-01-01',
      photoKey: 'photos/u1.jpg',
      phoneNumber: '+1 555 0100',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    expect(toUserProfile(complete)).toEqual({
      userId: 'u1',
      email: 'a@example.com',
      displayName: 'Ada',
      accountKind: 'adult',
      birthday: '1990-01-01',
      photoKey: 'photos/u1.jpg',
      phoneNumber: '+1 555 0100',
      needsProfileCompletion: false,
    });

    const pending: UserProfileItem = {
      ...complete,
      birthday: undefined,
      photoKey: undefined,
      phoneNumber: undefined,
    };
    expect(toUserProfile(pending).needsProfileCompletion).toBe(true);
    expect(toUserProfile(pending).photoKey).toBeUndefined();
    expect(toUserProfile(pending).phoneNumber).toBeUndefined();
  });
});
