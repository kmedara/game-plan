/**
 * Media store coverage for local objects, S3 presign and CDN paths, and key validation.
 */

import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getSignedUrl = vi.fn(async (..._args: unknown[]) => 'https://s3.example/signed');

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: unknown[]) => getSignedUrl(...args),
}));

vi.mock('@aws-sdk/client-s3', () => {
  class S3Client {
    send = vi.fn();
  }
  class PutObjectCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  class GetObjectCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  return { S3Client, PutObjectCommand, GetObjectCommand };
});

const {
  createDownloadUrl,
  createUploadUrl,
  getLocalObject,
  isLocalMedia,
  putLocalObject,
  resetMediaStore,
} = await import('./media-store.js');

describe('media-store', () => {
  let tempDir: string | undefined;

  beforeEach(() => {
    resetMediaStore();
    getSignedUrl.mockClear();
    delete process.env.MEDIA_LOCAL;
    delete process.env.MEDIA_LOCAL_DIR;
    delete process.env.MEDIA_BUCKET;
    delete process.env.MEDIA_PUBLIC_ORIGIN;
    process.env.DYNAMODB_ENDPOINT = 'http://127.0.0.1:8000';
  });

  afterEach(() => {
    resetMediaStore();
    if (tempDir !== undefined) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it('detects local media from MEDIA_LOCAL or DynamoDB endpoint', () => {
    expect(isLocalMedia()).toBe(true);
    delete process.env.DYNAMODB_ENDPOINT;
    expect(isLocalMedia()).toBe(false);
    process.env.MEDIA_LOCAL = '1';
    expect(isLocalMedia()).toBe(true);
  });

  it('uses the default public origin when MEDIA_PUBLIC_ORIGIN is unset', async () => {
    delete process.env.MEDIA_PUBLIC_ORIGIN;
    const upload = await createUploadUrl('user-1', {
      contentType: 'image/png',
      contentLength: 10,
    });
    expect(upload.uploadUrl).toContain('http://127.0.0.1:3000/media/local-objects/');
  });

  it('presigns local upload and download URLs', async () => {
    process.env.MEDIA_PUBLIC_ORIGIN = 'http://localhost:3000';
    const upload = await createUploadUrl('user-1', {
      contentType: 'image/png',
      contentLength: 10,
    });
    expect(upload.uploadUrl).toContain('http://localhost:3000/media/local-objects/');
    expect(upload.objectKey.startsWith('uploads/user-1/')).toBe(true);

    const download = await createDownloadUrl(upload.objectKey);
    expect(download.downloadUrl).toContain(encodeURIComponent(upload.objectKey));
  });

  it('rejects unsafe download keys in local mode', async () => {
    await expect(createDownloadUrl('../escape')).rejects.toThrow('invalid_object_key');
    await expect(createDownloadUrl('/abs')).rejects.toThrow('invalid_object_key');
  });

  it('presigns S3 URLs when not in local mode', async () => {
    delete process.env.DYNAMODB_ENDPOINT;
    delete process.env.MEDIA_LOCAL;
    process.env.MEDIA_BUCKET = 'bucket';

    const upload = await createUploadUrl('user-1', {
      contentType: 'image/png',
      contentLength: 10,
    });
    expect(upload.uploadUrl).toBe('https://s3.example/signed');
    expect(getSignedUrl).toHaveBeenCalled();

    const download = await createDownloadUrl('uploads/user-1/a.png');
    expect(download.downloadUrl).toBe('https://s3.example/signed');
  });

  describe('CDN download URLs', () => {
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });

    beforeEach(() => {
      delete process.env.DYNAMODB_ENDPOINT;
      process.env.MEDIA_BUCKET = 'bucket';
      process.env.MEDIA_CDN_ORIGIN = 'https://site.example.com/';
      process.env.MEDIA_SIGNING_KEY_ID = 'K123';
      process.env.MEDIA_SIGNING_PRIVATE_KEY = privateKey;
    });

    afterEach(() => {
      delete process.env.MEDIA_CDN_ORIGIN;
      delete process.env.MEDIA_SIGNING_KEY_ID;
      delete process.env.MEDIA_SIGNING_PRIVATE_KEY;
    });

    it('signs a website URL that is stable within the signing window', async () => {
      const now = Date.UTC(2026, 9, 17, 12, 5);
      const first = await createDownloadUrl('uploads/user-1/a b', now);
      const later = await createDownloadUrl('uploads/user-1/a b', now + 50 * 60 * 1000);

      expect(first.downloadUrl.startsWith('https://site.example.com/uploads/user-1/a%20b?Expires=')).toBe(true);
      expect(first.downloadUrl).toContain('&Key-Pair-Id=K123');
      expect(first.expiresAt).toBe('2026-10-17T14:00:00.000Z');
      expect(later.downloadUrl).toBe(first.downloadUrl);
      expect(getSignedUrl).not.toHaveBeenCalled();
    });

    it('falls back to S3 for keys the distribution does not serve or without a key', async () => {
      const now = Date.UTC(2026, 9, 17, 12, 5);
      const other = await createDownloadUrl('teams/t1/logo', now);
      expect(other.downloadUrl).toBe('https://s3.example/signed');
      expect(other.expiresAt).toBe('2026-10-17T12:20:00.000Z');

      delete process.env.MEDIA_SIGNING_PRIVATE_KEY;
      const unsigned = await createDownloadUrl('uploads/user-1/a', now);
      expect(unsigned.downloadUrl).toBe('https://s3.example/signed');
    });
  });

  it('requires MEDIA_BUCKET for S3 presign', async () => {
    delete process.env.DYNAMODB_ENDPOINT;
    delete process.env.MEDIA_LOCAL;
    await expect(
      createUploadUrl('user-1', { contentType: 'image/png', contentLength: 1 }),
    ).rejects.toThrow('media_bucket_not_configured');
  });

  it('stores and reads local objects in memory and on disk', () => {
    const key = 'uploads/u1/file.bin';
    putLocalObject(key, 'application/octet-stream', Buffer.from('abc'));
    expect(getLocalObject(key)?.body.toString('utf8')).toBe('abc');

    tempDir = mkdtempSync(join(tmpdir(), 'media-store-'));
    process.env.MEDIA_LOCAL_DIR = tempDir;
    resetMediaStore();
    putLocalObject(key, 'text/plain', Buffer.from('disk'));
    resetMediaStore();
    expect(getLocalObject(key)?.contentType).toBe('text/plain');
    expect(getLocalObject(key)?.body.toString('utf8')).toBe('disk');
    expect(getLocalObject('uploads/u1/missing.bin')).toBeUndefined();
  });

  it('rejects oversized payloads and unsafe disk keys', () => {
    const huge = Buffer.alloc(16 * 1024 * 1024);
    expect(() => putLocalObject('uploads/u1/huge.bin', 'bin', huge)).toThrow(
      'payload_too_large',
    );

    tempDir = mkdtempSync(join(tmpdir(), 'media-store-'));
    process.env.MEDIA_LOCAL_DIR = tempDir;
    expect(() => putLocalObject('../x', 'bin', Buffer.from('x'))).toThrow(
      'invalid_object_key',
    );
    expect(() => putLocalObject('a\\b', 'bin', Buffer.from('x'))).toThrow(
      'invalid_object_key',
    );
  });

});
