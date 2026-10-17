/**
 * Resolves deploy settings from CDK context, then process environment.
 *
 * Context is the local override. GitHub Actions passes the environment name.
 * The hosted zone id and name come from Parameter Store.
 */

/**
 * Returns a non-blank string, or `undefined`.
 *
 * @param value - A context or environment value.
 * @returns The string, when it has non-whitespace content.
 */
export const definedString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined;

/** Public website and API URLs for one deploy environment. */
export type PublicUrls = {
  /** Website origin, with no path and no trailing slash. */
  clientOrigin: string;
  /** Identity OAuth callback on the website host, under `/api`. */
  callbackUrl: string;
  /** Browser URL after Cognito logout. */
  logoutUrl: string;
  /** Website hostname, `app.<environment>.<domain>`. */
  siteHostname: string;
};

/** Path on the website host that CloudFront forwards to the HTTP API. */
export const SITE_API_PREFIX = '/api';

/**
 * Browser base URL for the HTTP API on the website host.
 *
 * @param clientOrigin - Website origin, with no path.
 * @returns The origin plus `/api`, with no trailing slash.
 */
export const siteApiBaseUrl = (clientOrigin: string): string =>
  `${clientOrigin.replace(/\/+$/u, '')}${SITE_API_PREFIX}`;

/** One DNS label: letters, digits, and inner hyphens. */
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

/**
 * Builds the website and API URLs for one environment under a registered domain.
 *
 * Staging becomes `app.staging.example.com`. The HTTP API is `/api` on that host.
 *
 * @param environment - GitHub environment name, such as `staging`.
 * @param domain - Hosted zone name, such as `example.com`.
 * @returns The origin, callback, logout URL, and website hostname.
 */
export const publicUrlsFor = (environment: string, domain: string): PublicUrls => {
  const envLabel = environment.trim().toLowerCase();
  const apex = domain.trim().toLowerCase().replace(/\.$/u, '');
  const labels = apex.split('.');
  if (!DNS_LABEL.test(envLabel) || labels.length < 2 || labels.some((label) => !DNS_LABEL.test(label))) {
    throw new Error('DEPLOY_ENV and HOSTED_ZONE_NAME must be DNS names');
  }
  const siteHostname = `app.${envLabel}.${apex}`;
  const clientOrigin = `https://${siteHostname}`;
  return {
    clientOrigin,
    callbackUrl: `${siteApiBaseUrl(clientOrigin)}/identity/oauth/callback`,
    logoutUrl: `${clientOrigin}/login`,
    siteHostname,
  };
};

/**
 * Reads the hostname from an absolute URL.
 *
 * @param value - A URL such as `https://app.example.com/login`.
 * @returns The hostname, or `undefined` when the value is blank or not a URL.
 */
export const hostnameOf = (value: string | undefined): string | undefined => {
  const raw = definedString(value);
  if (raw === undefined) return undefined;
  try {
    return new URL(raw).hostname;
  } catch {
    return undefined;
  }
};

/**
 * Splits a comma-separated URL list.
 *
 * @param value - `CALLBACK_URLS` or `LOGOUT_URLS`.
 * @returns Trimmed URLs, or `undefined` when none are present.
 */
export const splitUrlList = (value: string | undefined): string[] | undefined => {
  if (value === undefined) return undefined;
  const urls = value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return urls.length > 0 ? urls : undefined;
};

/**
 * Reads a URL list from CDK context (an array or a comma-separated string).
 *
 * @param value - The context value from `tryGetContext`.
 * @returns Trimmed URLs, or `undefined` when the context value is absent.
 */
export const urlListFromUnknown = (value: unknown): string[] | undefined => {
  if (Array.isArray(value)) {
    const urls = value
      .map((item) => definedString(item))
      .filter((item): item is string => item !== undefined);
    return urls.length > 0 ? urls : undefined;
  }
  return splitUrlList(definedString(value));
};
