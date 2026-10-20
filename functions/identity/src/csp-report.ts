/**
 * Content-Security-Policy violation reports from the website.
 *
 * Browsers post a report whenever the enforced or report-only policy blocks
 * something. Each violation becomes one log line, so CloudWatch shows what a
 * stricter policy would break before it is enforced, and any script that was
 * blocked in production.
 *
 * Reports cannot carry the body hash origin access control needs, so this runs
 * on its own public function URL that CloudFront forwards `/api/csp-report` to,
 * like the Stripe webhooks. It stores nothing and trusts nothing it receives.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

/** Larger bodies are dropped unread. A real report is well under 4 KB. */
export const MAX_REPORT_BYTES = 16 * 1024;

/** A batch from the Reporting API logs at most this many violations. */
const MAX_VIOLATIONS = 10;

/** One violation, reduced to what helps find its cause. */
export type CspViolation = {
  /** `enforce` or `report`. */
  disposition: string;
  /** The directive that blocked it, such as `script-src-elem`. */
  directive: string;
  /** What was blocked: a URL without its query, or `inline`, `eval`, `trusted-types-sink`. */
  blocked: string;
  /** The page, without its query. */
  page: string;
  /** Script file and position that caused it, when the browser says. */
  source?: string;
};

type Fields = Record<string, unknown>;

const text = (value: unknown): string => (typeof value === 'string' ? value.slice(0, 300) : '');

/**
 * Drops the query and fragment, which can hold sign-in codes, socket tickets,
 * or a calendar feed token.
 *
 * @param value - A URL or a keyword such as `inline`.
 * @returns The value without `?` or `#` and what follows.
 */
export const withoutQuery = (value: unknown): string => text(value).split(/[?#]/u)[0] ?? '';

const violation = (fields: Fields, names: { page: string; blocked: string; directive: string; source: string }): CspViolation => {
  const source = withoutQuery(fields[names.source]);
  const line = fields['line-number'] ?? fields.lineNumber;
  return {
    disposition: text(fields.disposition) || 'enforce',
    directive: text(fields[names.directive]) || text(fields['violated-directive']),
    blocked: withoutQuery(fields[names.blocked]),
    page: withoutQuery(fields[names.page]),
    ...(source.length > 0 ? { source: typeof line === 'number' ? `${source}:${line}` : source } : {}),
  };
};

/**
 * Reads violations from either report format.
 *
 * `report-uri` posts `{ "csp-report": { ... } }` with kebab-case fields. The
 * Reporting API (`report-to`) posts an array of `{ type, body }` with camelCase
 * fields. The script sample is never kept, because it can contain what a person typed.
 *
 * @param body - The parsed request body.
 * @returns The violations found, possibly none.
 */
export const cspViolations = (body: unknown): CspViolation[] => {
  if (Array.isArray(body)) {
    return body
      .filter((report): report is { type: string; body: Fields } =>
        typeof report === 'object' && report !== null && report.type === 'csp-violation' && typeof report.body === 'object' && report.body !== null,
      )
      .slice(0, MAX_VIOLATIONS)
      .map((report) =>
        violation(report.body, { page: 'documentURL', blocked: 'blockedURL', directive: 'effectiveDirective', source: 'sourceFile' }),
      );
  }
  if (typeof body === 'object' && body !== null) {
    const report = (body as Fields)['csp-report'];
    if (typeof report === 'object' && report !== null) {
      return [
        violation(report as Fields, { page: 'document-uri', blocked: 'blocked-uri', directive: 'effective-directive', source: 'source-file' }),
      ];
    }
  }
  return [];
};

/**
 * Logs each violation in `POST /csp-report` and answers `204`.
 *
 * Every other request, and any body it cannot read, also gets `204` (or `404`
 * off the path), so a sender learns nothing from the response.
 *
 * @param event - The function URL event, with `/api` already removed by CloudFront.
 * @returns An empty response.
 */
export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
  if (event.requestContext.http.method !== 'POST' || event.rawPath !== '/csp-report') return { statusCode: 404 };
  const raw = event.body === undefined ? '' : event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  if (raw.length === 0 || Buffer.byteLength(raw) > MAX_REPORT_BYTES) return { statusCode: 204 };
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { statusCode: 204 };
  }
  for (const entry of cspViolations(body)) {
    console.warn(JSON.stringify({ area: 'csp-report', msg: 'csp_violation', ...entry }));
  }
  return { statusCode: 204 };
};
