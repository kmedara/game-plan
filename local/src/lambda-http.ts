/**
 * Converts a local Node.js HTTP request into an Amazon API Gateway HTTP API event,
 * and writes a structured Lambda result back to the response.
 */

import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

/**
 * Reads the browser origin allowed for local Cross-Origin Resource Sharing (CORS).
 *
 * @returns The `CLIENT_ORIGIN` environment value, or `http://localhost:4200`.
 */
const clientOrigin = (): string => process.env.CLIENT_ORIGIN ?? 'http://localhost:4200';

/**
 * Flattens Node.js request headers into a string map for the Lambda event.
 *
 * @param req - The incoming HTTP request.
 * @returns A header map with multi-value headers joined by commas.
 */
const headerMap = (req: IncomingMessage): Record<string, string> => {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers[key] = value;
    else if (Array.isArray(value)) headers[key] = value.join(',');
  }
  return headers;
};

/**
 * Splits a `Cookie` header into the HTTP API `cookies` array entries.
 *
 * @param cookieHeader - The raw `Cookie` header value.
 * @returns Individual `name=value` pairs.
 */
const cookieList = (cookieHeader: string | undefined): string[] | undefined => {
  if (cookieHeader === undefined || cookieHeader.length === 0) return undefined;
  return cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
};

/**
 * Reads the full request body without changing its bytes.
 *
 * @param req - The incoming HTTP request stream.
 * @returns The raw body, which may be empty.
 */
const readBody = async (req: IncomingMessage): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
};

/**
 * Returns whether a content type can travel as UTF-8 text in the Lambda event.
 *
 * Image and other binary uploads are base64-encoded so photo bytes survive the proxy.
 *
 * @param contentType - The request `Content-Type` header.
 * @returns `true` for JSON and text bodies.
 */
const isTextBody = (contentType: string | undefined): boolean => {
  if (contentType === undefined || contentType.length === 0) return true;
  const type = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  return (
    type.startsWith('text/') ||
    type === 'application/json' ||
    type === 'application/x-www-form-urlencoded'
  );
};

/**
 * Builds the HTTP API payload the Lambda handler already understands.
 *
 * @param req - The incoming Node.js request.
 * @param port - The local port used to resolve the request URL.
 * @returns An Amazon API Gateway HTTP API (payload format 2.0) event.
 */
export const toHttpEvent = async (
  req: IncomingMessage,
  port: number,
): Promise<APIGatewayProxyEventV2> => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
  const rawBody = await readBody(req);
  const headers = headerMap(req);
  const textBody = isTextBody(headers['content-type']);
  const body =
    rawBody.byteLength === 0
      ? undefined
      : textBody
        ? rawBody.toString('utf8')
        : rawBody.toString('base64');
  const cookies = cookieList(headers.cookie);
  const queryStringParameters =
    url.searchParams.size > 0
      ? Object.fromEntries(url.searchParams.entries())
      : undefined;
  return {
    version: '2.0',
    routeKey: '$default',
    rawPath: url.pathname,
    rawQueryString: url.search.slice(1),
    headers,
    ...(cookies !== undefined ? { cookies } : {}),
    ...(queryStringParameters !== undefined ? { queryStringParameters } : {}),
    requestContext: {
      accountId: 'local',
      apiId: 'local',
      domainName: 'localhost',
      domainPrefix: 'localhost',
      requestId: randomUUID(),
      routeKey: '$default',
      stage: 'local',
      time: new Date().toISOString(),
      timeEpoch: Date.now(),
      http: {
        method: req.method ?? 'GET',
        path: url.pathname,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: req.headers['user-agent'] ?? 'local',
      },
    },
    isBase64Encoded: body !== undefined && !textBody,
    ...(body !== undefined ? { body } : {}),
  };
};

/**
 * Writes a structured Lambda result to a Node.js HTTP response, including local CORS headers.
 *
 * Amazon API Gateway HTTP API returns `Set-Cookie` via the `cookies` array. Node's
 * `writeHead` needs distinct `set-cookie` header values, so those are applied with
 * `appendHeader` after the status line.
 *
 * @param res - The Node.js response object.
 * @param result - The structured Amazon API Gateway proxy result.
 */
export const writeResult = (
  res: ServerResponse,
  result: APIGatewayProxyStructuredResultV2,
): void => {
  const headers: Record<string, string | string[]> = {
    'access-control-allow-origin': clientOrigin(),
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'authorization,content-type,cookie,x-refresh-delivery',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  };
  for (const [key, value] of Object.entries(result.headers ?? {})) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      headers[key] = String(value);
    }
  }
  if (result.cookies !== undefined && result.cookies.length > 0) {
    headers['set-cookie'] = result.cookies;
  }
  res.writeHead(result.statusCode ?? 200, headers);
  if (result.statusCode === 204) {
    res.end();
    return;
  }
  if (result.isBase64Encoded && result.body !== undefined) {
    res.end(Buffer.from(result.body, 'base64'));
    return;
  }
  res.end(result.body ?? '');
};
