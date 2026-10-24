/**
 * Shared HTTP helpers for the area Lambdas.
 *
 * Handlers answer health checks and real routes. Event-shape guards let one
 * function accept HTTP, WebSocket, or queue payloads without a second process.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  APIGatewayProxyWebsocketEventV2,
  SQSEvent,
} from "aws-lambda";
import { ACCESS_COOKIE } from "./auth/refresh-cookie.js";

/** Subset of `requestContext` used to tell HTTP events apart from WebSocket events. */
type RequestContext = {
  http?: unknown;
  routeKey?: unknown;
};

/**
 * Reads the `requestContext` object from an unknown Lambda event.
 *
 * @param event - A candidate API Gateway or queue payload.
 * @returns The request context when present, otherwise `undefined`.
 */
const contextOf = (event: object): RequestContext | undefined => {
  if (!("requestContext" in event)) return undefined;
  const context = event.requestContext;
  if (typeof context !== "object" || context === null) return undefined;
  return context as RequestContext;
};

/**
 * Builds a JSON HTTP response for Amazon API Gateway.
 *
 * @param statusCode - The HTTP status code to return.
 * @param body - A value that is serialized with `JSON.stringify`.
 * @returns A structured proxy result with a `content-type` header.
 */
export const json = (
  statusCode: number,
  body: unknown,
): APIGatewayProxyStructuredResultV2 => ({
  statusCode,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/**
 * Builds a binary HTTP response for Amazon API Gateway.
 *
 * @param statusCode - The HTTP status code to return.
 * @param contentType - The response `Content-Type`.
 * @param bytes - The raw response body.
 * @returns A structured proxy result with a base64-encoded body.
 */
export const binary = (
  statusCode: number,
  contentType: string,
  bytes: Buffer,
): APIGatewayProxyStructuredResultV2 => ({
  statusCode,
  headers: { "content-type": contentType },
  body: bytes.toString("base64"),
  isBase64Encoded: true,
});

/**
 * Attaches `Set-Cookie` values for the HTTP API `cookies` array.
 *
 * @param result - An existing structured proxy result.
 * @param cookies - Fully formed `Set-Cookie` header values (without the name prefix).
 * @returns A new result that includes the cookie list.
 */
export const withCookies = (
  result: APIGatewayProxyStructuredResultV2,
  cookies: string[],
): APIGatewayProxyStructuredResultV2 => ({
  ...result,
  cookies: [...(result.cookies ?? []), ...cookies],
});

/**
 * Returns a `404` JSON body for an unknown route.
 *
 * @returns A structured proxy result with `{ error: 'not_found' }`.
 */
export const notFound = (): APIGatewayProxyStructuredResultV2 =>
  json(404, { error: "not_found" });

/**
 * Returns a `400` JSON body for a validation or client error.
 *
 * @param error - A stable error code string, or a structured validation payload.
 * @returns A structured proxy result.
 */
export const badRequest = (error: unknown): APIGatewayProxyStructuredResultV2 =>
  json(400, typeof error === "string" ? { error } : error);

/**
 * Returns a `401` JSON body for a missing or invalid credential.
 *
 * @param error - A stable error code string. Defaults to `unauthorized`.
 * @returns A structured proxy result.
 */
export const unauthorized = (
  error = "unauthorized",
): APIGatewayProxyStructuredResultV2 => json(401, { error });

/**
 * Returns a `403` JSON body when the caller is authenticated but not allowed.
 *
 * @param error - A stable error code string. Defaults to `forbidden`.
 * @returns A structured proxy result.
 */
export const forbidden = (
  error = "forbidden",
): APIGatewayProxyStructuredResultV2 => json(403, { error });

/**
 * Returns a `409` JSON body for a conflict such as a duplicate email.
 *
 * @param error - A stable error code string.
 * @returns A structured proxy result.
 */
export const conflict = (error: string): APIGatewayProxyStructuredResultV2 =>
  json(409, { error });

/**
 * Returns a `302` redirect, optionally setting cookies.
 *
 * @param location - The absolute or relative Location header value.
 * @param cookies - Optional `Set-Cookie` values for the HTTP API cookies array.
 * @returns A structured proxy result.
 */
/**
 * Reads a stable error code from a JSON response body.
 *
 * @param body - The proxy response body.
 * @returns The `error` string, or `-` when the body has none.
 */
const errorCode = (body: string | undefined): string => {
  if (body === undefined || body.length === 0) return "-";
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    if (typeof parsed.error === "string" && parsed.error.length > 0) return parsed.error;
  } catch {
    return "-";
  }
  return "-";
};

/**
 * Logs the path and error code when a handler returns a 4xx or 5xx response.
 *
 * API Gateway access logs record the route template and only fill `error` for
 * gateway failures. A Lambda `{ error: "email_required" }` response is a
 * successful integration, so this line is what carries that code.
 *
 * @param handle - The area HTTP handler.
 * @returns The same handler, after writing one JSON line for failed responses.
 */
export const logHttpFailure =
  (
    handle: (
      event: APIGatewayProxyEventV2,
    ) => Promise<APIGatewayProxyStructuredResultV2>,
  ) =>
  async (
    event: APIGatewayProxyEventV2,
  ): Promise<APIGatewayProxyStructuredResultV2> => {
    const result = await handle(event);
    const status = result.statusCode ?? 200;
    if (status < 400) return result;
    console.error(
      JSON.stringify({
        requestId: event.requestContext.requestId,
        path: event.rawPath,
        routeKey: event.routeKey,
        status,
        error: errorCode(result.body),
      }),
    );
    return result;
  };

export const redirect = (
  location: string,
  cookies: string[] = [],
): APIGatewayProxyStructuredResultV2 => ({
  statusCode: 302,
  headers: { location },
  body: "",
  ...(cookies.length > 0 ? { cookies } : {}),
});

/**
 * Narrows an unknown event to an HTTP API (payload format 2.0) event.
 *
 * @param event - A candidate Lambda event.
 * @returns `true` when `requestContext.http` is present.
 */
export const isHttpEvent = (
  event: unknown,
): event is APIGatewayProxyEventV2 => {
  if (typeof event !== "object" || event === null) return false;
  return contextOf(event)?.http !== undefined;
};

/**
 * Narrows an unknown event to a WebSocket API event.
 *
 * @param event - A candidate Lambda event.
 * @returns `true` when `routeKey` is set and the HTTP context is absent.
 */
export const isWebSocketEvent = (
  event: unknown,
): event is APIGatewayProxyWebsocketEventV2 => {
  if (typeof event !== "object" || event === null) return false;
  const context = contextOf(event);
  return context?.routeKey !== undefined && context.http === undefined;
};

/**
 * Narrows an unknown event to an Amazon Simple Queue Service (SQS) batch.
 *
 * @param event - A candidate Lambda event.
 * @returns `true` when `Records` is an array.
 */
export const isSqsEvent = (event: unknown): event is SQSEvent => {
  if (typeof event !== "object" || event === null || !("Records" in event))
    return false;
  return Array.isArray(event.Records);
};

/**
 * Reads a single cookie value from an HTTP API event.
 *
 * Prefers the HTTP API `cookies` array, then falls back to the `cookie` header.
 *
 * @param event - The HTTP API event.
 * @param name - The cookie name to find.
 * @returns The cookie value, or `undefined` when absent.
 */
export const readCookie = (
  event: APIGatewayProxyEventV2,
  name: string,
): string | undefined => {
  const fromList = event.cookies?.find((entry) => {
    const eq = entry.indexOf("=");
    if (eq < 0) return false;
    return entry.slice(0, eq) === name;
  });
  if (fromList !== undefined) {
    return decodeURIComponent(fromList.slice(fromList.indexOf("=") + 1));
  }

  const header = event.headers?.cookie ?? event.headers?.Cookie;
  if (header === undefined) return undefined;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    if (trimmed.slice(0, eq) === name) {
      return decodeURIComponent(trimmed.slice(eq + 1));
    }
  }
  return undefined;
};

