/**
 * Covers the local media root prefix guard when resolve escapes the directory.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve as pathResolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:path', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:path')>();
  return {
    ...original,
    resolve: (...args: string[]) => {
      const last = args[args.length - 1];
      if (typeof last === 'string' && last.includes('outside-trick')) {
        return pathResolve('C:\\outside-root', 'object.bin');
      }
      return original.resolve(...args);
    },
  };
});

import { putLocalObject, resetMediaStore } from './media-store.js';

describe('media-store escape guard', () => {
  let tempDir: string | undefined;

  afterEach(() => {
    resetMediaStore();
    if (tempDir !== undefined) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
    delete process.env.MEDIA_LOCAL_DIR;
  });

  it('rejects resolved paths outside the configured media directory', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'media-escape-'));
    process.env.MEDIA_LOCAL_DIR = tempDir;
    resetMediaStore();
    expect(() =>
      putLocalObject('uploads/u1/outside-trick.bin', 'bin', Buffer.from('x')),
    ).toThrow('invalid_object_key');
  });
});
