/**
 * Local HS256 JWT helpers for laptop identity without Amazon Cognito.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Default access-token lifetime (one hour). */
export const LOCAL_ACCESS_TTL_SECONDS = 60 * 60;

/** Default refresh-token lifetime (thirty days). */
export const LOCAL_REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30;

/** Claims carried by a local access or refresh JWT. */
export type LocalJwtClaims = {
  sub: string;
  email?: string;
  token_use: 'access' | 'refresh';
  iat: number;
  exp: number;
  jti?: string;
};

/**
 * Reads the HMAC secret used to sign local JWTs.
 *
 * @returns The secret string.
 */
export const localJwtSecret = (): string =>
  process.env.LOCAL_JWT_SECRET ?? 'local-dev-secret-change-me';

/**
 * Encodes a value as base64url without padding.
 *
 * @param value - Raw bytes or a UTF-8 string.
 * @returns A base64url string.
 */
const b64url = (value: Buffer | string): string =>
  Buffer.from(value)
    .toString('base64url')
    .replace(/=+$/u, '');

/**
 * Signs a local JWT with HS256.
 *
 * @param claims - The payload claims.
 * @returns A compact JWT string.
 */
export const signLocalJwt = (claims: LocalJwtClaims): string => {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify(claims));
  const data = `${header}.${payload}`;
  const signature = createHmac('sha256', localJwtSecret()).update(data).digest('base64url');
  return `${data}.${signature}`;
};

/**
 * Verifies a local HS256 JWT and returns its claims.
 *
 * @param token - The compact JWT string.
 * @returns The claims when the signature and expiry are valid.
 * @throws When the token is malformed, forged, or expired.
 */
export const verifyLocalJwt = (token: string): LocalJwtClaims => {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('invalid_token');
  const [header, payload, signature] = parts;
  if (header === undefined || payload === undefined || signature === undefined) {
    throw new Error('invalid_token');
  }

  const data = `${header}.${payload}`;
  const expected = createHmac('sha256', localJwtSecret()).update(data).digest('base64url');
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signature);
  if (
    expectedBuf.length !== actualBuf.length ||
    !timingSafeEqual(expectedBuf, actualBuf)
  ) {
    throw new Error('invalid_token');
  }

  let claims: LocalJwtClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as LocalJwtClaims;
  } catch {
    throw new Error('invalid_token');
  }

  if (typeof claims.sub !== 'string' || claims.sub.length === 0) {
    throw new Error('invalid_token');
  }
  if (claims.token_use !== 'access' && claims.token_use !== 'refresh') {
    throw new Error('invalid_token');
  }
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= Date.now()) {
    throw new Error('token_expired');
  }

  return claims;
};

/**
 * Issues a local access and refresh token pair for a user.
 *
 * @param userId - The user id (`sub`).
 * @param email - The account email.
 * @returns Access token, refresh token, and access lifetime in seconds.
 */
export const issueLocalTokens = (
  userId: string,
  email: string,
): { accessToken: string; refreshToken: string; expiresIn: number } => {
  const now = Math.floor(Date.now() / 1000);
  const accessToken = signLocalJwt({
    sub: userId,
    email,
    token_use: 'access',
    iat: now,
    exp: now + LOCAL_ACCESS_TTL_SECONDS,
  });
  const refreshToken = signLocalJwt({
    sub: userId,
    email,
    token_use: 'refresh',
    iat: now,
    exp: now + LOCAL_REFRESH_TTL_SECONDS,
    jti: randomBytes(16).toString('hex'),
  });
  return { accessToken, refreshToken, expiresIn: LOCAL_ACCESS_TTL_SECONDS };
};
