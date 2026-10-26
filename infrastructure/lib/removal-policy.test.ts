/**
 * Resources holding data that cannot be rebuilt survive a stack delete.
 */

import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { GamePlanPlatform } from './gameplan-stack';

describe('stateful resources', () => {
  it('retains the user pool, table, media bucket, and Terraform state bucket, and never empties a bucket', () => {
    const app = new cdk.App();
    const platform = new GamePlanPlatform(app, 'GamePlanPlatform', {
      corsOrigin: 'https://staging.example.com',
      callbackUrls: ['https://staging.example.com/api/identity/oauth/callback'],
      logoutUrls: ['https://staging.example.com/login'],
    });
    const template = Template.fromStack(platform);
    for (const type of ['AWS::Cognito::UserPool', 'AWS::DynamoDB::Table', 'AWS::S3::Bucket']) {
      const resources = Object.values(template.findResources(type));
      expect(resources.length, type).toBeGreaterThan(0);
      for (const resource of resources) {
        expect(resource.DeletionPolicy, type).toBe('Retain');
        expect(resource.UpdateReplacePolicy, type).toBe('Retain');
      }
    }
    expect(Object.keys(template.findResources('Custom::S3AutoDeleteObjects'))).toEqual([]);

    const tables = Object.values(template.findResources('AWS::DynamoDB::Table'));
    expect(tables).toHaveLength(1);
    const table = tables[0]?.Properties as {
      ContributorInsightsSpecification?: { Enabled: boolean; Mode: string };
      GlobalSecondaryIndexes?: Array<{
        ContributorInsightsSpecification?: { Enabled: boolean; Mode: string };
      }>;
    };
    const insights = { Enabled: true, Mode: 'ACCESSED_AND_THROTTLED_KEYS' };
    expect(table.ContributorInsightsSpecification).toEqual(insights);
    expect(table.GlobalSecondaryIndexes).toHaveLength(2);
    for (const index of table.GlobalSecondaryIndexes ?? []) {
      expect(index.ContributorInsightsSpecification).toEqual(insights);
    }
  });
});
