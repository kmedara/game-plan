/**
 * Factory helpers that create the Node.js Lambda functions for each product area.
 */

import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat, type BundlingOptions } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';
import { AREAS, type Area } from './names';

/** Absolute path to the repository root (the parent of `infrastructure/`). */
const repoRoot = path.join(__dirname, '../..');

/**
 * Shared esbuild options for every area function.
 *
 * The banner reintroduces `require` for dependencies that still call it after the
 * bundle is emitted as ECMAScript modules.
 */
const bundling: BundlingOptions = {
  format: OutputFormat.ESM,
  target: 'node22',
  mainFields: ['module', 'main'],
  minify: true,
  sourceMap: true,
  banner:
    "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
};

/**
 * Resolves the entry file for an area Lambda under `functions/<area>/src`.
 *
 * @param area - The product area folder name.
 * @param file - The TypeScript file name inside `src/`. Defaults to `handler.ts`.
 * @returns An absolute path to the entry module.
 */
export const areaEntry = (area: string, file = 'handler.ts'): string =>
  path.join(repoRoot, 'functions', area, 'src', file);

/**
 * Creates one Node.js 22 Lambda with a dedicated log group.
 *
 * @param scope - The CDK construct that owns the function.
 * @param id - The construct id and the suffix of the function name.
 * @param entry - Absolute path to the handler entry file.
 * @param environment - Environment variables for the function.
 * @param timeoutSeconds - The invocation timeout in seconds. Defaults to 29.
 * @returns The created {@link NodejsFunction}.
 */
export const createFunction = (
  scope: Construct,
  id: string,
  entry: string,
  environment: Record<string, string>,
  timeoutSeconds = 29,
): NodejsFunction => {
  const logGroup = new logs.LogGroup(scope, `${id}Logs`, {
    logGroupName: `/gameplan/${id}`,
    retention: logs.RetentionDays.ONE_MONTH,
    removalPolicy: cdk.RemovalPolicy.DESTROY,
  });

  return new NodejsFunction(scope, id, {
    functionName: `gameplan-${id}`,
    entry,
    projectRoot: repoRoot,
    depsLockFilePath: path.join(repoRoot, 'package-lock.json'),
    handler: 'handler',
    runtime: lambda.Runtime.NODEJS_22_X,
    architecture: lambda.Architecture.ARM_64,
    memorySize: 512,
    timeout: cdk.Duration.seconds(timeoutSeconds),
    environment,
    logGroup,
    bundling,
  });
};

/**
 * Creates one Lambda per product area.
 *
 * @param scope - The CDK construct that owns the functions.
 * @param environmentFor - A function that returns environment variables for an area.
 * @returns A map from each {@link Area} to its {@link NodejsFunction}.
 */
export const createAreaFunctions = (
  scope: Construct,
  environmentFor: (area: Area) => Record<string, string>,
): Record<Area, NodejsFunction> => {
  const functions = {} as Record<Area, NodejsFunction>;
  for (const area of AREAS) {
    functions[area] = createFunction(scope, area, areaEntry(area), environmentFor(area));
  }
  return functions;
};
