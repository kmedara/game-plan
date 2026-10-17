/**
 * Loads `/gameplan/` String parameters into `$GITHUB_ENV` for a later workflow step.
 *
 * Usage: `tsx infrastructure/scripts/load-ssm-env.ts`
 * `SSM_PREFIX` defaults to `/gameplan`. The AWS CLI reads Parameter Store.
 * Values are masked and not printed.
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import {
  envFromParameters,
  formatGithubEnv,
  normalizePrefix,
  type ParameterValue,
} from '../lib/ssm-parameters';

/** JSON body from `aws ssm get-parameters-by-path`. */
type ParametersPage = {
  Parameters?: { Name?: string; Value?: string }[];
};

/**
 * Reads every String parameter under the prefix. Decryption is off.
 *
 * The AWS CLI paginates internally. The process environment must already hold
 * credentials (GitHub OIDC in the deploy workflows).
 *
 * @param prefix - Hierarchy path such as `/gameplan`.
 * @returns Parameter names and values.
 */
const loadParameters = (prefix: string): ParameterValue[] => {
  const path = normalizePrefix(prefix).replace(/\/$/u, '');
  let stdout: string;
  try {
    stdout = execFileSync(
      'aws',
      ['ssm', 'get-parameters-by-path', '--path', path, '--recursive', '--output', 'json'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
    );
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message.split('\n')[0] : '';
    throw new Error(`aws ssm get-parameters-by-path failed for ${path}${detail === '' ? '' : `: ${detail}`}`);
  }
  const page = JSON.parse(stdout) as ParametersPage;
  const collected: ParameterValue[] = [];
  for (const parameter of page.Parameters ?? []) {
    if (parameter.Name !== undefined && parameter.Value !== undefined) {
      collected.push({ name: parameter.Name, value: parameter.Value });
    }
  }
  return collected;
};

/**
 * Masks each non-empty line so Actions logs do not show parameter values.
 *
 * @param value - A parameter value, possibly a multiline PEM.
 */
const maskValue = (value: string): void => {
  for (const line of value.split(/\r?\n/u)) {
    if (line.length > 0) {
      console.log(`::add-mask::${line}`);
    }
  }
};

const main = (): void => {
  const githubEnv = process.env.GITHUB_ENV;
  if (githubEnv === undefined || githubEnv.trim() === '') {
    throw new Error('GITHUB_ENV is not set');
  }

  const prefix = process.env.SSM_PREFIX ?? '/gameplan';
  const env = envFromParameters(prefix, loadParameters(prefix));

  for (const value of Object.values(env)) {
    maskValue(value);
  }
  appendFileSync(githubEnv, formatGithubEnv(env));
  console.log(`Loaded ${Object.keys(env).length} parameters from ${normalizePrefix(prefix)}`);
};

try {
  main();
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : 'Failed to load Parameter Store');
  process.exit(1);
}
