/**
 * Writes CDK stack outputs back to Parameter Store as Strings.
 *
 * Usage: `tsx infrastructure/scripts/publish-stack-outputs.ts cdk-outputs.json`
 * `SSM_PREFIX` defaults to `/gameplan`. The AWS CLI performs each `PutParameter`.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { missingEnv, normalizePrefix, OUTPUT_PARAMETERS, parametersFromOutputs } from '../lib/ssm-parameters';

/**
 * Writes one String parameter, overwriting an existing value.
 *
 * @param name - Full parameter name, including the prefix.
 * @param value - String value from a stack output.
 */
const putString = (name: string, value: string): void => {
  execFileSync(
    'aws',
    [
      'ssm',
      'put-parameter',
      '--cli-input-json',
      JSON.stringify({
        Name: name,
        Value: value,
        Type: 'String',
        Overwrite: true,
      }),
    ],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  );
};

const main = (): void => {
  const outputsPath = process.argv[2];
  if (outputsPath === undefined || outputsPath.trim() === '') {
    throw new Error('Usage: publish-stack-outputs.ts <cdk-outputs.json>');
  }

  const prefix = normalizePrefix(process.env.SSM_PREFIX ?? '/gameplan');
  const document: unknown = JSON.parse(readFileSync(outputsPath, 'utf8'));
  const parameters = parametersFromOutputs(document);
  const missing = missingEnv(
    Object.fromEntries(Object.values(OUTPUT_PARAMETERS).map((suffix) => [suffix, parameters[suffix] ?? ''])),
    Object.values(OUTPUT_PARAMETERS),
  );
  if (missing.length > 0) {
    throw new Error(`CDK outputs file is missing: ${missing.join(', ')}`);
  }

  for (const [suffix, value] of Object.entries(parameters)) {
    const name = `${prefix}${suffix}`;
    putString(name, value);
    console.log(`Wrote ${name}`);
  }
};

try {
  main();
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : 'Failed to publish stack outputs');
  process.exit(1);
}
