/**
 * Maps Parameter Store names under a shared prefix to process environment variables.
 *
 * Every parameter is a String. The deploy workflows load the path, and the
 * stack deploy writes stack outputs back under the same prefix.
 */

/**
 * Suffix after the prefix, mapped to the environment variable CDK and the client build read.
 *
 * The website hostname is derived from `HOSTED_ZONE_NAME` and the deploy environment.
 */
export const PARAMETER_ENV: Record<string, string> = {
  'hosted-zone-id': 'HOSTED_ZONE_ID',
  'hosted-zone-name': 'HOSTED_ZONE_NAME',
  'google-client-id': 'GOOGLE_CLIENT_ID',
  'google-client-secret': 'GOOGLE_CLIENT_SECRET',
  'facebook-app-id': 'FACEBOOK_APP_ID',
  'facebook-app-secret': 'FACEBOOK_APP_SECRET',
  'apple-client-id': 'APPLE_CLIENT_ID',
  'apple-team-id': 'APPLE_TEAM_ID',
  'apple-key-id': 'APPLE_KEY_ID',
  'apple-private-key': 'APPLE_PRIVATE_KEY',
  'google-maps-api-key': 'GOOGLE_MAPS_API_KEY',
  'google-maps-browser-api-key': 'GOOGLE_MAPS_BROWSER_API_KEY',
  'vapid-public-key': 'VAPID_PUBLIC_KEY',
  'vapid-private-key': 'VAPID_PRIVATE_KEY',
  'vapid-subject': 'VAPID_SUBJECT',
  'api-base-url': 'API_BASE_URL',
  'api-regional-domain': 'API_REGIONAL_DOMAIN',
  'api-origin-verify-secret-arn': 'API_ORIGIN_VERIFY_SECRET_ARN',
  'ws-base-url': 'WS_BASE_URL',
  'site-bucket-name': 'SITE_BUCKET_NAME',
  'site-distribution-id': 'SITE_DISTRIBUTION_ID',
  'site-url': 'SITE_URL',
  'site-api-enabled': 'SITE_API_ENABLED',
  'site-certificate-arn': 'SITE_CERTIFICATE_ARN',
};

/** Environment variables the website publish requires before the Expo web export. */
export const REQUIRED_CLIENT_ENV = ['API_BASE_URL', 'SITE_BUCKET_NAME', 'SITE_DISTRIBUTION_ID'] as const;

/** CloudFormation outputs the DNS stack writes. */
export const DNS_OUTPUT_PARAMETERS: Record<string, string> = {
  SiteCertificateArn: 'site-certificate-arn',
};

/** CloudFormation outputs the platform stack writes. The client workflow reads the bucket and distribution. */
export const PLATFORM_OUTPUT_PARAMETERS: Record<string, string> = {
  SiteBucketName: 'site-bucket-name',
  SiteDistributionId: 'site-distribution-id',
  SiteUrl: 'site-url',
  SiteApiEnabled: 'site-api-enabled',
};

/** CloudFormation outputs the API stack writes. The client workflow reads both URLs. */
export const API_OUTPUT_PARAMETERS: Record<string, string> = {
  HttpApiUrl: 'api-base-url',
  WebSocketUrl: 'ws-base-url',
  ApiRegionalDomain: 'api-regional-domain',
  OriginVerifySecretArn: 'api-origin-verify-secret-arn',
};

/** Output maps keyed by the deploy workflow stack name. */
export const STACK_OUTPUT_PARAMETERS = {
  dns: DNS_OUTPUT_PARAMETERS,
  platform: PLATFORM_OUTPUT_PARAMETERS,
  api: API_OUTPUT_PARAMETERS,
} as const;

/** Every CloudFormation output key written back as a parameter suffix. */
export const OUTPUT_PARAMETERS: Record<string, string> = {
  ...DNS_OUTPUT_PARAMETERS,
  ...PLATFORM_OUTPUT_PARAMETERS,
  ...API_OUTPUT_PARAMETERS,
};

/** One Parameter Store name and its string value. */
export type ParameterValue = {
  name: string;
  value: string;
};

/**
 * Normalizes a prefix so lookups and writes share one trailing-slash form.
 *
 * @param prefix - Prefix from `SSM_PREFIX`, with or without a trailing slash.
 * @returns The prefix ending in `/`.
 */
