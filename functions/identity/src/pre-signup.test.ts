/**
 * Unit tests for the staging sign-up allowlist.
 */

import type { PreSignUpTriggerEvent } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';

const readSecret = vi.hoisted(() => vi.fn(async (): Promise<string | undefined> => undefined));
vi.mock('../../lib/parameters.js', () => ({ readSecret }));

const { emailAllowed, handler } = await import('./pre-signup.js');

const sample = 'Ada@Example.com, bob@example.com\ncara@example.com';

describe('emailAllowed', () => {
  it('allows an address on the list', () => {
    expect(emailAllowed('bob@example.com', sample)).toBe(true);
  });

  it('matches a different casing', () => {
    expect(emailAllowed('ada@example.com', sample)).toBe(true);
  });

  it('rejects an address that is not listed', () => {
    expect(emailAllowed('eve@example.com', sample)).toBe(false);
  });

  it('rejects every address when the list is blank', () => {
    expect(emailAllowed('ada@example.com', '')).toBe(false);
    expect(emailAllowed('ada@example.com', '  \n')).toBe(false);
    expect(emailAllowed(undefined, sample)).toBe(false);
  });
});

describe('pre sign-up handler', () => {
  const signUp = (email: string) =>
    ({ request: { userAttributes: { email } } }) as unknown as PreSignUpTriggerEvent;
  const run = (email: string) => handler(signUp(email), {} as never, () => undefined);

  it('reads the allowlist parameter and lets a listed address through', async () => {
    readSecret.mockResolvedValueOnce(sample);
    await expect(run('cara@example.com')).resolves.toMatchObject({ request: { userAttributes: { email: 'cara@example.com' } } });
    expect(readSecret).toHaveBeenCalledWith('ALLOWLIST_PARAMETER', 'SIGNUP_ALLOWLIST');
  });

  it('rejects an unlisted address, and every address when the list is unreadable', async () => {
    readSecret.mockResolvedValueOnce(sample);
    await expect(run('eve@example.com')).rejects.toThrow('Sign-up is not open');
    readSecret.mockResolvedValueOnce(undefined);
    await expect(run('ada@example.com')).rejects.toThrow('Sign-up is not open');
  });
});
