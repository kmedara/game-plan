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
  /** Website hostname, `<environment>.<domain>`. */
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
 * Staging becomes `staging.example.com`. The HTTP API is `/api` on that host.
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
  const siteHostname = `${envLabel}.${apex}`;
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

/**
 * Domain the app's own email is sent from: invites and Cognito's account email.
 *
 * Production sends from the bare domain, which is also where people expect a
 * support address. Other environments send from their website host, so a
 * staging message never looks like it came from production.
 *
 * @param environment - `DEPLOY_ENV`, such as `production`.
 * @param zoneName - Hosted zone name, such as `example.com.`.
 * @param siteHostname - Website hostname, `<environment>.<domain>`.
 * @returns The sending domain.
 */
export const mailDomainFor = (environment: string, zoneName: string, siteHostname: string): string =>
  environment.trim().toLowerCase() === 'production' ? zoneName.trim().toLowerCase().replace(/\.$/u, '') : siteHostname;

/** One record set for the mail provider, in the shape the DNS custom resource takes. */
export type MailRecord = { name: string; type: 'MX' | 'TXT' | 'CNAME'; values: string[] };

/** Mail provider settings from Parameter Store. */
export type MailDnsSettings = {
  /** `MAIL_MX`: `<priority> <host>` entries, separated by commas or new lines. */
  mx?: string;
  /** `MAIL_TXT`: TXT values for the bare domain (SPF, the provider's verification), one per line. */
  txt?: string;
  /** `MAIL_DMARC`: the DMARC policy, such as `v=DMARC1; p=none; rua=mailto:dmarc@example.com`. */
  dmarc?: string;
  /**
   * `MAIL_RECORDS`: other records the provider asks for, such as its DKIM key,
   * one `<name> <TXT|CNAME> <value>` per line. A name without the domain is
   * taken as relative to it (`google._domainkey`).
   */
  extra?: string;
};

const MX_ENTRY = /^\d{1,5}\s+[a-z0-9.-]+\.?$/iu;

/**
 * Builds the bare domain's mail records from Parameter Store values.
 *
 * Each value replaces whatever record set the zone has for that name and type,
 * so only set the ones the mail provider needs. Nothing is written when none is set.
 *
 * @param zoneName - Hosted zone name, such as `example.com`.
 * @param settings - `MAIL_MX`, `MAIL_TXT`, and `MAIL_DMARC`.
 * @returns Record sets to keep in the zone.
 * @throws When an MX entry is not `<priority> <host>`.
 */
export const mailRecordsFor = (zoneName: string, settings: MailDnsSettings): MailRecord[] => {
  const apex = zoneName.trim().toLowerCase().replace(/\.$/u, '');
  const list = (value: string | undefined, separator: RegExp): string[] =>
    (value ?? '')
      .split(separator)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);

  const records: MailRecord[] = [];
  const mx = list(settings.mx, /[,\n]/u).map((entry) => entry.replace(/\s+/gu, ' '));
  const badMx = mx.find((entry) => !MX_ENTRY.test(entry));
  if (badMx !== undefined) throw new Error(`MAIL_MX entry "${badMx}" must be "<priority> <host>"`);
  if (mx.length > 0) records.push({ name: apex, type: 'MX', values: mx });
  const txt = list(settings.txt, /\n/u);
  if (txt.length > 0) records.push({ name: apex, type: 'TXT', values: txt });
  const dmarc = definedString(settings.dmarc)?.trim();
  if (dmarc !== undefined) records.push({ name: `_dmarc.${apex}`, type: 'TXT', values: [dmarc] });

  for (const line of list(settings.extra, /\n/u)) {
    const match = /^(\S+)\s+(TXT|CNAME)\s+(.+)$/iu.exec(line);
    if (match === null) throw new Error(`MAIL_RECORDS line "${line}" must be "<name> <TXT|CNAME> <value>"`);
    const [, rawName = '', rawType = '', value = ''] = match;
    const lower = rawName === '@' ? apex : rawName.toLowerCase().replace(/\.$/u, '');
    const name = lower === apex || lower.endsWith(`.${apex}`) ? lower : `${lower}.${apex}`;
    const type = rawType.toUpperCase() as 'TXT' | 'CNAME';
    if ([apex, `_dmarc.${apex}`].includes(name) && type === 'TXT') {
      throw new Error(`MAIL_RECORDS cannot set the TXT for ${name}; use MAIL_TXT or MAIL_DMARC`);
    }
    const existing = records.find((record) => record.name === name && record.type === type);
    if (existing !== undefined && type === 'TXT') existing.values.push(value.trim());
    else if (existing !== undefined) throw new Error(`MAIL_RECORDS has two CNAMEs for ${name}`);
    else records.push({ name, type, values: [value.trim()] });
  }
  return records;
};

/**
 * Addresses on the staging sign-up allowlist, read the same way as the pre
 * sign-up trigger: separated by commas or whitespace, compared lower-case.
 *
 * @param raw - `STAGING_SIGNUP_ALLOWLIST`.
 * @returns Distinct addresses, without anything that is not an address.
 */
export const allowlistEmails = (raw: string | undefined): string[] => [
  ...new Set(
    (raw ?? '')
      .split(/[\s,]+/u)
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(entry)),
  ),
];
