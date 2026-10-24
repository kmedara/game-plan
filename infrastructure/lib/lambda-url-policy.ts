/**
 * Resource policies for public Lambda function URLs.
 */

import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

const DENY_SID = 'DenyInvokeFunctionUrlExceptStripeWebhookIps';

/**
 * Blocks function URL invokes that do not come from the listed source CIDRs.
 *
 * Stripe still verifies `Stripe-Signature` in the handler; this cuts noise from
 * scanners hitting the public URL.
 *
 * @param scope - Parent construct for the permission resource.
 * @param id - Unique construct id within the scope.
 * @param fn - A function whose URL uses {@link lambda.FunctionUrlAuthType.NONE}.
 * @param sourceCidrs - IAM CIDR strings, such as `3.18.12.63/32`.
 */
export const denyFunctionUrlExceptSourceIps = (
  scope: Construct,
  id: string,
  fn: lambda.IFunction,
  sourceCidrs: readonly string[],
): void => {
  if (sourceCidrs.length === 0) return;
  // CDK's L1 schema omits Deny/Condition on permissions; overrides match the API.
  const permission = new lambda.CfnPermission(scope, id, {
    action: 'lambda:InvokeFunctionUrl',
    functionName: fn.functionName,
    principal: '*',
    functionUrlAuthType: 'NONE',
  });
  permission.addPropertyOverride('Effect', 'Deny');
  permission.addPropertyOverride('Sid', DENY_SID);
  permission.addPropertyOverride('Condition', {
    StringEquals: {
      'lambda:FunctionUrlAuthType': 'NONE',
    },
    NotIpAddress: {
      'aws:SourceIp': [...sourceCidrs],
    },
  });
};

/** Stable statement id used on webhook function URL deny rules. */
export const stripeWebhookUrlDenySid = DENY_SID;
