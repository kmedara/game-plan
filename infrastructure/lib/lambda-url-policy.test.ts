import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { denyFunctionUrlExceptSourceIps, stripeWebhookUrlDenySid } from './lambda-url-policy';

describe('denyFunctionUrlExceptSourceIps', () => {
  it('synthesizes a Deny InvokeFunctionUrl permission', () => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'Test');
    const fn = new lambda.Function(stack, 'Fn', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline('exports.handler = async () => {}'),
    });
    fn.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE });
    denyFunctionUrlExceptSourceIps(stack, 'IpDeny', fn, ['3.18.12.63/32']);
    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::Lambda::Permission', {
      Action: 'lambda:InvokeFunctionUrl',
      Principal: '*',
      FunctionUrlAuthType: 'NONE',
      Effect: 'Deny',
      Sid: stripeWebhookUrlDenySid,
      Condition: {
        NotIpAddress: {
          'aws:SourceIp': ['3.18.12.63/32'],
        },
      },
    });
  });
});
