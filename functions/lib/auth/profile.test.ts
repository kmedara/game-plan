/**
 * Unit tests for user profile DynamoDB helpers.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TABLE_NAME } from '../names.js';
import { GSI_EMAIL, profileSk, userPk } from '../dynamo/keys.js';

const mockSend = vi.fn();
const mockGetItem = vi.fn();
const mockPutItem = vi.fn();

vi.mock('../dynamo/client.js', () => ({
  getDocClient: () => ({ send: mockSend }),
  resetDocClient: vi.fn(),
}));

vi.mock('../dynamo/access.js', () => ({
  getItem: (...args: unknown[]) => mockGetItem(...args),
  putItem: (...args: unknown[]) => mockPutItem(...args),
}));

const { findProfileByEmail, getProfile, putProfile } = await import('./profile.js');

describe('profile helpers', () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockGetItem.mockReset();
    mockPutItem.mockReset();
  });

  it('loads a profile by user id', async () => {
    const item = { userId: 'u1', email: 'a@example.com' };
    mockGetItem.mockResolvedValueOnce(item);

    await expect(getProfile('u1')).resolves.toEqual(item);
    expect(mockGetItem).toHaveBeenCalledWith(userPk('u1'), profileSk());
  });

  it('finds a profile by email through the EmailIndex GSI', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [{ PK: userPk('u2'), SK: profileSk() }],
    });
    const profile = { userId: 'u2', email: 'find@example.com' };
    mockGetItem.mockResolvedValueOnce(profile);

    await expect(findProfileByEmail('find@example.com')).resolves.toEqual(profile);
    expect(mockSend.mock.calls[0][0].input).toMatchObject({
      TableName: TABLE_NAME,
      KeyConditionExpression: '#email = :email',
      ExpressionAttributeNames: { '#email': GSI_EMAIL },
    });
  });

  it('returns undefined when the email index has no match or incomplete keys', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });
    await expect(findProfileByEmail('missing@example.com')).resolves.toBeUndefined();

    mockSend.mockResolvedValueOnce({ Items: [{ PK: 'USER#u3' }] });
    await expect(findProfileByEmail('partial@example.com')).resolves.toBeUndefined();
  });

  it('writes profile rows with optional fields normalized', async () => {
    mockPutItem.mockResolvedValue(undefined);

    const stored = await putProfile({
      userId: 'u4',
      email: '  Write@Example.com ',
      displayName: '  Writer  ',
      accountKind: 'minor',
      birthday: '2010-01-01',
      photoKey: 'photos/u4.jpg',
      passwordHash: 'scrypt$abc',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    expect(stored).toMatchObject({
      userId: 'u4',
      email: 'write@example.com',
      displayName: 'Writer',
      birthday: '2010-01-01',
      photoKey: 'photos/u4.jpg',
      passwordHash: 'scrypt$abc',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    const clearedPhoto = await putProfile({
      userId: 'u5',
      email: 'clear@example.com',
      displayName: 'Clear',
      accountKind: 'adult',
      photoKey: null,
    });
    expect(clearedPhoto.photoKey).toBeUndefined();
  });
});
