/**
 * Writes the environment variables `npm run up:build` interpolates into `.env`.
 *
 * Cognito values come from CloudFormation exports. Maps keys come from Parameter Store
 * under `/gameplan/` and are optional. Existing `.env` lines for other names are kept.
 *
 * Usage: `node fetch-local-env.mjs --profile <name>`
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

/** CloudFormation export name to the variable Compose requires. */
const EXPORTS = {
  GamePlanUserPoolId: 'COGNITO_USER_POOL_ID',
  GamePlanUserPoolClientId: 'COGNITO_CLIENT_ID',
  GamePlanHostedUiDomain: 'COGNITO_HOSTED_UI_DOMAIN',
  GamePlanCognitoRegion: 'COGNITO_REGION',
};

/** Parameter Store suffix to an optional Compose variable. */
const PARAMETERS = {
  'google-maps-api-key': 'GOOGLE_MAPS_API_KEY',
  'google-maps-browser-api-key': 'GOOGLE_MAPS_BROWSER_API_KEY',
};

const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1';
const prefix = (process.env.SSM_PREFIX ?? '/gameplan').replace(/\/+$/u, '');

const profileFlag = process.argv.indexOf('--profile');
const profile =
  profileFlag === -1 ? process.env.AWS_PROFILE : process.argv[profileFlag + 1];
if (profile !== undefined && profile.trim() === '') {
  throw new Error('Usage: node fetch-local-env.mjs --profile <name>');
}

/**
 * Runs the AWS CLI and returns stdout.
 *
 * @param args - Arguments after `aws`.
 * @returns Trimmed stdout.
 */
const aws = (args) => {
  const command = [
    ...args,
    '--region',
    region,
    '--output',
    'text',
    ...(profile === undefined ? [] : ['--profile', profile]),
  ];
  return execFileSync('aws', command, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
};

/**
 * Reads one CloudFormation export.
 *
 * @param name - Export name such as `GamePlanUserPoolId`.
 * @returns The export value.
 */
const exportValue = (name) => {
  const value = aws([
    'cloudformation',
    'list-exports',
    '--query',
    `Exports[?Name=='${name}'].Value | [0]`,
  ]);
  if (value === '' || value === 'None') {
    throw new Error(`CloudFormation export ${name} was not found in ${region}`);
  }
  return value;
};

/**
 * Reads one String parameter. A missing parameter returns an empty string.
 *
 * @param name - Full parameter name.
 * @returns The parameter value, or `''` when the name does not exist.
 */
const parameterValue = (name) => {
  try {
    return aws(['ssm', 'get-parameter', '--name', name, '--query', 'Parameter.Value']);
  } catch {
    return '';
  }
};

/**
 * Parses a dotenv file into ordered keys.
 *
 * @param text - Raw `.env` contents.
 * @returns Keys in file order and a value map. Comments and blank lines are dropped.
 */
const parseEnv = (text) => {
  const order = [];
  const values = new Map();
  for (const line of text.split(/\r?\n/u)) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u.exec(line);
    if (match === null) continue;
    if (!values.has(match[1])) order.push(match[1]);
    values.set(match[1], match[2]);
  }
  return { order, values };
};

const fetched = new Map();
for (const [exportName, key] of Object.entries(EXPORTS)) {
  fetched.set(key, exportValue(exportName));
}
const missingMaps = [];
for (const [suffix, key] of Object.entries(PARAMETERS)) {
  const value = parameterValue(`${prefix}/${suffix}`);
  if (value === '') missingMaps.push(key);
  fetched.set(key, value);
}

let existing = '';
try {
  existing = readFileSync('.env', 'utf8');
} catch {
  existing = '';
}
const { order, values } = parseEnv(existing);
for (const [key, value] of fetched) {
  if (!values.has(key)) order.push(key);
  values.set(key, value);
}

const body = `${order.map((key) => `${key}=${values.get(key) ?? ''}`).join('\n')}\n`;
writeFileSync('.env', body);

console.log(`Wrote ${[...fetched.keys()].join(', ')} to .env from ${region}.`);
if (missingMaps.length > 0) {
  console.log(`Parameter Store had no value for ${missingMaps.join(', ')}. Maps calls will be empty.`);
}
