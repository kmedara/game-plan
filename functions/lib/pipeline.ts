/**
 * HTTP route pipeline for API Gateway HTTP APIs.
 *
 * Handlers list steps instead of nesting wrappers. The first step is the outer
 * one, so error mapping belongs first and catches throws from later steps.
 * Each step may attach fields to the context the final handler receives.
 *
 * The step machinery lives in `@gameplan/pipeline`. This module binds it to
 * API Gateway events and proxy results. A route that names a method and a path
 * is matched by {@link dispatch}; the path string is also the parameter names.
 */

import {
  type AnyStep,
  asStep as asCoreStep,
  catchErrors,
  compose,
  type Handler,
  issuePath,
  type StandardIssue,
  type StandardSchema,
  type Step as CoreStep,
  validate,
} from "@gameplan/pipeline";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import {
  badRequest,
  type ErrorMappingFn,
  handleHealth,
  json,
  logHttpFailure,
  notFound,
  parseJsonBody,
} from "./http.js";
import { errorMessage, functionArea, httpRoute, logError } from "./log.js";

/** Promise of an API Gateway proxy result. */
export type HttpResult = Promise<APIGatewayProxyStructuredResultV2>;

/**
 * Values shared by every step.
 *
 * Path parameters and earlier steps add fields to this object.
 */
export type RouteContext = {
  event: APIGatewayProxyEventV2;
};

/**
 * An HTTP pipeline step.
 *
 * `Req` must already be on the context. `Out` is attached before `next`.
 */
export type Step<Req extends object, Out extends object> = CoreStep<
  RouteContext & Req,
  Out,
  APIGatewayProxyStructuredResultV2
>;

/**
 * Types a step function with the context it requires and produces.
 *
 * @param run - The step body.
 * @returns The same function.
 */
export const asStep = <Req extends object, Out extends object>(
  run: Step<Req, Out>,
): Step<Req, Out> => asCoreStep(run);

type RouteHandler<Ctx, Steps extends readonly unknown[]> = Handler<
  Ctx,
  Steps,
  APIGatewayProxyStructuredResultV2
>;

/** Methods an HTTP route can declare. */
export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

/** An HTTP method an area route can handle. */
export type HttpMethod = (typeof HTTP_METHODS)[number];

type SegmentParam<Segment extends string> = Segment extends `:${infer Name}`
  ? Name
  : Segment extends `*${infer Name}`
    ? Name
    : never;

/** Parameter names declared in a path (`:teamId`, `*objectKey`). */
type PathParams<Path extends string> = Path extends `${infer Head}/${infer Tail}`
  ? SegmentParam<Head> | PathParams<Tail>
  : SegmentParam<Path>;

type PathContext<Path extends string> = RouteContext &
  Record<PathParams<Path>, string>;

type Segment =
  | { kind: "literal"; value: string }
  | { kind: "param"; name: string }
  | { kind: "splat"; name: string };

type Pattern = {
  segments: Segment[];
  score: number;
};

/**
 * A route `dispatch` can match.
 *
 * Calling it runs the pipeline. Path parameters are read from `event.rawPath`.
 */
export type HttpRoute = ((event: APIGatewayProxyEventV2) => HttpResult) & {
  readonly method: HttpMethod;
  readonly path: string;
};

const patterns = new WeakMap<HttpRoute, Pattern>();

const isHttpMethod = (value: unknown): value is HttpMethod =>
  typeof value === "string" &&
  (HTTP_METHODS as readonly string[]).includes(value);

/**
 * Splits a path into segments, keeping internal empty pieces.
 *
 * A leading slash is dropped. A trailing slash is the caller's job.
 *
 * @param path - A request path or a route pattern.
 * @returns Segments after the leading slash.
 */
const segmentsOf = (path: string): string[] => {
  const parts = path.split("/");
  if (parts[0] === "") parts.shift();
  if (parts.length === 1 && parts[0] === "") return [];
  return parts;
};

