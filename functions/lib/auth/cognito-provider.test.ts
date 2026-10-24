/**
 * Unit tests for the Cognito identity provider.
 */

import {
  CodeMismatchException,
  LimitExceededException,
  NotAuthorizedException,
  UsernameExistsException,
  UserNotConfirmedException,
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
        displayName: 'A B',
        firstName: 'A',
        lastName: 'B',
        accountKind: 'adult',
      }),
    ).rejects.toThrow('cognito_not_configured');
  });

  it('registers an unconfirmed user and does not issue tokens', async () => {
    mockSend.mockResolvedValueOnce({ UserSub: 'cognito-sub-1', UserConfirmed: false });

    const registered = await createCognitoIdentityProvider().register({
      email: '  New@Example.com ',
      password: 'Secret1!',
      displayName: '  New User ',
      firstName: 'New',
      lastName: 'User',
      accountKind: 'adult',
    });

    expect(registered).toEqual({
      status: 'confirmation_required',
      userId: 'cognito-sub-1',
      email: 'new@example.com',
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0]?.[0]?.constructor?.name).toBe('SignUpCommand');
  });

  it('refuses a signup Cognito already marked confirmed', async () => {
    mockSend.mockResolvedValueOnce({ UserSub: 'cognito-sub-2', UserConfirmed: true });
    await expect(
      createCognitoIdentityProvider().register({
        email: 'bare@example.com',
        password: 'Secret1!',
        displayName: 'Bare Name',
        firstName: 'Bare',
        lastName: 'Name',
        accountKind: 'adult',
      }),
    ).rejects.toThrow('email_not_confirmed');
  });

  it('replaces an unconfirmed duplicate and keeps a confirmed email taken', async () => {
    const provider = createCognitoIdentityProvider();
    const input = {
      email: 'dup@example.com',
      password: 'x',
      displayName: 'D E',
      firstName: 'D',
      lastName: 'E',
      accountKind: 'adult' as const,
    };

    mockSend
      .mockRejectedValueOnce(new UsernameExistsException({ message: 'exists', $metadata: {} }))
      .mockResolvedValueOnce({ UserStatus: 'UNCONFIRMED' })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ UserSub: 'replaced-sub', UserConfirmed: false });
    await expect(provider.register(input)).resolves.toEqual({
      status: 'confirmation_required',
      userId: 'replaced-sub',
      email: 'dup@example.com',
    });
    expect(mockSend.mock.calls.map((call) => call[0]?.constructor?.name)).toEqual([
      'SignUpCommand',
      'AdminGetUserCommand',
      'AdminDeleteUserCommand',
      'SignUpCommand',
    ]);

    mockSend
      .mockRejectedValueOnce(new UsernameExistsException({ message: 'exists', $metadata: {} }))
      .mockResolvedValueOnce({ UserStatus: 'CONFIRMED' });
    await expect(provider.register(input)).rejects.toThrow('email_taken');

    mockSend.mockResolvedValueOnce({ UserSub: undefined });
    await expect(provider.register(input)).rejects.toThrow('auth_failed');
  });

  it('confirms a signup code and hides resend misses', async () => {
    const provider = createCognitoIdentityProvider();
    mockSend.mockResolvedValueOnce({});
    await expect(provider.confirmRegistration('Ada@Example.com', ' 123456 ')).resolves.toBeUndefined();
    expect(mockSend.mock.calls[0]?.[0]?.constructor?.name).toBe('ConfirmSignUpCommand');

    mockSend.mockRejectedValueOnce(new CodeMismatchException({ message: 'bad', $metadata: {} }));
    await expect(provider.confirmRegistration('ada@example.com', '000000')).rejects.toThrow(
      'invalid_confirmation_code',
    );

    mockSend.mockRejectedValueOnce(new LimitExceededException({ message: 'slow', $metadata: {} }));
    await expect(provider.resendConfirmation('ada@example.com')).rejects.toThrow(
      'confirmation_throttled',
    );

    mockSend.mockRejectedValueOnce(new UserNotFoundException({ message: 'missing', $metadata: {} }));
    await expect(provider.resendConfirmation('missing@example.com')).resolves.toBeUndefined();
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

    mockSend.mockRejectedValueOnce(
      new UserNotConfirmedException({ message: 'unconfirmed', $metadata: {} }),
    );
    await expect(
      createCognitoIdentityProvider().login({ email: 'a@example.com', password: 'x' }),
    ).rejects.toThrow('email_not_confirmed');

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
