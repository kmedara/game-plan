/**
 * Seed session branch coverage.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/auth/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/auth/index.js')>();
  return {
    ...actual,
    getProfile: vi.fn(),
    seedUserId: () => 'seed-user',
    issueLocalTokens: () => ({
      accessToken: 'a',
      refreshToken: 'r',
      expiresIn: 3600,
    }),
    toUserProfile: (p: { userId: string; email: string }) => ({
      userId: p.userId,
      email: p.email,
      displayName: 'Seed',
      accountKind: 'adult' as const,
    }),
  };
});

const { issueSeedSession } = await import('./seed-session.js');
const auth = await import('../../../lib/auth/index.js');

describe('issueSeedSession', () => {
  afterEach(() => {
    vi.mocked(auth.getProfile).mockReset();
  });

  it('throws when the seed profile row is missing', async () => {
    vi.mocked(auth.getProfile).mockResolvedValueOnce(undefined);
    await expect(issueSeedSession()).rejects.toThrow('profile_not_found');
  });
});
