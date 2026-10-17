/**
 * Unit tests for the request body hash sent to the function URLs.
 */

import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { CONTENT_SHA256_HEADER, sha256Hex, withContentHash } from './index.js';

/**
 * Hashes a UTF-8 string with Node for comparison.
 *
 * @param text - The message.
 * @returns The lowercase hex digest.
 */
const nodeSha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

describe('sha256Hex', () => {
  it('matches Node across block boundaries and multibyte text', () => {
    const samples = ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'a'.repeat(1000), '{"name":"Wildcats ⚾ 日本"}'];
    for (const sample of samples) {
      expect(sha256Hex(new TextEncoder().encode(sample))).toBe(nodeSha256(sample));
    }
  });
});

describe('withContentHash', () => {
  it('hashes JSON and empty write bodies and keeps plain header objects', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    const hashed = withContentHash(fetchMock);

    await hashed('https://example.com/api/teams', {
      method: 'post',
      headers: { authorization: 'Bearer t' },
      body: '{"name":"Wildcats"}',
    });
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]).toMatchObject({
      headers: { authorization: 'Bearer t', [CONTENT_SHA256_HEADER]: nodeSha256('{"name":"Wildcats"}') },
    });

    await hashed('https://example.com/api/identity/refresh', { method: 'POST' });
    expect((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1]).toMatchObject({
      headers: { [CONTENT_SHA256_HEADER]: nodeSha256('') },
    });
  });

  it('merges into Headers instances and skips reads and non-string bodies', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    const hashed = withContentHash(fetchMock);

    await hashed('https://example.com/api/chat', {
      method: 'DELETE',
      headers: new Headers({ authorization: 'Bearer t' }),
    });
    const merged = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Headers;
    expect(merged.get(CONTENT_SHA256_HEADER)).toBe(nodeSha256(''));
    expect(merged.get('authorization')).toBe('Bearer t');

    const get = { headers: { authorization: 'Bearer t' } };
    await hashed('https://example.com/api/teams', get);
    expect((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1]).toBe(get);

    const upload = { method: 'PUT', body: new Uint8Array([1, 2, 3]) };
    await hashed('https://example.com/upload', upload);
    expect((fetchMock.mock.calls[2] as unknown as [string, RequestInit])[1]).toBe(upload);
  });
});
