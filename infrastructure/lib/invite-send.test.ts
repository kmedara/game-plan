/**
 * Invites sent from GamePlan: the teams function's sender settings and
 * permissions, and the SES identity on the website host.
 */

import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { GamePlanApi, GamePlanPlatform, type GamePlanApiProps } from './gameplan-stack';
import { siteStackForTest } from './test-fixtures';

const SMS_NUMBER = 'arn:aws:sms-voice:us-east-1:123456789012:phone-number/phone-abc';

const apiTemplate = (extra: Partial<GamePlanApiProps>): Template => {
  // Only the template is checked, so skip bundling the function code.
  const app = new cdk.App({ context: { 'aws:cdk:bundling-stacks': [] } });
  const platform = new GamePlanPlatform(app, 'GamePlanPlatform', {
    corsOrigin: 'https://staging.example.com',
    callbackUrls: ['https://staging.example.com/api/identity/oauth/callback'],
    logoutUrls: ['https://staging.example.com/login'],
  });
  const stack = new GamePlanApi(app, 'GamePlanApi', {
    corsOrigin: 'https://staging.example.com',
    authCallbackUrl: 'https://staging.example.com/api/identity/oauth/callback',
    userPool: platform.userPool,
    userPoolClient: platform.userPoolClient,
    hostedUiDomain: platform.hostedUiDomain,
    table: platform.table,
    mediaBucket: platform.mediaBucket,
    ssmPrefix: '/gameplan',
    ...extra,
  });
  return Template.fromStack(stack);
};

describe('invites sent from GamePlan', () => {
  it('lets teams send only from the website host and the registered number', () => {
    const template = apiTemplate({ inviteEmailDomain: 'staging.example.com', smsOriginationIdentity: SMS_NUMBER });

    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'gameplan-teams',
      Environment: {
        Variables: Match.objectLike({
          INVITE_EMAIL_FROM: 'invites@staging.example.com',
          SMS_ORIGINATION_IDENTITY: SMS_NUMBER,
        }),
      },
    });
    const statements = Object.values(template.findResources('AWS::IAM::Policy')).flatMap(
      (policy) => policy.Properties.PolicyDocument.Statement as { Action: unknown; Resource: unknown }[],
    );
    const ses = statements.find((statement) => statement.Action === 'ses:SendEmail');
    expect(JSON.stringify(ses?.Resource)).toContain(':identity/staging.example.com');
    const sms = statements.find((statement) => statement.Action === 'sms-voice:SendTextMessage');
    expect(JSON.stringify(sms?.Resource)).toContain(SMS_NUMBER);
  });

  it('leaves both channels on the person’s own apps when nothing is configured', () => {
    const template = apiTemplate({});

    const teams = Object.values(template.findResources('AWS::Lambda::Function')).find(
      (fn) => fn.Properties.FunctionName === 'gameplan-teams',
    );
    const variables = teams?.Properties.Environment.Variables as Record<string, unknown>;
    expect(variables.INVITE_EMAIL_FROM).toBeUndefined();
    expect(variables.SMS_ORIGINATION_IDENTITY).toBeUndefined();
    expect(JSON.stringify(template.toJSON())).not.toMatch(/ses:SendEmail|sms-voice:SendTextMessage/u);
  });

  it('lets identity email the support inbox from the same host', () => {
    const template = apiTemplate({ inviteEmailDomain: 'staging.example.com', supportEmail: 'help@example.com' });

    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'gameplan-identity',
      Environment: {
        Variables: Match.objectLike({
          SUPPORT_EMAIL: 'help@example.com',
          SUPPORT_EMAIL_FROM: 'support@staging.example.com',
        }),
      },
    });
    const sends = Object.values(template.findResources('AWS::IAM::Policy')).filter((policy) =>
      JSON.stringify(policy.Properties.PolicyDocument).includes('ses:SendEmail'),
    );
    // One grant for teams (invites) and one for identity (support).
    expect(sends).toHaveLength(2);
  });

  it('sends no support mail without a verified host', () => {
    const template = apiTemplate({ supportEmail: 'help@example.com' });
    const identity = Object.values(template.findResources('AWS::Lambda::Function')).find(
      (fn) => fn.Properties.FunctionName === 'gameplan-identity',
    );
    expect(identity?.Properties.Environment.Variables.SUPPORT_EMAIL).toBeUndefined();
    expect(JSON.stringify(template.toJSON())).not.toMatch(/ses:SendEmail/u);
  });

  it('verifies the website host in SES and publishes its DKIM records', () => {
    const { site } = siteStackForTest({
      siteHostname: 'staging.example.com',
      dns: { hostedZoneId: 'Z0123456789ABCDEFGHIJ', siteHostname: 'staging.example.com' },
    });
    const template = Template.fromStack(site);

    template.hasResourceProperties('AWS::SES::EmailIdentity', { EmailIdentity: 'staging.example.com' });
    const records = Object.values(template.findResources('AWS::CloudFormation::CustomResource')).filter(
      (resource) => resource.Properties.Mode === 'records',
    );
    expect(records).toHaveLength(1);
    expect(records[0]?.Properties.Cnames).toHaveLength(3);
  });
});
