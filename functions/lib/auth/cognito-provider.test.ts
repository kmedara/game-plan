/**
 * Unit tests for the Cognito identity provider.
 */

import {
  NotAuthorizedException,
  UsernameExistsException,
  UserNotFoundException,
} from '@aws-sdk/client-cognito-identity-provider';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockSend = vi.fn();

vi.mock('@aws-sdk/client-cognito-identity-provider', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@aws-sdk/client-cognito-identity-provider')>();
  class CognitoIdentityProviderClient {
    send = mockSend;
  }
  return { ...actual, CognitoIdentityProviderClient };
});

const { createCognitoIdentityProvider, resetCognitoClient } = await import(
  './cognito-provider.js'
);

/**
 * Builds a fake access JWT whose payload is readable by the provider.
 *
 * @param payload - Claims embedded in the middle segment.
 * @returns A three-part JWT string.
 */
const fakeAccessJwt = (payload: Record<string, unknown>): string => {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `hdr.${body}.sig`;
};

describe('createCognitoIdentityProvider', () => {
  beforeEach(() => {
    mockSend.mockReset();
    resetCognitoClient();
    process.env.COGNITO_USER_POOL_ID = 'pool-1';
    process.env.COGNITO_CLIENT_ID = 'client-1';
    process.env.AWS_REGION = 'us-east-1';
  });

  it('defaults the Cognito client region from AWS_DEFAULT_REGION', async () => {
    delete process.env.AWS_REGION;
    process.env.AWS_DEFAULT_REGION = 'eu-west-1';
    resetCognitoClient();
    mockSend.mockResolvedValueOnce({});
    await createCognitoIdentityProvider().logout('refresh');
    expect(mockSend).toHaveBeenCalled();
    delete process.env.AWS_DEFAULT_REGION;
    resetCognitoClient();
    mockSend.mockResolvedValueOnce({});
    await createCognitoIdentityProvider().logout('refresh-2');
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  afterEach(() => {
    resetCognitoClient();
    delete process.env.COGNITO_USER_POOL_ID;
    delete process.env.COGNITO_CLIENT_ID;
    delete process.env.AWS_REGION;
  });

  it('throws when Cognito env vars are missing', async () => {
    delete process.env.COGNITO_USER_POOL_ID;
    await expect(
      createCognitoIdentityProvider().register({
        email: 'a@example.com',
        password: 'x',
        displayName: 'A',
        accountKind: 'adult',
      }),
    ).rejects.toThrow('cognito_not_configured');
  });

  it('registers, confirms, and logs in a new user', async () => {
    const accessToken = fakeAccessJwt({ sub: 'cognito-sub-1' });
    mockSend
      .mockResolvedValueOnce({ UserSub: 'cognito-sub-1' })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        AuthenticationResult: {
          AccessToken: accessToken,
          RefreshToken: 'refresh-1',
          ExpiresIn: 3600,
        },
      });

    const tokens = await createCognitoIdentityProvider().register({
      email: '  New@Example.com ',
      password: 'Secret1!',
      displayName: '  New User ',
      accountKind: 'adult',
    });

    expect(tokens).toEqual({
      accessToken,
      refreshToken: 'refresh-1',
      expiresIn: 3600,
      userId: 'cognito-sub-1',
      email: 'new@example.com',
    });
    expect(mockSend).toHaveBeenCalledTimes(3);
  });

  it('registers when post-confirm login omits AuthenticationResult', async () => {
    mockSend
      .mockResolvedValueOnce({ UserSub: 'cognito-sub-2' })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ AuthenticationResult: undefined });
    await expect(
      createCognitoIdentityProvider().register({
        email: 'bare@example.com',
        password: 'Secret1!',
        displayName: 'Bare',
        accountKind: 'adult',
      }),
    ).rejects.toThrow('auth_failed');
  });

  it('maps duplicate signup and missing auth fields to stable errors', async () => {
    mockSend.mockRejectedValueOnce(new UsernameExistsException({ message: 'exists' } as never));
    await expect(
      createCognitoIdentityProvider().register({
        email: 'dup@example.com',
        password: 'x',
        displayName: 'D',
        accountKind: 'adult',
      }),
    ).rejects.toThrow('email_taken');

    mockSend.mockResolvedValueOnce({ UserSub: undefined });
    await expect(
      createCognitoIdentityProvider().register({
        email: 'bad@example.com',
        password: 'x',
        displayName: 'B',
        accountKind: 'adult',
      }),
    ).rejects.toThrow('auth_failed');

    mockSend
      .mockResolvedValueOnce({ UserSub: 'sub' })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ AuthenticationResult: { AccessToken: 'only-access' } });
    await expect(
      createCognitoIdentityProvider().register({
        email: 'incomplete@example.com',
        password: 'x',
        displayName: 'I',
        accountKind: 'adult',
      }),
    ).rejects.toThrow('auth_failed');
  });

  it('logs in and maps Cognito failures to invalid_credentials', async () => {
    const accessToken = fakeAccessJwt({ sub: 'login-sub' });
    mockSend.mockResolvedValueOnce({
      AuthenticationResult: {
        AccessToken: accessToken,
        RefreshToken: 'r',
        ExpiresIn: 3600,
      },
    });
    const ok = await createCognitoIdentityProvider().login({
      email: 'login@example.com',
      password: 'pass',
    });
    expect(ok.userId).toBe('login-sub');

    mockSend.mockResolvedValueOnce({ AuthenticationResult: {} });
    await expect(
      createCognitoIdentityProvider().login({ email: 'a@example.com', password: 'x' }),
    ).rejects.toThrow('invalid_credentials');

    mockSend.mockResolvedValueOnce({
      AuthenticationResult: { AccessToken: 'not-a-jwt', RefreshToken: 'r', ExpiresIn: 3600 },
    });
    await expect(
      createCognitoIdentityProvider().login({ email: 'a@example.com', password: 'x' }),
    ).rejects.toThrow('auth_failed');

    mockSend.mockResolvedValueOnce({
      AuthenticationResult: {
        AccessToken: fakeAccessJwt({}),
        RefreshToken: 'r',
        ExpiresIn: 3600,
      },
    });
    await expect(
      createCognitoIdentityProvider().login({ email: 'a@example.com', password: 'x' }),
    ).rejects.toThrow('auth_failed');

    mockSend.mockRejectedValueOnce(new NotAuthorizedException({ message: 'nope' } as never));
    await expect(
      createCognitoIdentityProvider().login({ email: 'a@example.com', password: 'x' }),
    ).rejects.toThrow('invalid_credentials');

    mockSend.mockRejectedValueOnce(new UserNotFoundException({ message: 'missing' } as never));
    await expect(
      createCognitoIdentityProvider().login({ email: 'a@example.com', password: 'x' }),
    ).rejects.toThrow('invalid_credentials');
  });

  it('refreshes access tokens and reuses the prior refresh token when omitted', async () => {
    const accessToken = fakeAccessJwt({ sub: 'refresh-sub', email: 'r@example.com' });
    mockSend.mockResolvedValueOnce({
      AuthenticationResult: { AccessToken: accessToken, ExpiresIn: 7200 },
    });
    const tokens = await createCognitoIdentityProvider().refresh('old-refresh');
    expect(tokens).toMatchObject({
      accessToken,
      refreshToken: 'old-refresh',
      expiresIn: 7200,
      userId: 'refresh-sub',
      email: 'r@example.com',
    });

    mockSend.mockResolvedValueOnce({
      AuthenticationResult: {
        AccessToken: fakeAccessJwt({ sub: 's2' }),
        RefreshToken: 'new-refresh',
      },
    });
    const withNew = await createCognitoIdentityProvider().refresh('old-refresh');
    expect(withNew.refreshToken).toBe('new-refresh');

    mockSend.mockResolvedValueOnce({ AuthenticationResult: {} });
    await expect(createCognitoIdentityProvider().refresh('bad')).rejects.toThrow('invalid_token');

    mockSend.mockResolvedValueOnce({
      AuthenticationResult: { AccessToken: 'missing-payload-segment' },
    });
    await expect(createCognitoIdentityProvider().refresh('bad')).rejects.toThrow('invalid_token');

    mockSend.mockResolvedValueOnce({
      AuthenticationResult: { AccessToken: fakeAccessJwt({}) },
    });
    await expect(createCognitoIdentityProvider().refresh('bad')).rejects.toThrow('invalid_token');

    mockSend.mockRejectedValueOnce(new NotAuthorizedException({ message: 'bad' } as never));
    await expect(createCognitoIdentityProvider().refresh('bad')).rejects.toThrow('invalid_token');
  });

  it('revokes refresh tokens on logout when present', async () => {
    const provider = createCognitoIdentityProvider();
    await expect(provider.logout(undefined)).resolves.toBeUndefined();
    await expect(provider.logout('')).resolves.toBeUndefined();
    expect(mockSend).not.toHaveBeenCalled();

    mockSend.mockResolvedValueOnce({});
    await provider.logout('refresh-to-revoke');
    expect(mockSend).toHaveBeenCalledOnce();

    mockSend.mockRejectedValueOnce(new Error('network'));
    await expect(provider.logout('refresh-to-revoke')).resolves.toBeUndefined();
  });

});
