/**
 * Secrets read from AWS Systems Manager Parameter Store at run time.
 *
 * Deployed functions get only the parameter name in their environment, never
 * the value, so reading the function configuration does not reveal the secret.
 * A Secrets Manager secret is read the same way through its
 * `/aws/reference/secretsmanager/<name>` parameter path.
 *
 * The laptop has no Parameter Store, so outside production a function without
 * a parameter name reads the plain variable the local runner sets instead.
 */

import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

/** How long a fetched value is reused, so a rotated secret is picked up without a deploy. */
export const PARAMETER_CACHE_MS = 5 * 60 * 1000;

/** Fetched values by parameter name. Failures are not cached. */
const cache = new Map<string, { value: string | undefined; expiresAt: number }>();

/** Lazily created client shared by warm invocations. */
let client: SSMClient | undefined;

/**
 * Clears cached values and the client (tests only).
 */
export const resetParameterCache = (): void => {
  cache.clear();
  client = undefined;
};

/**
 * Reads one parameter, decrypting a `SecureString`.
 *
 * @param name - The full parameter name or Secrets Manager reference path.
 * @returns The trimmed value, or `undefined` when it is blank.
 * @throws When Parameter Store rejects the call, such as a missing parameter.
 */
export const getParameter = async (name: string): Promise<string | undefined> => {
  const cached = cache.get(name);
  if (cached !== undefined && cached.expiresAt > Date.now()) return cached.value;
  client ??= new SSMClient({});
  const result = await client.send(new GetParameterCommand({ Name: name, WithDecryption: true }));
  const raw = result.Parameter?.Value?.trim() ?? '';
  const value = raw.length > 0 ? raw : undefined;
  cache.set(name, { value, expiresAt: Date.now() + PARAMETER_CACHE_MS });
  return value;
};

/**
 * Reads a secret whose parameter name is in `parameterEnv`.
 *
 * @param parameterEnv - Variable holding the parameter name, such as `VAPID_PRIVATE_KEY_PARAMETER`.
 * @param localEnv - Variable holding the value on the laptop, such as `VAPID_PRIVATE_KEY`.
 *   Ignored in production.
 * @returns The secret, or `undefined` when it is not configured or cannot be read.
 */
export const readSecret = async (
  parameterEnv: string,
  localEnv: string,
): Promise<string | undefined> => {
  const name = process.env[parameterEnv]?.trim() ?? '';
  if (name.length > 0) {
    try {
      return await getParameter(name);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: 'parameter_read_failed',
          parameter: name,
          error: error instanceof Error ? error.name : String(error),
        }),
      );
      return undefined;
    }
  }
  if (process.env.NODE_ENV === 'production') return undefined;
  const local = process.env[localEnv]?.trim() ?? '';
  return local.length > 0 ? local : undefined;
};
