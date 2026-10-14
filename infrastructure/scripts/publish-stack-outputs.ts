/**
 * Writes CDK stack outputs back to Parameter Store as Strings.
 *
 * Usage: `tsx infrastructure/scripts/publish-stack-outputs.ts cdk-outputs.json dns|platform|api`
 * `SSM_PREFIX` defaults to `/gameplan`. The AWS CLI performs each `PutParameter`.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  missingEnv,
  normalizePrefix,
  parametersFromOutputs,
  STACK_OUTPUT_PARAMETERS,
} from '../lib/ssm-parameters';

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
  const mode = process.argv[3];
  if (
    outputsPath === undefined ||
    outputsPath.trim() === '' ||
    (mode !== 'dns' && mode !== 'platform' && mode !== 'api')
  ) {
    throw new Error('Usage: publish-stack-outputs.ts <cdk-outputs.json> <dns|platform|api>');
  }

  const mapping = STACK_OUTPUT_PARAMETERS[mode];
  const prefix = normalizePrefix(process.env.SSM_PREFIX ?? '/gameplan');
  const document: unknown = JSON.parse(readFileSync(outputsPath, 'utf8'));
  const parameters = parametersFromOutputs(document, mapping);
  const missing = missingEnv(
    Object.fromEntries(Object.values(mapping).map((suffix) => [suffix, parameters[suffix] ?? ''])),
    Object.values(mapping),
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
