/**
 * Unit tests for the DynamoDB-backed local identity provider.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserProfileItem } from './identity-provider.js';
import { issueLocalTokens, verifyLocalJwt } from './local-jwt.js';

const mockPutItem = vi.fn();
const mockGetItem = vi.fn();
const mockFindProfileByEmail = vi.fn();

vi.mock('../dynamo/access.js', () => ({
  getItem: (...args: unknown[]) => mockGetItem(...args),
  putItem: (...args: unknown[]) => mockPutItem(...args),
}));

vi.mock('./profile.js', () => ({
  findProfileByEmail: (...args: unknown[]) => mockFindProfileByEmail(...args),
}));

const { createLocalIdentityProvider } = await import('./local-provider.js');

describe('createLocalIdentityProvider', () => {
  beforeEach(() => {
    mockPutItem.mockReset();
    mockGetItem.mockReset();
    mockFindProfileByEmail.mockReset();
    process.env.LOCAL_JWT_SECRET = 'local-provider-test-secret';
  });

  it('registers a new account and stores a scrypt password hash', async () => {
    mockFindProfileByEmail.mockResolvedValueOnce(undefined);
    mockPutItem.mockResolvedValueOnce(undefined);

    const provider = createLocalIdentityProvider();
    const tokens = await provider.register({
      email: '  Ada@Example.COM ',
      password: 'secret-pass',
      displayName: '  Ada  ',
      accountKind: 'adult',
    });

    expect(tokens.email).toBe('ada@example.com');
    expect(tokens.userId).toMatch(/^[a-f0-9]{32}$/u);
    expect(verifyLocalJwt(tokens.accessToken).token_use).toBe('access');
    expect(mockPutItem).toHaveBeenCalledOnce();
    const stored = mockPutItem.mock.calls[0][0] as UserProfileItem;
    expect(stored.passwordHash).toMatch(/^scrypt\$/u);
  });

  it('rejects registration when the email is already taken', async () => {
    mockFindProfileByEmail.mockResolvedValueOnce({ userId: 'existing' });

    await expect(
      createLocalIdentityProvider().register({
        email: 'taken@example.com',
        password: 'x',
        displayName: 'X',
        accountKind: 'adult',
      }),
    ).rejects.toThrow('email_taken');
  });

  it('logs in with a valid password and rejects bad credentials', async () => {
    mockFindProfileByEmail.mockResolvedValueOnce(undefined);
    mockPutItem.mockResolvedValueOnce(undefined);
    await createLocalIdentityProvider().register({
      email: 'fresh@example.com',
      password: 'good-pass',
      displayName: 'Fresh',
      accountKind: 'adult',
    });
    const hash = (mockPutItem.mock.calls[0][0] as UserProfileItem).passwordHash!;
    const profile: UserProfileItem = {
      PK: 'USER#u1',
      SK: 'PROFILE',
      userId: 'u1',
      email: 'fresh@example.com',
      displayName: 'Fresh',
      accountKind: 'adult',
      createdAt: '2026-01-01T00:00:00.000Z',
      passwordHash: hash,
    };

    mockFindProfileByEmail.mockResolvedValueOnce(profile);
    const loggedIn = await createLocalIdentityProvider().login({
      email: 'fresh@example.com',
      password: 'good-pass',
    });
    expect(loggedIn.email).toBe('fresh@example.com');

    mockFindProfileByEmail.mockResolvedValueOnce(undefined);
    await expect(
      createLocalIdentityProvider().login({ email: 'missing@example.com', password: 'x' }),
    ).rejects.toThrow('invalid_credentials');

    mockFindProfileByEmail.mockResolvedValueOnce({ ...profile, passwordHash: undefined });
    await expect(
      createLocalIdentityProvider().login({ email: 'fresh@example.com', password: 'x' }),
    ).rejects.toThrow('invalid_credentials');

    mockFindProfileByEmail.mockResolvedValueOnce({
      ...profile,
      passwordHash: 'scrypt$salt$ab',
    });
    await expect(
      createLocalIdentityProvider().login({ email: 'fresh@example.com', password: 'x' }),
    ).rejects.toThrow('invalid_credentials');

    mockFindProfileByEmail.mockResolvedValueOnce({ ...profile, passwordHash: 'not-scrypt' });
    await expect(
      createLocalIdentityProvider().login({ email: 'fresh@example.com', password: 'x' }),
    ).rejects.toThrow('invalid_credentials');

    mockFindProfileByEmail.mockResolvedValueOnce(profile);
    await expect(
      createLocalIdentityProvider().login({ email: 'fresh@example.com', password: 'wrong' }),
    ).rejects.toThrow('invalid_credentials');
  });

  it('refreshes tokens and rejects invalid refresh or missing profile', async () => {
    const provider = createLocalIdentityProvider();
    const { refreshToken } = issueLocalTokens('u-refresh', 'r@example.com');

    mockGetItem.mockResolvedValueOnce({
      userId: 'u-refresh',
      email: 'r@example.com',
    });
    const refreshed = await provider.refresh(refreshToken);
    expect(refreshed.userId).toBe('u-refresh');

    await expect(provider.refresh(refreshToken.replace('e', 'x'))).rejects.toThrow();

    const { accessToken } = issueLocalTokens('u2', 'b@example.com');
    await expect(provider.refresh(accessToken)).rejects.toThrow('invalid_token');

    mockGetItem.mockResolvedValueOnce(undefined);
    await expect(provider.refresh(refreshToken)).rejects.toThrow('profile_not_found');
  });

  it('logout is a no-op for local JWTs', async () => {
    await expect(createLocalIdentityProvider().logout('any')).resolves.toBeUndefined();
  });
});
