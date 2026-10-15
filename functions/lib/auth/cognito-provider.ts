/**
 * Amazon Cognito identity provider for cloud register, login, refresh, and logout.
 */

import {
  AdminDeleteUserCommand,
  AdminGetUserCommand,
  CodeMismatchException,
  CognitoIdentityProviderClient,
  ConfirmSignUpCommand,
  ExpiredCodeException,
  GetUserCommand,
  InitiateAuthCommand,
  InvalidParameterException,
  LimitExceededException,
  NotAuthorizedException,
  ResendConfirmationCodeCommand,
  RevokeTokenCommand,
  SignUpCommand,
  TooManyRequestsException,
  UsernameExistsException,
  UserNotConfirmedException,
  UserNotFoundException,
} from '@aws-sdk/client-cognito-identity-provider';
import type { LoginBody } from '@gameplan/types';
import type {
  IdentityProvider,
  IdentityTokens,
  RegisterInput,
  RegisterResult,
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
 * Reads the email attribute for an access token.
 *
 * Cognito access tokens do not include `email`. Hosted UI sign-in still has
 * the attribute on the user record, which `GetUser` returns.
 *
 * @param accessToken - A Cognito access token.
 * @returns The email, or `undefined` when Cognito has none.
 */
export const emailForAccessToken = async (
  accessToken: string,
): Promise<string | undefined> => {
  const user = await getCognitoClient().send(
    new GetUserCommand({ AccessToken: accessToken }),
  );
  const email = user.UserAttributes?.find((attribute) => attribute.Name === 'email')?.Value;
  const trimmed = email?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
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
 * Maps Cognito confirmation failures to stable identity errors.
 *
 * @param error - The SDK error.
 * @returns Never. Always throws a stable error or the original value.
 */
const throwConfirmationError = (error: unknown): never => {
  if (
    error instanceof CodeMismatchException ||
    error instanceof ExpiredCodeException ||
    error instanceof UserNotFoundException ||
    error instanceof NotAuthorizedException
  ) {
    throw new Error('invalid_confirmation_code');
  }
  if (error instanceof LimitExceededException || error instanceof TooManyRequestsException) {
    throw new Error('confirmation_throttled');
  }
  throw error;
};

/**
 * Creates the Cognito identity provider.
 *
 * Signup stays unconfirmed until the user submits the code Cognito emailed.
 * This provider never calls `AdminConfirmSignUp`.
 *
 * @returns An {@link IdentityProvider} backed by the user pool.
 */
export const createCognitoIdentityProvider = (): IdentityProvider => {
  /**
   * Creates an unconfirmed Cognito user.
   *
   * @param clientId - The app client id.
   * @param email - The normalized email.
   * @param input - The registration fields.
   * @returns The SignUp response.
   */
  const signUp = (clientId: string, email: string, input: RegisterInput) =>
    getCognitoClient().send(
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

  return {
  async register(input: RegisterInput): Promise<RegisterResult> {
    const { userPoolId, clientId } = cognitoConfig();
    const client = getCognitoClient();
    const email = input.email.trim().toLowerCase();

    let signedUp;
    try {
      signedUp = await signUp(clientId, email, input);
    } catch (error) {
      if (!(error instanceof UsernameExistsException)) throw error;
      const existing = await client.send(
        new AdminGetUserCommand({ UserPoolId: userPoolId, Username: email }),
      );
      // A previous signup that never proved the inbox can be replaced.
      // A confirmed account stays taken.
      if (existing.UserStatus !== 'UNCONFIRMED') throw new Error('email_taken');
      await client.send(
        new AdminDeleteUserCommand({ UserPoolId: userPoolId, Username: email }),
      );
      try {
        signedUp = await signUp(clientId, email, input);
      } catch (retryError) {
        if (retryError instanceof UsernameExistsException) throw new Error('email_taken');
        throw retryError;
      }
    }

    if (signedUp.UserSub === undefined) throw new Error('auth_failed');
    if (signedUp.UserConfirmed === true) throw new Error('email_not_confirmed');
    return { status: 'confirmation_required', userId: signedUp.UserSub, email };
  },

  async confirmRegistration(email: string, code: string): Promise<void> {
    const { clientId } = cognitoConfig();
    try {
      await getCognitoClient().send(
        new ConfirmSignUpCommand({
          ClientId: clientId,
          Username: email.trim().toLowerCase(),
          ConfirmationCode: code.trim(),
        }),
      );
    } catch (error) {
      throwConfirmationError(error);
    }
  },

  async resendConfirmation(email: string): Promise<void> {
    const { clientId } = cognitoConfig();
    try {
      await getCognitoClient().send(
        new ResendConfirmationCodeCommand({
          ClientId: clientId,
          Username: email.trim().toLowerCase(),
        }),
      );
    } catch (error) {
      if (
        error instanceof UserNotFoundException ||
        error instanceof InvalidParameterException ||
        error instanceof NotAuthorizedException
      ) {
        return;
      }
      throwConfirmationError(error);
    }
  },

  async login(input: LoginBody): Promise<IdentityTokens> {
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
      if (error instanceof UserNotConfirmedException) throw new Error('email_not_confirmed');
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
  };
};