export const normalizePrefix = (prefix: string): string => {
  const trimmed = prefix.trim().replace(/\/+$/u, '');
  if (trimmed.length === 0) {
    throw new Error('SSM_PREFIX is empty');
  }
  return `${trimmed}/`;
};

/**
 * Maps loaded parameters onto environment variables.
 *
 * Names that are outside the prefix or not in {@link PARAMETER_ENV} are ignored.
 *
 * @param prefix - Shared prefix such as `/gameplan/`.
 * @param parameters - Parameters returned by `GetParametersByPath`.
 * @returns Environment variable names and values.
 */
export const envFromParameters = (prefix: string, parameters: readonly ParameterValue[]): Record<string, string> => {
  const normalized = normalizePrefix(prefix);
  const env: Record<string, string> = {};
  for (const parameter of parameters) {
    if (!parameter.name.startsWith(normalized)) continue;
    const suffix = parameter.name.slice(normalized.length);
    const key = PARAMETER_ENV[suffix];
    if (key === undefined) continue;
    env[key] = parameter.value;
  }
  return env;
};

/**
 * Lists required variables that are missing or blank.
 *
 * @param env - Mapped environment.
 * @param keys - Names that must be non-blank.
 * @returns The missing names, in the same order as `keys`.
 */
export const missingEnv = (env: Record<string, string>, keys: readonly string[]): string[] =>
  keys.filter((key) => (env[key] ?? '').trim() === '');

/**
 * Formats assignments for `$GITHUB_ENV`, including multiline values such as a PEM key.
 *
 * @param env - Variables to export to later workflow steps.
 * @returns A block to append to the `GITHUB_ENV` file.
 */
export const formatGithubEnv = (env: Record<string, string>): string => {
  let block = '';
  for (const [key, value] of Object.entries(env)) {
    if (value.includes('\n') || value.includes('\r')) {
      let delimiter = 'GP_SSM_EOF';
      while (value.includes(delimiter)) {
        delimiter = `GP_SSM_EOF_${Math.random().toString(16).slice(2)}`;
      }
      block += `${key}<<${delimiter}\n${value}\n${delimiter}\n`;
    } else {
      block += `${key}=${value}\n`;
    }
  }
  return block;
};

/**
 * Resolves a CloudFormation output key to a parameter suffix.
 *
 * An output declared on the stack uses the mapping key as its logical id.
 * An output declared on a nested construct keeps the construct path and an
 * eight-character hash, such as `StorageSiteBucketNameA0602231`.
 *
 * @param outputKey - Key from a CDK `--outputs-file` document.
 * @param mapping - Output id to parameter suffix.
 * @returns The parameter suffix, when the key is one of the mapped outputs.
 */
const suffixForOutputKey = (outputKey: string, mapping: Record<string, string>): string | undefined => {
  const exact = mapping[outputKey];
  if (exact !== undefined) return exact;

  const hash = outputKey.slice(-8);
  if (!/^[A-F0-9]{8}$/u.test(hash)) return undefined;
  const human = outputKey.slice(0, -8);
  let match: { name: string; suffix: string } | undefined;
  for (const [name, suffix] of Object.entries(mapping)) {
    if (!human.endsWith(name) || human.length === name.length) continue;
    if (match === undefined || name.length > match.name.length) match = { name, suffix };
  }
  return match?.suffix;
};

/**
 * Reads known stack outputs from a CDK `--outputs-file` document.
 *
 * @param document - Parsed JSON from the outputs file.
 * @param mapping - Output id to parameter suffix. Defaults to every stack output.
 * @returns Parameter suffixes and values for the outputs that are present.
 */
export const parametersFromOutputs = (
  document: unknown,
  mapping: Record<string, string> = OUTPUT_PARAMETERS,
): Record<string, string> => {
  const found: Record<string, string> = {};
  const visit = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      const suffix = suffixForOutputKey(key, mapping);
      if (suffix !== undefined && typeof value === 'string' && value.trim() !== '') {
        if (mapping[key] !== undefined || found[suffix] === undefined) found[suffix] = value;
      } else if (value !== null && typeof value === 'object') {
        visit(value);
      }
    }
  };
  visit(document);
  return found;
};
