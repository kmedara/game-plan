/**
 * Stacks shared by the infrastructure unit tests.
 */

import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { GamePlanSite, type GamePlanSiteProps } from './gameplan-stack';
import { HTTP_AREAS, type HttpArea } from './names';

/**
 * Builds a site stack against inline area functions.
 *
 * Inline code keeps synthesis fast; the real API stack bundles every area Lambda.
 *
 * @param props - Extra site props such as the hostname.
 * @returns The app, the site stack, and the stub API stack.
 */
export const siteStackForTest = (
  props: Partial<GamePlanSiteProps> = {},
): { app: cdk.App; site: GamePlanSite; api: cdk.Stack } => {
  const app = new cdk.App();
  const env = { account: '123456789012', region: 'us-east-1' };
  const api = new cdk.Stack(app, 'GamePlanApi', { env });
  const functions = {} as Record<HttpArea, lambda.IFunction>;
  const functionUrls = {} as Record<HttpArea, lambda.FunctionUrl>;
  for (const area of HTTP_AREAS) {
    const fn = new lambda.Function(api, `${area}Fn`, {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline('exports.handler = async () => ({ statusCode: 200 });'),
    });
    functions[area] = fn;
    functionUrls[area] = fn.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.AWS_IAM });
  }
  const site = new GamePlanSite(app, 'GamePlanSite', { env, functions, functionUrls, ...props });
  return { app, site, api };
};
