/**
 * Unit tests for Parameter Store name mapping and stack-output publishing.
 */

import { describe, expect, it } from 'vitest';
import {
  envFromParameters,
  formatGithubEnv,
  missingEnv,
  parametersFromOutputs,
  REQUIRED_API_ENV,
  REQUIRED_CLIENT_ENV,
} from './ssm-parameters';

describe('ssm parameters', () => {
  it('maps names under the prefix and ignores unknown keys', () => {
    const env = envFromParameters('/gameplan', [
      { name: '/gameplan/client-origin', value: 'https://app.example.com' },
      { name: '/gameplan/google-client-secret', value: 'secret' },
      { name: '/gameplan/not-used', value: 'skip' },
      { name: '/other/client-origin', value: 'nope' },
    ]);
    expect(env).toEqual({
      CLIENT_ORIGIN: 'https://app.example.com',
      GOOGLE_CLIENT_SECRET: 'secret',
    });
  });

  it('accepts a prefix that already ends with a slash', () => {
    const env = envFromParameters('/gameplan/', [
      { name: '/gameplan/api-base-url', value: 'https://api.example.com' },
    ]);
    expect(env.API_BASE_URL).toBe('https://api.example.com');
  });

  it('reports blank required API and client variables', () => {
    expect(missingEnv({ CLIENT_ORIGIN: ' https://app.example.com ' }, REQUIRED_API_ENV)).toEqual([
      'CALLBACK_URLS',
      'LOGOUT_URLS',
    ]);
    expect(missingEnv({ API_BASE_URL: '' }, REQUIRED_CLIENT_ENV)).toEqual([
      'API_BASE_URL',
      'SITE_BUCKET_NAME',
      'SITE_DISTRIBUTION_ID',
    ]);
  });

  it('writes multiline values with a GitHub environment delimiter', () => {
    const block = formatGithubEnv({
      CLIENT_ORIGIN: 'https://app.example.com',
      APPLE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nline\n-----END PRIVATE KEY-----',
    });
    expect(block).toContain('CLIENT_ORIGIN=https://app.example.com\n');
    expect(block).toContain('APPLE_PRIVATE_KEY<<GP_SSM_EOF\n');
    expect(block).toContain('-----BEGIN PRIVATE KEY-----\nline\n-----END PRIVATE KEY-----\nGP_SSM_EOF\n');
  });

  it('reads stack outputs nested under the stack name', () => {
    expect(
      parametersFromOutputs({
        GamePlanStack: {
          HttpApiUrl: 'https://api.example.com',
          WebSocketUrl: 'wss://ws.example.com',
          SiteBucketName: 'site-bucket',
          SiteDistributionId: 'E123',
          SiteUrl: 'https://app.example.com',
        },
      }),
    ).toEqual({
      'api-base-url': 'https://api.example.com',
      'ws-base-url': 'wss://ws.example.com',
      'site-bucket-name': 'site-bucket',
      'site-distribution-id': 'E123',
      'site-url': 'https://app.example.com',
    });
  });
});
