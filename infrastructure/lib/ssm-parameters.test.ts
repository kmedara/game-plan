/**
 * Unit tests for Parameter Store name mapping and stack-output publishing.
 */

import { describe, expect, it } from 'vitest';
import {
  envFromParameters,
  formatGithubEnv,
  missingEnv,
  parametersFromOutputs,
  REQUIRED_CLIENT_ENV,
} from './ssm-parameters';

describe('ssm parameters', () => {
  it('maps names under the prefix and ignores unknown keys', () => {
    const env = envFromParameters('/gameplan', [
      { name: '/gameplan/hosted-zone-id', value: 'Z0123456789ABCDEFGHIJ' },
      { name: '/gameplan/hosted-zone-name', value: 'example.com' },
      { name: '/gameplan/google-client-id', value: 'client-id' },
      { name: '/gameplan/google-client-secret', value: 'secret' },
      { name: '/gameplan/client-origin', value: 'https://app.example.com' },
      { name: '/gameplan/not-used', value: 'skip' },
      { name: '/other/google-client-id', value: 'nope' },
    ]);
    expect(env).toEqual({
      HOSTED_ZONE_ID: 'Z0123456789ABCDEFGHIJ',
      HOSTED_ZONE_NAME: 'example.com',
      GOOGLE_CLIENT_ID: 'client-id',
      GOOGLE_CLIENT_SECRET: 'secret',
    });
  });

  it('accepts a prefix that already ends with a slash', () => {
    const env = envFromParameters('/gameplan/', [
      { name: '/gameplan/api-base-url', value: 'https://api.example.com' },
    ]);
    expect(env.API_BASE_URL).toBe('https://api.example.com');
  });

  it('reports blank required client variables', () => {
    expect(missingEnv({ API_BASE_URL: ' https://api.example.com ' }, ['API_BASE_URL', 'SITE_BUCKET_NAME'])).toEqual([
      'SITE_BUCKET_NAME',
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

  it('limits published outputs to one stack', () => {
    expect(
      parametersFromOutputs(
        {
          GamePlanDns: {
            SiteCertificateArn: 'arn:aws:acm:us-east-1:1:certificate/site',
            ApiCertificateArn: 'arn:aws:acm:us-east-1:1:certificate/api',
            SiteBucketName: 'ignored',
          },
        },
        { SiteCertificateArn: 'site-certificate-arn', ApiCertificateArn: 'api-certificate-arn' },
      ),
    ).toEqual({
      'site-certificate-arn': 'arn:aws:acm:us-east-1:1:certificate/site',
      'api-certificate-arn': 'arn:aws:acm:us-east-1:1:certificate/api',
    });
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
