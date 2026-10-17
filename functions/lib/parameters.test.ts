/**
 * Unit tests for run-time secret reads from Parameter Store.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const send = vi.fn();

vi.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: class {
    send = send;
  },
  GetParameterCommand: class {
    constructor(readonly input: { Name: string; WithDecryption?: boolean }) {}
  },
}));

const { PARAMETER_CACHE_MS, getParameter, readSecret, resetParameterCache } = await import('./parameters.js');

describe('parameters', () => {
  beforeEach(() => {
    resetParameterCache();
    send.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.TEST_SECRET_PARAMETER;
    delete process.env.TEST_SECRET;
    process.env.NODE_ENV = 'test';
  });

  it('decrypts the parameter and reuses it until the cache expires', async () => {
    vi.useFakeTimers();
    send.mockResolvedValue({ Parameter: { Value: ' first ' } });
    await expect(getParameter('/gameplan/key')).resolves.toBe('first');
    await expect(getParameter('/gameplan/key')).resolves.toBe('first');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0].input).toEqual({ Name: '/gameplan/key', WithDecryption: true });

    send.mockResolvedValue({ Parameter: { Value: 'rotated' } });
    vi.advanceTimersByTime(PARAMETER_CACHE_MS + 1);
    await expect(getParameter('/gameplan/key')).resolves.toBe('rotated');
  });

  it('treats a blank value as unset', async () => {
    send.mockResolvedValue({ Parameter: { Value: '  ' } });
    await expect(getParameter('/gameplan/blank')).resolves.toBeUndefined();
  });

  it('reads the named parameter and never the plain variable when a name is set', async () => {
    process.env.TEST_SECRET_PARAMETER = '/gameplan/test-secret';
    process.env.TEST_SECRET = 'from-env';
    send.mockResolvedValue({ Parameter: { Value: 'from-ssm' } });
    await expect(readSecret('TEST_SECRET_PARAMETER', 'TEST_SECRET')).resolves.toBe('from-ssm');
  });

  it('returns undefined and retries later when the read fails', async () => {
    process.env.TEST_SECRET_PARAMETER = '/gameplan/missing';
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    send.mockRejectedValueOnce(Object.assign(new Error('nope'), { name: 'ParameterNotFound' }));
    await expect(readSecret('TEST_SECRET_PARAMETER', 'TEST_SECRET')).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('ParameterNotFound'));

    send.mockResolvedValueOnce({ Parameter: { Value: 'created' } });
    await expect(readSecret('TEST_SECRET_PARAMETER', 'TEST_SECRET')).resolves.toBe('created');
    error.mockRestore();
  });

  it('uses the plain variable on the laptop when no parameter name is set', async () => {
    process.env.TEST_SECRET = ' local ';
    await expect(readSecret('TEST_SECRET_PARAMETER', 'TEST_SECRET')).resolves.toBe('local');
    process.env.TEST_SECRET = '';
    await expect(readSecret('TEST_SECRET_PARAMETER', 'TEST_SECRET')).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });

  it('ignores the plain variable in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.TEST_SECRET = 'from-env';
    await expect(readSecret('TEST_SECRET_PARAMETER', 'TEST_SECRET')).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });
});
