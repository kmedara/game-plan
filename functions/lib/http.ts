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
import type { z } from "zod";

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
 * Parses a JSON request body, or returns `undefined` when empty or invalid.
 *
 * @param event - The HTTP API event.
 * @returns The parsed object, or `undefined`.
 */
export const parseJsonBody = (event: APIGatewayProxyEventV2): unknown => {
  if (event.body === undefined || event.body.length === 0) return undefined;
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
};

/**
 * Formats Zod issues as a stable `{ error, details }` payload for `400` responses.
 *
 * @param issues - The Zod issue list from a failed `safeParse`.
 * @returns A JSON-serializable validation error body.
 */
const zodErrorBody = (issues: z.ZodIssue[]) => ({
  errors: issues.map((issue) => ({
    field: issue.path.join("."),
    message: issue.message,
  })),
});

/**
 * Parses and validates the JSON body, then runs the route with a typed body.
 *
 * Empty bodies are treated as `{}` so optional-body schemas can still pass.
 *
 * @param schema - The Zod schema for the request body.
 * @param run - The route body that receives the validated value.
 * @returns A handler that returns `400` with Zod issue messages when validation fails.
 */
export const withBodyValidation =
  <T>(
    schema: z.ZodType<T>,
    run: (
      event: APIGatewayProxyEventV2,
      body: T,
    ) => Promise<APIGatewayProxyStructuredResultV2>,
  ) =>
  async (
    event: APIGatewayProxyEventV2,
  ): Promise<APIGatewayProxyStructuredResultV2> => {
    const parsed = schema.safeParse(parseJsonBody(event) ?? {});
    if (!parsed.success) return badRequest(zodErrorBody(parsed.error.issues));
    return run(event, parsed.data);
  };

/**
 * Validates query string parameters, then runs the route with a typed query.
 *
 * Missing `queryStringParameters` are treated as `{}`.
 *
 * @param schema - The Zod schema for the query object.
 * @param run - The route body that receives the validated value.
 * @returns A handler that returns `400` with Zod issue messages when validation fails.
 */
export const withQueryValidation =
  <T>(
    schema: z.ZodType<T>,
    run: (
      event: APIGatewayProxyEventV2,
      query: T,
    ) => Promise<APIGatewayProxyStructuredResultV2>,
  ) =>
  async (
    event: APIGatewayProxyEventV2,
  ): Promise<APIGatewayProxyStructuredResultV2> => {
    const parsed = schema.safeParse(event.queryStringParameters ?? {});
    if (!parsed.success) return badRequest(zodErrorBody(parsed.error.issues));
    return run(event, parsed.data);
  };

/**
 * Runs a route and maps known errors; unknown errors become `500`.
 *
 * @param run - The async route body.
 * @param mapError - Area-specific error mapper.
 * @returns The route response.
 */
export const withErrors = async (
  run: () => Promise<APIGatewayProxyStructuredResultV2>,
  mapError: ErrorMappingFn,
): Promise<APIGatewayProxyStructuredResultV2> => {
  try {
    return await run();
  } catch (error) {
    console.error(
      JSON.stringify({
        service: "http",
        event: "error",
        error: JSON.stringify(error),
      }),
    );
    return mapError(error) ?? json(500, { error: "internal_error" });
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