/**
 * Header the website distribution copies the viewer `Authorization` value into.
 *
 * CloudFront signs function URL requests with its own `Authorization` header,
 * so the bearer token cannot travel there. The viewer function overwrites or
 * removes this header on every request. Must match `VIEWER_AUTHORIZATION_HEADER`
 * in `infrastructure/lib/site-api.ts`.
 */
export const VIEWER_AUTHORIZATION_HEADER = "x-viewer-authorization";

/**
 * Returns whether a browser request may use the access cookie.
 *
 * `SameSite=Strict` already keeps the cookie off cross-site requests. This
 * also refuses other origins on the same site, such as a sibling subdomain.
 * Browsers set `Sec-Fetch-Site` themselves and script cannot change it. A
 * request without it is not from a current browser, so a page could not have
 * forged it. Outside production the website and the API run on different
 * localhost ports, which is `same-site`.
 *
 * @param event - The HTTP event.
 * @returns `true` when the access cookie may stand in for `Authorization`.
 */
const cookieAllowed = (event: APIGatewayProxyEventV2): boolean => {
  const site = headerOf(event, "sec-fetch-site");
  if (site === undefined || site === "same-origin") return true;
  return site === "same-site" && process.env.NODE_ENV !== "production";
};

/**
 * Reads the caller's `Authorization` value.
 *
 * Behind CloudFront it is in {@link VIEWER_AUTHORIZATION_HEADER}, and
 * `Authorization` holds the origin access control signature, which is not a
 * bearer value. The local server forwards the original header. The website
 * sends no header; its access token is in the HttpOnly {@link ACCESS_COOKIE}.
 *
 * @param event - The HTTP event.
 * @returns The header value, or `undefined` when absent.
 */
