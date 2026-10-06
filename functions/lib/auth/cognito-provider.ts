/**
 * Amazon Cognito identity provider for cloud register, login, refresh, and logout.
 */

import {
  AdminConfirmSignUpCommand,
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  RevokeTokenCommand,
  SignUpCommand,
  UsernameExistsException,
  NotAuthorizedException,
  UserNotFoundException,
} from '@aws-sdk/client-cognito-identity-provider';
import type {
  IdentityProvider,
  IdentityTokens,
  LoginInput,
  RegisterInput,
} from './identity-provider.js';

/** Cached Cognito Identity Provider client. */
let cognitoClient: CognitoIdentityProviderClient | undefined;

/**
 * Reads Cognito pool and client ids from the environment.
 *
 * @returns The pool and app client ids.
 * @throws When either id is missing.
 */
const cognitoConfig = (): { userPoolId: string; clientId: string } => {
  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  const clientId = process.env.COGNITO_CLIENT_ID;
  if (userPoolId === undefined || clientId === undefined) {
    throw new Error('cognito_not_configured');
  }
  return { userPoolId, clientId };
};

/**
 * Returns a shared Cognito Identity Provider client.
 *
 * @returns The SDK client for the configured region.
 */
const getCognitoClient = (): CognitoIdentityProviderClient => {
  if (cognitoClient !== undefined) return cognitoClient;
  cognitoClient = new CognitoIdentityProviderClient({
    region: process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1',
  });
  return cognitoClient;
};

/**
 * Clears the cached Cognito client. Used by tests.
 */
export const resetCognitoClient = (): void => {
  cognitoClient = undefined;
};

/**
 * Maps Cognito auth result fields into the shared token shape.
 *
 * @param userId - The Cognito `sub`.
 * @param email - The account email.
 * @param auth - Authentication result from InitiateAuth.
 * @returns Shared identity tokens.
 */
const fromAuthResult = (
  userId: string,
  email: string,
  auth: {
    AccessToken?: string;
    RefreshToken?: string;
    ExpiresIn?: number;
  },
): IdentityTokens => {
  if (
    auth.AccessToken === undefined ||
    auth.RefreshToken === undefined ||
    auth.ExpiresIn === undefined
  ) {
    throw new Error('auth_failed');
  }
  return {
    accessToken: auth.AccessToken,
    refreshToken: auth.RefreshToken,
    expiresIn: auth.ExpiresIn,
    userId,
    email,
  };
};

/**
 * Creates the Cognito identity provider.
 *
 * @returns An {@link IdentityProvider} backed by the user pool.
 */
export const createCognitoIdentityProvider = (): IdentityProvider => ({
  async register(input: RegisterInput): Promise<IdentityTokens> {
    const { userPoolId, clientId } = cognitoConfig();
    const client = getCognitoClient();
    const email = input.email.trim().toLowerCase();

    let userSub: string;
    try {
      const signedUp = await client.send(
        new SignUpCommand({
          ClientId: clientId,
          Username: email,
          Password: input.password,
          UserAttributes: [
            { Name: 'email', Value: email },
            { Name: 'name', Value: input.displayName.trim() },
          ],
        }),
      );
      if (signedUp.UserSub === undefined) throw new Error('auth_failed');
      userSub = signedUp.UserSub;
    } catch (error) {
      if (error instanceof UsernameExistsException) throw new Error('email_taken');
      throw error;
    }

    // v1 has no email verification UI; confirm immediately so login works.
    await client.send(
      new AdminConfirmSignUpCommand({
        UserPoolId: userPoolId,
        Username: email,
      }),
    );

    const loggedIn = await client.send(
      new InitiateAuthCommand({
        AuthFlow: 'USER_PASSWORD_AUTH',
        ClientId: clientId,
        AuthParameters: {
          USERNAME: email,
          PASSWORD: input.password,
        },
      }),
    );

    return fromAuthResult(userSub, email, loggedIn.AuthenticationResult ?? {});
  },

  async login(input: LoginInput): Promise<IdentityTokens> {
    const { clientId } = cognitoConfig();
    const email = input.email.trim().toLowerCase();

    try {
      const loggedIn = await getCognitoClient().send(
        new InitiateAuthCommand({
          AuthFlow: 'USER_PASSWORD_AUTH',
          ClientId: clientId,
          AuthParameters: {
            USERNAME: email,
            PASSWORD: input.password,
          },
        }),
      );
      const accessToken = loggedIn.AuthenticationResult?.AccessToken;
      if (accessToken === undefined) throw new Error('invalid_credentials');

      // Decode the JWT payload without verifying here; verifyAccessToken is used on /me.
      const payloadPart = accessToken.split('.')[1];
      if (payloadPart === undefined) throw new Error('auth_failed');
      const payload = JSON.parse(
        Buffer.from(payloadPart, 'base64url').toString('utf8'),
      ) as { sub?: string };
      if (typeof payload.sub !== 'string') throw new Error('auth_failed');

      return fromAuthResult(payload.sub, email, {
        ...loggedIn.AuthenticationResult,
        // InitiateAuth always returns a refresh token on USER_PASSWORD_AUTH.
        RefreshToken: loggedIn.AuthenticationResult?.RefreshToken,
      });
    } catch (error) {
      if (
        error instanceof NotAuthorizedException ||
        error instanceof UserNotFoundException
      ) {
        throw new Error('invalid_credentials');
      }
      if (error instanceof Error && error.message === 'invalid_credentials') throw error;
      throw error;
    }
  },

  async refresh(refreshToken: string): Promise<IdentityTokens> {
    const { clientId } = cognitoConfig();

    try {
      const refreshed = await getCognitoClient().send(
        new InitiateAuthCommand({
          AuthFlow: 'REFRESH_TOKEN_AUTH',
          ClientId: clientId,
          AuthParameters: {
            REFRESH_TOKEN: refreshToken,
          },
        }),
      );
      const accessToken = refreshed.AuthenticationResult?.AccessToken;
      if (accessToken === undefined) throw new Error('invalid_token');

      const payloadPart = accessToken.split('.')[1];
      if (payloadPart === undefined) throw new Error('invalid_token');
      const payload = JSON.parse(
        Buffer.from(payloadPart, 'base64url').toString('utf8'),
      ) as { sub?: string; email?: string };
      if (typeof payload.sub !== 'string') throw new Error('invalid_token');

      return {
        accessToken,
        // Cognito may omit a new refresh token on refresh; reuse the existing one.
        refreshToken: refreshed.AuthenticationResult?.RefreshToken ?? refreshToken,
        expiresIn: refreshed.AuthenticationResult?.ExpiresIn ?? 3600,
        userId: payload.sub,
        email: typeof payload.email === 'string' ? payload.email : '',
      };
    } catch (error) {
      if (error instanceof NotAuthorizedException) throw new Error('invalid_token');
      throw error;
    }
  },

  async logout(refreshToken?: string): Promise<void> {
    if (refreshToken === undefined || refreshToken.length === 0) return;
    const { clientId } = cognitoConfig();
    try {
      await getCognitoClient().send(
        new RevokeTokenCommand({
          ClientId: clientId,
          Token: refreshToken,
        }),
      );
    } catch {
      // Best-effort revoke; clearing the cookie still ends the website session.
    }
  },
});
