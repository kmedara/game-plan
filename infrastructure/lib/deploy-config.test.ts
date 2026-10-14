/**
 * Unit tests for CDK context and environment deploy settings.
 */

import { describe, expect, it } from 'vitest';
import { definedString, splitUrlList, urlListFromUnknown } from './deploy-config';

describe('deploy config', () => {
  it('drops blank strings', () => {
    expect(definedString('  ')).toBeUndefined();
    expect(definedString('https://app.example.com')).toBe('https://app.example.com');
    expect(definedString(1)).toBeUndefined();
  });

  it('splits comma-separated URLs', () => {
    expect(splitUrlList(' https://a.example/cb , https://b.example/cb ')).toEqual([
      'https://a.example/cb',
      'https://b.example/cb',
    ]);
    expect(splitUrlList(' , ')).toBeUndefined();
    expect(splitUrlList(undefined)).toBeUndefined();
  });

  it('reads a URL list from context as an array or a string', () => {
    expect(urlListFromUnknown(['https://a.example/', '  '])).toEqual(['https://a.example/']);
    expect(urlListFromUnknown('https://a.example/,https://b.example/')).toEqual([
      'https://a.example/',
      'https://b.example/',
    ]);
    expect(urlListFromUnknown(undefined)).toBeUndefined();
  });
});
