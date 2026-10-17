/**
 * Loads the stack outputs the website build needs into `$GITHUB_ENV`.
 *
 * Usage: `tsx infrastructure/scripts/load-outputs-env.ts cdk-outputs.json`
 * The file comes from `cdk deploy --outputs-file` earlier in the same job.
 */

import { appendFileSync, readFileSync } from 'node:fs';
import { envFromOutputs, formatGithubEnv, missingEnv, REQUIRED_CLIENT_ENV } from '../lib/ssm-parameters';

const main = (): void => {
  const outputsPath = process.argv[2];
  if (outputsPath === undefined || outputsPath.trim() === '') {
    throw new Error('Usage: load-outputs-env.ts <cdk-outputs.json>');
  }
  const githubEnv = process.env.GITHUB_ENV;
  if (githubEnv === undefined || githubEnv.trim() === '') {
    throw new Error('GITHUB_ENV is not set');
  }

  const env = envFromOutputs(JSON.parse(readFileSync(outputsPath, 'utf8')) as unknown);
  const missing = missingEnv(env, REQUIRED_CLIENT_ENV);
  if (missing.length > 0) {
    throw new Error(`CDK outputs file is missing: ${missing.join(', ')}`);
  }
  appendFileSync(githubEnv, formatGithubEnv(env));
  console.log(`Loaded ${Object.keys(env).join(', ')} from the stack outputs`);
};

try {
  main();
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : 'Failed to load stack outputs');
  process.exit(1);
}