/**
 * Decodes one captured path value.
 *
 * A malformed escape is kept as written so a bad URL does not become a 500.
 *
 * @param value - A raw path segment, or a splat joined with `/`.
 * @returns The decoded value, or the raw value when decoding throws.
 */
const decodeSegment = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/**
 * Compiles a route path into literals, parameters, and an optional trailing splat.
 *
 * `:name` captures one segment. `*name` captures the rest of the path, including
 * slashes, and must be the last segment. The score prefers more literal segments,
 * then a fixed-length pattern over a splat.
 *
 * @param path - The path declared on the route, starting with `/`.
 * @returns The compiled pattern.
 */
const compilePath = (path: string): Pattern => {
  const segments: Segment[] = segmentsOf(path).map((part, index, all) => {
    if (part.startsWith("*")) {
      const name = part.slice(1);
      if (name.length === 0) throw new Error(`missing splat name in ${path}`);
      if (index !== all.length - 1) throw new Error(`splat must be last in ${path}`);
      return { kind: "splat", name };
    }
    if (part.startsWith(":")) {
      const name = part.slice(1);
      if (name.length === 0) throw new Error(`missing parameter name in ${path}`);
      return { kind: "param", name };
    }
    if (part.length === 0) throw new Error(`empty segment in ${path}`);
    return { kind: "literal", value: part };
  });
  return { segments, score: scoreOf(segments) };
};

/**
 * Scores a segment list. Higher scores win when two routes match.
 *
 * @param segments - Compiled segments.
 * @returns Literals counted double, plus one when the pattern has no splat.
 */
const scoreOf = (segments: readonly Segment[]): number => {
  const literals = segments.filter((segment) => segment.kind === "literal").length;
  const splat = segments.some((segment) => segment.kind === "splat");
  return literals * 2 + (splat ? 0 : 1);
};

/**
 * Matches request segments against a compiled pattern.
 *
 * @param segments - The pattern segments.
 * @param parts - The request segments.
 * @returns Captured parameters, or `undefined` when the shape differs.
 */
const matchSegments = (
  segments: readonly Segment[],
  parts: readonly string[],
): Record<string, string> | undefined => {
  const params: Record<string, string> = {};
  const splatAt = segments.findIndex((segment) => segment.kind === "splat");
  if (splatAt >= 0) {
    if (parts.length < segments.length) return undefined;
    for (let index = 0; index < splatAt; index += 1) {
      const captured = take(segments[index], parts[index]);
      if (captured === undefined) return undefined;
      if (captured.name !== undefined) params[captured.name] = captured.value;
    }
    const splat = segments[splatAt];
    if (splat?.kind !== "splat") return undefined;
    const rest = parts.slice(splatAt).join("/");
    if (rest.length === 0) return undefined;
    params[splat.name] = decodeSegment(rest);
    return params;
  }
  if (parts.length !== segments.length) return undefined;
  for (let index = 0; index < parts.length; index += 1) {
    const captured = take(segments[index], parts[index]);
    if (captured === undefined) return undefined;
    if (captured.name !== undefined) params[captured.name] = captured.value;
  }
  return params;
};

/**
 * Applies one pattern segment to one request segment.
 *
 * @param segment - The pattern segment.
 * @param part - The request segment.
 * @returns The capture, an empty literal hit, or `undefined` on a miss.
 */
const take = (
  segment: Segment | undefined,
  part: string | undefined,
): { name?: string; value: string } | undefined => {
  if (segment === undefined || part === undefined) return undefined;
  if (segment.kind === "literal") {
    return segment.value === part ? { value: part } : undefined;
  }
  if (segment.kind === "param") {
    if (part.length === 0) return undefined;
    return { name: segment.name, value: decodeSegment(part) };
  }
  return undefined;
};

/**
 * Matches a request, including the same path with the area prefix left off.
 *
 * `/media/devices/:deviceId` matches both `/media/devices/phone` and
 * `devices/phone`. The prefix-less score ignores the dropped area segment.
 *
 * @param pattern - The compiled route.
 * @param parts - The request segments.
 * @returns The capture and the score to compare, or `undefined`.
 */