export const authorizationOf = (
  event: APIGatewayProxyEventV2,
): string | undefined => {
  const viewer = headerOf(event, VIEWER_AUTHORIZATION_HEADER);
  if (viewer !== undefined) return viewer;
  const header = headerOf(event, "authorization");
  if (header?.startsWith("Bearer ") === true) return header;
  const token = readCookie(event, ACCESS_COOKIE);
  if (token === undefined || token.length === 0 || !cookieAllowed(event)) return undefined;
  return `Bearer ${token}`;
};

/**
 * Reads a case-insensitive request header value.
 *
 * @param event - The HTTP API event.
 * @param name - The header name (any casing).
 * @returns The header value, or `undefined` when absent.
 */
export const headerOf = (
  event: APIGatewayProxyEventV2,
  name: string,
): string | undefined => {
  const headers = event.headers ?? {};
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower && typeof value === "string") return value;
  }
  return undefined;
};

/**
 * Reads the request body as text, decoding it when API Gateway sent base64.
 *
 * Signature checks such as Stripe's need these exact bytes, so nothing is parsed.
 *
 * @param event - The HTTP API event.
 * @returns The body text, or an empty string when there is none.
 */
export const rawBody = (event: APIGatewayProxyEventV2): string => {
  if (event.body === undefined) return "";
  return event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
};

/**
 * Parses a JSON request body, or returns `undefined` when empty or invalid.
 *
 * @param event - The HTTP API event.
 * @returns The parsed object, or `undefined`.
 */
export const parseJsonBody = (event: APIGatewayProxyEventV2): unknown => {
  const raw = rawBody(event);
  if (raw.length === 0) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
};

/** Maps a thrown value to an HTTP response when the error is known. */
export type ErrorMappingFn = (
  error: unknown,
) => APIGatewayProxyStructuredResultV2 | undefined;

/**
 * Answers `GET /{area}/health` before the area's real routes exist.
 *
 * @param event - The HTTP API event from Amazon API Gateway or the local server.
 * @param service - The area name echoed in the health body.
 * @returns `{ ok: true, service }` on a matching `GET`, otherwise `notFound()`.
 */
export const handleHealth = (
  event: APIGatewayProxyEventV2,
  service: string,
): APIGatewayProxyStructuredResultV2 => {
  const path = event.rawPath ?? "";
  const method = event.requestContext.http.method;
  if (method === "GET" && (path === "/health" || path.endsWith("/health"))) {
    return json(200, { ok: true, service });
  }
  return notFound();
};
