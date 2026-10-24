/**
 * Resource policies for public Lambda function URLs.
 */

import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

/** Child ids `FunctionUrl` uses for the permissions it adds on a `NONE` URL. */
const URL_PERMISSION_IDS = ['invoke-function-url', 'invoke-function'] as const;

const ALLOW_URL_SID = 'AllowFunctionUrlFromStripeWebhookIps';
const ALLOW_INVOKE_SID = 'AllowInvokeViaFunctionUrlFromStripeWebhookIps';

/**
 * Limits a public function URL to the listed source CIDRs.
 *
 * `AWS::Lambda::Permission` cannot carry conditions, so this replaces the two
 * permissions `addFunctionUrl` adds with one `AWS::Lambda::ResourcePolicy`.
 * Lambda advises against mixing the two on a function, so the function must
 * have no other permissions. Stripe still verifies `Stripe-Signature` in the
 * handler; this cuts noise from scanners hitting the public URL.
 *
 * @param scope - Parent construct for the policy resource.
 * @param id - Unique construct id within the scope.
 * @param fn - A function that already has a {@link lambda.FunctionUrlAuthType.NONE} URL.
 * @param sourceCidrs - IAM CIDR strings, such as `3.18.12.63/32`.
 */
export const restrictFunctionUrlToSourceIps = (
  scope: Construct,
  id: string,
  fn: lambda.Function,
  sourceCidrs: readonly string[],
): void => {
  if (sourceCidrs.length === 0) throw new Error(`${id}: no source CIDRs to allow`);
  for (const permissionId of URL_PERMISSION_IDS) {
    if (!fn.node.tryRemoveChild(permissionId)) {
      throw new Error(`${id}: ${fn.node.path} has no ${permissionId} permission; add the NONE URL first`);
    }
  }
  const sourceIp = { 'aws:SourceIp': [...sourceCidrs] };
  new lambda.CfnResourcePolicy(scope, id, {
    resourceArn: fn.functionArn,
    policyDocument: {
      Version: '2012-10-17',
      Statement: [
        {
          Sid: ALLOW_URL_SID,
          Effect: 'Allow',
          Principal: '*',
          Action: 'lambda:InvokeFunctionUrl',
          Resource: fn.functionArn,
          Condition: {
            StringEquals: { 'lambda:FunctionUrlAuthType': 'NONE' },
            IpAddress: sourceIp,
          },
        },
        {
          Sid: ALLOW_INVOKE_SID,
          Effect: 'Allow',
          Principal: '*',
          Action: 'lambda:InvokeFunction',
          Resource: fn.functionArn,
          Condition: {
            Bool: { 'lambda:InvokedViaFunctionUrl': 'true' },
            IpAddress: sourceIp,
          },
        },
      ],
    },
  });
};

/** Statement ids used on webhook function URL allow rules. */
export const stripeWebhookUrlAllowSids = [ALLOW_URL_SID, ALLOW_INVOKE_SID] as const;