const matchPattern = (
  pattern: Pattern,
  parts: readonly string[],
): { params: Record<string, string>; score: number } | undefined => {
  const full = matchSegments(pattern.segments, parts);
  if (full !== undefined) return { params: full, score: pattern.score };
  const [first, ...rest] = pattern.segments;
  if (first?.kind !== "literal") return undefined;
  const stripped = matchSegments(rest, parts);
  if (stripped === undefined) return undefined;
  return { params: stripped, score: scoreOf(rest) };
};

/**
 * Reads path parameters for one compiled route.
 *
 * @param pattern - The route pattern.
 * @param event - The HTTP API event.
 * @returns Captured names, or `undefined` when this route does not match.
 */
/**
 * Segments of a request path.
 *
 * A missing path is `/`, which is how an area root was reached before rawPath
 * was set. Trailing slashes are ignored.
 *
 * @param event - The HTTP API event.
 * @returns The path segments.
 */
const requestParts = (event: APIGatewayProxyEventV2): string[] => {
  const normalized = (event.rawPath ?? "").replace(/\/+$/u, "") || "/";
  return segmentsOf(normalized);
};

const paramsFromEvent = (
  pattern: Pattern,
  event: APIGatewayProxyEventV2,
): Record<string, string> | undefined => matchPattern(pattern, requestParts(event))?.params;

/** Options for {@link withMappedErrors}. */
export type MappedErrorOptions = {
  /** Called for every caught error before mapping. */
  onError?: (error: unknown) => void;
  /** Called only when `mapError` returns `undefined`. */
  onUnmapped?: (error: unknown) => void;
  /** Response when the error is not mapped. Defaults to `500` `internal_error`. */
  fallback?: (error: unknown) => APIGatewayProxyStructuredResultV2;
};

/**
 * Formats validation issues as a stable `{ errors }` payload for `400` responses.
 *
 * @param issues - The issues from a failed schema check.
 * @returns A `400` proxy result.
 */
const invalidRequest = (issues: ReadonlyArray<StandardIssue>) =>
  badRequest({
    errors: issues.map((issue) => ({
      field: issuePath(issue),
      message: issue.message,
    })),
  });

/**
 * Catches throws from later steps and maps them to HTTP responses.
 *
 * @param mapError - Area-specific error mapper. `undefined` means unknown.
 * @param options - Logging and fallback behavior.
 * @returns A step that leaves the context unchanged.
 */
export const withMappedErrors = (
  mapError: ErrorMappingFn,
  options: MappedErrorOptions = {},
): Step<object, object> =>
  catchErrors<RouteContext, APIGatewayProxyStructuredResultV2>((error, ctx) => {
    logError({
      area: functionArea(),
      route: httpRoute(ctx.event),
      msg: errorMessage(error),
      error,
    });
    options.onError?.(error);
    const mapped = mapError(error);
    if (mapped !== undefined) return mapped;
    options.onUnmapped?.(error);
    return options.fallback?.(error) ?? json(500, { error: "internal_error" });
  });

/**
 * Parses and validates the JSON body, then attaches `body`.
 *
 * Empty bodies are treated as `{}` so optional-body schemas can still pass.
 *
 * @param schema - Any Standard Schema for the request body, such as a Zod schema.
 * @returns A step that responds `400` when validation fails.
 */
export const withBodyValidation = <S extends StandardSchema>(schema: S) =>
  validate({
    key: "body",
    schema,
    read: (ctx: RouteContext) => parseJsonBody(ctx.event) ?? {},
    onInvalid: invalidRequest,
  });

/**
 * Validates query string parameters, then attaches `query`.
 *
 * Missing `queryStringParameters` are treated as `{}`.
 *
 * @param schema - Any Standard Schema for the query object, such as a Zod schema.
 * @returns A step that responds `400` when validation fails.
 */
