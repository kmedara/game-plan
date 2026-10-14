/**
 * Cognito pre sign-up trigger for staging.
 *
 * Allows an address only when it appears in the Parameter Store allowlist.
 * A missing parameter or a blank value rejects every sign-up.
 */

import type { PreSignUpTriggerHandler } from 'aws-lambda';

/** Cognito shows this message when the address is not on the allowlist. */
const REJECTED = 'Sign-up is not open for this email';

/**
 * Returns whether an email is listed.
 *
 * Comparison is case-insensitive. Entries may be separated by commas or whitespace.
 *
 * @param email - The address Cognito is about to create.
 * @param allowlist - Raw parameter value.
 * @returns `true` when the address is present.
 */
export const emailAllowed = (email: string | undefined, allowlist: string): boolean => {
  const normalized = email?.trim().toLowerCase() ?? '';
  if (normalized.length === 0) return false;
  const allowed = new Set(
    allowlist
      .split(/[\s,]+/u)
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0),
  );
  return allowed.has(normalized);
};

/**
 * Rejects a Cognito sign-up whose email is not on the allowlist.
 *
 * @param event - The pre sign-up trigger event.
 * @returns The same event when the address is allowed.
 */
export const handler: PreSignUpTriggerHandler = async (event) => {
  const name = process.env.ALLOWLIST_PARAMETER?.trim() ?? '';
  if (name.length === 0) throw new Error(REJECTED);

  let allowlist = '';
  try {
    const { GetParameterCommand, SSMClient } = await import('@aws-sdk/client-ssm');
    const result = await new SSMClient({}).send(new GetParameterCommand({ Name: name }));
    allowlist = result.Parameter?.Value ?? '';
  } catch {
    throw new Error(REJECTED);
  }

  if (!emailAllowed(event.request.userAttributes.email, allowlist)) {
    throw new Error(REJECTED);
  }
  return event;
};
