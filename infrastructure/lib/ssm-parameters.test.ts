/**
 * Unit tests for Parameter Store name mapping and stack-output publishing.
 */

import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { GamePlanPlatform } from './gameplan-stack';
import {
  envFromParameters,
  formatGithubEnv,
  missingEnv,
  parametersFromOutputs,
  PLATFORM_OUTPUT_PARAMETERS,
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
      { name: '/gameplan/api-base-url', value: 'https://app.example.com/api' },
    ]);
    expect(env.API_BASE_URL).toBe('https://app.example.com/api');
  });

  it('reports blank required client variables', () => {
    expect(missingEnv({ API_BASE_URL: ' https://app.example.com/api ' }, ['API_BASE_URL', 'SITE_BUCKET_NAME'])).toEqual([
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
            SiteUrl: 'https://app.example.com',
            SiteBucketName: 'ignored',
          },
        },
        { SiteCertificateArn: 'site-certificate-arn', SiteUrl: 'site-url' },
      ),
    ).toEqual({
      'site-certificate-arn': 'arn:aws:acm:us-east-1:1:certificate/site',
      'site-url': 'https://app.example.com',
    });
  });

  it('reads stack outputs nested under the stack name', () => {
    expect(
      parametersFromOutputs({
        GamePlanStack: {
          HttpApiUrl: 'https://app.example.com/api',
          WebSocketUrl: 'wss://ws.example.com',
          SiteBucketName: 'site-bucket',
          SiteDistributionId: 'E123',
          SiteUrl: 'https://app.example.com',
        },
      }),
    ).toEqual({
      'api-base-url': 'https://app.example.com/api',
      'ws-base-url': 'wss://ws.example.com',
      'site-bucket-name': 'site-bucket',
      'site-distribution-id': 'E123',
      'site-url': 'https://app.example.com',
    });
  });

  it('reads nested construct outputs whose logical ids include a hash', () => {
    expect(
      parametersFromOutputs(
        {
          GamePlanPlatform: {
            StorageSiteBucketNameA0602231: 'site-bucket',
            StorageSiteDistributionIdC5FF3B81: 'E123',
            StorageSiteUrl67006B64: 'https://app.example.com',
            AuthUserPoolIdC0605E59: 'pool',
          },
        },
        PLATFORM_OUTPUT_PARAMETERS,
      ),
    ).toEqual({
      'site-bucket-name': 'site-bucket',
      'site-distribution-id': 'E123',
      'site-url': 'https://app.example.com',
    });
  });

  it('finds the site outputs in the platform template', () => {
    const app = new cdk.App();
    const stack = new GamePlanPlatform(app, 'GamePlanPlatform', {
      corsOrigin: 'https://app.example.com',
      callbackUrls: ['https://app.example.com/api/identity/oauth/callback'],
      logoutUrls: ['https://app.example.com/login'],
    });
    const keys = Object.keys(Template.fromStack(stack).toJSON().Outputs as object);
    const document = { GamePlanPlatform: Object.fromEntries(keys.map((key) => [key, 'value'])) };
    expect(Object.keys(parametersFromOutputs(document, PLATFORM_OUTPUT_PARAMETERS)).sort()).toEqual([
      'site-api-enabled',
      'site-bucket-name',
      'site-distribution-id',
      'site-url',
    ]);
  });
});
