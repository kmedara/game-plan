import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { restrictFunctionUrlToSourceIps, stripeWebhookUrlAllowSids } from './lambda-url-policy';

const stackWithPublicUrl = () => {
  const app = new cdk.App();
  const stack = new cdk.Stack(app, 'Test');
  const fn = new lambda.Function(stack, 'Fn', {
    runtime: lambda.Runtime.NODEJS_22_X,
    handler: 'index.handler',
    code: lambda.Code.fromInline('exports.handler = async () => {}'),
  });
  return { stack, fn };
};

describe('restrictFunctionUrlToSourceIps', () => {
  it('replaces the URL permissions with an IP-conditioned resource policy', () => {
    const { stack, fn } = stackWithPublicUrl();
    fn.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE });
    restrictFunctionUrlToSourceIps(stack, 'IpAllow', fn, ['3.18.12.63/32']);
    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::Lambda::Permission', 0);
    template.resourceCountIs('AWS::Lambda::ResourcePolicy', 1);
    const [policy] = Object.values(template.findResources('AWS::Lambda::ResourcePolicy'));
    const statements = policy?.Properties.PolicyDocument.Statement as Array<Record<string, unknown>>;
    expect(statements.map((statement) => statement.Sid)).toEqual([...stripeWebhookUrlAllowSids]);
    expect(statements[0]).toMatchObject({
      Effect: 'Allow',
      Principal: '*',
      Action: 'lambda:InvokeFunctionUrl',
      Condition: {
        StringEquals: { 'lambda:FunctionUrlAuthType': 'NONE' },
        IpAddress: { 'aws:SourceIp': ['3.18.12.63/32'] },
      },
    });
    expect(statements[1]).toMatchObject({
      Effect: 'Allow',
      Principal: '*',
      Action: 'lambda:InvokeFunction',
      Condition: {
        Bool: { 'lambda:InvokedViaFunctionUrl': 'true' },
        IpAddress: { 'aws:SourceIp': ['3.18.12.63/32'] },
      },
    });
  });

  it('refuses a function without a public URL or an empty allowlist', () => {
    const { stack, fn } = stackWithPublicUrl();
    expect(() => restrictFunctionUrlToSourceIps(stack, 'IpAllow', fn, ['3.18.12.63/32'])).toThrow(/invoke-function-url/u);
    fn.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE });
    expect(() => restrictFunctionUrlToSourceIps(stack, 'IpAllow', fn, [])).toThrow(/no source CIDRs/u);
  });
});