export const withQueryValidation = <S extends StandardSchema>(schema: S) =>
  validate({
    key: "query",
    schema,
    read: (ctx: RouteContext) => ctx.event.queryStringParameters ?? {},
    onInvalid: invalidRequest,
  });

/**
 * Composes middleware around a route body.
 *
 * Pass the method and path first (`'GET', '/teams/:teamId/members/:memberUserId'`).
 * `:name` becomes a string field on the handler context. `*name` captures the
 * remainder of the path, including slashes, and must be last. Omit the method
 * and path only for a pipeline that is not dispatched. List the error step
 * first so it wraps the rest.
 *
 * @returns An {@link HttpRoute} when a method and path are given, otherwise
 * a function of the event alone.
 */
export function route<
  const Method extends HttpMethod,
  const Path extends `/${string}`,
  const Steps extends readonly AnyStep[],
>(
  method: Method,
  path: Path,
  ...args: [...steps: Steps, handler: RouteHandler<PathContext<Path>, Steps>]
): HttpRoute;
export function route<const Steps extends readonly AnyStep[]>(
  ...args: [...steps: Steps, handler: RouteHandler<RouteContext, Steps>]
): (event: APIGatewayProxyEventV2) => HttpResult;

export function route(
  ...args: readonly unknown[]
): (event: APIGatewayProxyEventV2) => HttpResult {
  const headed =
    isHttpMethod(args[0]) && typeof args[1] === "string" && args[1].startsWith("/");
  const parts = headed ? args.slice(2) : args;
  const run = compose<RouteContext, APIGatewayProxyStructuredResultV2>(
    parts.slice(0, -1) as AnyStep[],
    parts[parts.length - 1] as (ctx: RouteContext) => HttpResult,
  );
  if (!headed) {
    return (event) => run({ event });
  }

  const method = args[0] as HttpMethod;
  const path = args[1] as string;
  const pattern = compilePath(path);
  const handle = (event: APIGatewayProxyEventV2): HttpResult => {
    const ctx = { event } as RouteContext & Record<string, string>;
    const params = paramsFromEvent(pattern, event);
    if (params !== undefined) Object.assign(ctx, params);
    return run(ctx);
  };
  const httpRoute: HttpRoute = Object.assign(handle, { method, path });
  patterns.set(httpRoute, pattern);
  return httpRoute;
}

/**
 * Runs the route that matches the request method and path.
 *
 * A route with more literal segments wins. A fixed-length route beats a splat
 * with the same literals. An equal score keeps the earlier route. Anything else
 * is `404`.
 *
 * @param routes - The area's routes.
 * @param event - The HTTP API event.
 * @returns The matched route's response, or `404`.
 */
export const dispatch = (
  routes: readonly HttpRoute[],
  event: APIGatewayProxyEventV2,
): HttpResult => {
  const method = event.requestContext.http.method;
  const parts = requestParts(event);
  let best: HttpRoute | undefined;
  let bestScore = -1;
  for (const candidate of routes) {
    if (candidate.method !== method) continue;
    const pattern = patterns.get(candidate);
    if (pattern === undefined) continue;
    const matched = matchPattern(pattern, parts);
    if (matched === undefined || matched.score <= bestScore) continue;
    best = candidate;
    bestScore = matched.score;
  }
  if (best === undefined) return Promise.resolve(notFound());
  return best(event);
};

/**
 * Serves health checks, then dispatches the area's routes.
 *
 * `GET /health` and `GET /{area}/health` are answered before the route list.
 * Other requests go to {@link dispatch}. Failures at `4xx` and `5xx` are logged.
 *
 * @param area - The area name echoed by the health check.
 * @param routes - The area's routes.
 * @returns The Lambda HTTP handler.
 */
export const serveHttp = (area: string, routes: readonly HttpRoute[]) =>
  logHttpFailure(async (event) => {
    const path = event.rawPath ?? "";
    const method = event.requestContext.http.method;
    if (method === "GET" && (path === "/health" || path.endsWith("/health"))) {
      return handleHealth(event, area);
    }
    return dispatch(routes, event);
  });
