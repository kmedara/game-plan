/**
 * Mail for the domain: the production sending identity, the mail provider's
 * records on the bare domain, and Cognito's account email through SES.
 */

import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { GamePlanPlatform } from './gameplan-stack';
import { siteStackForTest } from './test-fixtures';

const dns = { hostedZoneId: 'Z0123456789ABCDEFGHIJ', siteHostname: 'production.example.com' };

const recordResources = (template: Template): Record<string, unknown>[] =>
  Object.values(template.findResources('AWS::CloudFormation::CustomResource'))
    .filter((resource) => resource.Properties.Mode === 'records')
    .map((resource) => resource.Properties as Record<string, unknown>);

describe('mail for the domain', () => {
  it('sends from the bare domain and keeps the mail provider records', () => {
    const { site } = siteStackForTest({
      siteHostname: dns.siteHostname,
      dns,
      emailDomain: 'example.com',
      mailRecords: [
        { name: 'example.com', type: 'MX', values: ['1 smtp.google.com'] },
        { name: '_dmarc.example.com', type: 'TXT', values: ['v=DMARC1; p=none'] },
      ],
    });
    const template = Template.fromStack(site);

    template.hasResourceProperties('AWS::SES::EmailIdentity', { EmailIdentity: 'example.com' });
    const records = recordResources(template);
    expect(records.find((props) => props.Cnames !== undefined)?.Cnames).toHaveLength(3);
    expect(records.find((props) => props.Records !== undefined)?.Records).toEqual([
      { Name: 'example.com', Type: 'MX', Values: ['1 smtp.google.com'] },
      { Name: '_dmarc.example.com', Type: 'TXT', Values: ['v=DMARC1; p=none'] },
    ]);
  });

  it('writes no mail provider records when none are configured', () => {
    const { site } = siteStackForTest({ siteHostname: dns.siteHostname, dns });
    expect(recordResources(Template.fromStack(site)).filter((props) => props.Records !== undefined)).toEqual([]);
  });

  it('verifies each test recipient so staging can reach them in the SES sandbox', () => {
    const { site } = siteStackForTest({ sesTestRecipients: ['a@example.com', 'b@example.com'] });
    const template = Template.fromStack(site);
    for (const address of ['a@example.com', 'b@example.com']) {
      template.hasResourceProperties('AWS::SES::EmailIdentity', { EmailIdentity: address });
    }
    expect(Object.keys(template.findResources('AWS::SES::EmailIdentity')).join(' ')).not.toContain('example');
  });

  it('sends Cognito account email through SES only when given a domain', () => {
    const platform = (sesEmailDomain?: string): Template => {
      const app = new cdk.App();
      return Template.fromStack(
        new GamePlanPlatform(app, 'GamePlanPlatform', {
          // SES needs a known region for the sender ARN; deploys always set one.
          env: { account: '123456789012', region: 'us-east-1' },
          corsOrigin: 'https://production.example.com',
          callbackUrls: ['https://production.example.com/api/identity/oauth/callback'],
          logoutUrls: ['https://production.example.com/login'],
          sesEmailDomain,
        }),
      );
    };

    platform('example.com').hasResourceProperties('AWS::Cognito::UserPool', {
      EmailConfiguration: Match.objectLike({
        EmailSendingAccount: 'DEVELOPER',
        From: 'GamePlan <no-reply@example.com>',
      }),
    });
    const pool = Object.values(platform().findResources('AWS::Cognito::UserPool'))[0];
    expect(pool?.Properties.EmailConfiguration?.EmailSendingAccount ?? 'COGNITO_DEFAULT').toBe('COGNITO_DEFAULT');
  });
});
