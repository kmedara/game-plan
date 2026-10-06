/**
 * Helpers that resolve the AWS account and region for CDK stacks.
 */

import type { Environment } from 'aws-cdk-lib';

/**
 * Builds the CDK `env` object for a stack.
 *
 * Region is required for Cognito. Account is read from `CDK_DEFAULT_ACCOUNT` at deploy.
 *
 * @returns An {@link Environment} with account and region.
 */
export const getStackEnv = (): Environment => ({
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region:
    process.env.CDK_DEFAULT_REGION ??
    process.env.AWS_REGION ??
    process.env.AWS_DEFAULT_REGION ??
    'us-east-1',
});
