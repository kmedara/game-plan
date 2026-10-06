/**
 * HTTP route pipeline.
 *
 * Handlers list steps instead of nesting wrappers. The first step is the outer
 * one, so error mapping belongs first and catches throws from later steps.
 * Each step may attach fields to the context the final handler receives.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import type { z } from 'zod';
import {
  badRequest,
  type ErrorMappingFn,
  json,
  parseJsonBody,
} from './http.js';

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
 * A pipeline step.
 *
 * `Req` must already be on the context. `Out` is attached before `next`.
 */
export type Step<Req extends object, Out extends object> = (
  ctx: RouteContext & Req,
  next: (ctx: RouteContext & Req & Out) => HttpResult,
) => HttpResult;

/**
 * Types a step function with the context it requires and produces.
 *
 * @param run - The step body.
 * @returns The same function.
 */
export const asStep = <Req extends object, Out extends object>(
  run: Step<Req, Out>,
): Step<Req, Out> => run;

/** Proves `Base` already has every field `Req` demands. */
type Ready<Base, Req extends object> = Base extends Req ? unknown : never;

type PathContext<Names extends readonly string[]> = RouteContext &
  Record<Names[number], string>;

type ParamArgs<Names extends readonly string[]> = Names extends readonly []
  ? []
  : Names extends readonly [infer _Head, ...infer Rest]
    ? Rest extends readonly string[]
      ? [string, ...ParamArgs<Rest>]
      : [string]
    : string[];

type RouteFn<Names extends readonly string[]> = (
  event: APIGatewayProxyEventV2,
  ...args: ParamArgs<Names>
) => HttpResult;

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
 * Logs a caught route error in the shared HTTP shape.
 *
 * @param error - The thrown value.
 */
export const logCaughtError = (error: unknown): void => {
  console.error(
    JSON.stringify({
      service: 'http',
      event: 'error',
      error: JSON.stringify(error),
    }),
  );
};

/**
 * Formats Zod issues as a stable `{ errors }` payload for `400` responses.
 *
 * @param issues - The Zod issue list from a failed `safeParse`.
 * @returns A JSON-serializable validation error body.
 */
const zodErrorBody = (issues: z.ZodIssue[]) => ({
  errors: issues.map((issue) => ({
    field: issue.path.join('.'),
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
  asStep<object, object>(async (ctx, next) => {
    try {
      return await next(ctx);
    } catch (error) {
      options.onError?.(error);
      const mapped = mapError(error);
      if (mapped !== undefined) return mapped;
      options.onUnmapped?.(error);
      return options.fallback?.(error) ?? json(500, { error: 'internal_error' });
    }
  });

/**
 * Parses and validates the JSON body, then attaches `body`.
 *
 * Empty bodies are treated as `{}` so optional-body schemas can still pass.
 *
 * @param schema - The Zod schema for the request body.
 * @returns A step that responds `400` when validation fails.
 */
export const withBodyValidation = <S extends z.ZodTypeAny>(
  schema: S,
): Step<object, { body: z.output<S> }> =>
  asStep<object, { body: z.output<S> }>(async (ctx, next) => {
    const parsed = schema.safeParse(parseJsonBody(ctx.event) ?? {});
    if (!parsed.success) return badRequest(zodErrorBody(parsed.error.issues));
    return next({ ...ctx, body: parsed.data });
  });

/**
 * Validates query string parameters, then attaches `query`.
 *
 * Missing `queryStringParameters` are treated as `{}`.
 *
 * @param schema - The Zod schema for the query object.
 * @returns A step that responds `400` when validation fails.
 */
export const withQueryValidation = <S extends z.ZodTypeAny>(
  schema: S,
): Step<object, { query: z.output<S> }> =>
  asStep<object, { query: z.output<S> }>(async (ctx, next) => {
    const parsed = schema.safeParse(ctx.event.queryStringParameters ?? {});
    if (!parsed.success) return badRequest(zodErrorBody(parsed.error.issues));
    return next({ ...ctx, query: parsed.data });
  });

const isParamList = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string');

/**
 * Builds a handler from path-parameter names, steps, and a final function.
 *
 * @param names - Path parameter names, in dispatcher argument order.
 * @param steps - Middleware, outer step first.
 * @param handler - The route body. It sees the accumulated context.
 * @returns A function the area dispatcher can call with the HTTP event.
 */
const compose = (
  names: readonly string[],
  steps: ReadonlyArray<Step<object, object>>,
  handler: (ctx: RouteContext) => HttpResult,
): ((event: APIGatewayProxyEventV2, ...pathArgs: string[]) => HttpResult) => {
  const run = steps.reduceRight<(ctx: RouteContext) => HttpResult>(
    (next, step) => (ctx) => step(ctx, next),
    handler,
  );

  return (event, ...pathArgs) => {
    const ctx = { event } as RouteContext & Record<string, string>;
    names.forEach((name, index) => {
      ctx[name] = pathArgs[index] as string;
    });
    return run(ctx);
  };
};

/**
 * Composes middleware around a route body.
 *
 * Pass path parameter names first when the dispatcher supplies them after the
 * event (`['teamId']`, `['teamId', 'requestId']`). Omit that array when the
 * route has no path parameters. List the error step first so it wraps the rest.
 *
 * @returns The HTTP handler `(event, ...pathParams)`.
 */
export function route<AReq extends object, AOut extends object>(
  a: Step<AReq, AOut> & Ready<RouteContext, AReq>,
  handler: (ctx: RouteContext & AOut) => HttpResult,
): (event: APIGatewayProxyEventV2) => HttpResult;

export function route<
  AReq extends object,
  AOut extends object,
  BReq extends object,
  BOut extends object,
>(
  a: Step<AReq, AOut> & Ready<RouteContext, AReq>,
  b: Step<BReq, BOut> & Ready<RouteContext & AOut, BReq>,
  handler: (ctx: RouteContext & AOut & BOut) => HttpResult,
): (event: APIGatewayProxyEventV2) => HttpResult;

export function route<
  AReq extends object,
  AOut extends object,
  BReq extends object,
  BOut extends object,
  CReq extends object,
  COut extends object,
>(
  a: Step<AReq, AOut> & Ready<RouteContext, AReq>,
  b: Step<BReq, BOut> & Ready<RouteContext & AOut, BReq>,
  c: Step<CReq, COut> & Ready<RouteContext & AOut & BOut, CReq>,
  handler: (ctx: RouteContext & AOut & BOut & COut) => HttpResult,
): (event: APIGatewayProxyEventV2) => HttpResult;

export function route<
  AReq extends object,
  AOut extends object,
  BReq extends object,
  BOut extends object,
  CReq extends object,
  COut extends object,
  DReq extends object,
  DOut extends object,
>(
  a: Step<AReq, AOut> & Ready<RouteContext, AReq>,
  b: Step<BReq, BOut> & Ready<RouteContext & AOut, BReq>,
  c: Step<CReq, COut> & Ready<RouteContext & AOut & BOut, CReq>,
  d: Step<DReq, DOut> & Ready<RouteContext & AOut & BOut & COut, DReq>,
  handler: (ctx: RouteContext & AOut & BOut & COut & DOut) => HttpResult,
): (event: APIGatewayProxyEventV2) => HttpResult;

export function route<
  AReq extends object,
  AOut extends object,
  BReq extends object,
  BOut extends object,
  CReq extends object,
  COut extends object,
  DReq extends object,
  DOut extends object,
  EReq extends object,
  EOut extends object,
>(
  a: Step<AReq, AOut> & Ready<RouteContext, AReq>,
  b: Step<BReq, BOut> & Ready<RouteContext & AOut, BReq>,
  c: Step<CReq, COut> & Ready<RouteContext & AOut & BOut, CReq>,
  d: Step<DReq, DOut> & Ready<RouteContext & AOut & BOut & COut, DReq>,
  e: Step<EReq, EOut> & Ready<RouteContext & AOut & BOut & COut & DOut, EReq>,
  handler: (ctx: RouteContext & AOut & BOut & COut & DOut & EOut) => HttpResult,
): (event: APIGatewayProxyEventV2) => HttpResult;

export function route<
  const Names extends readonly string[],
  AReq extends object,
  AOut extends object,
>(
  params: Names,
  a: Step<AReq, AOut> & Ready<PathContext<Names>, AReq>,
  handler: (ctx: PathContext<Names> & AOut) => HttpResult,
): RouteFn<Names>;

export function route<
  const Names extends readonly string[],
  AReq extends object,
  AOut extends object,
  BReq extends object,
  BOut extends object,
>(
  params: Names,
  a: Step<AReq, AOut> & Ready<PathContext<Names>, AReq>,
  b: Step<BReq, BOut> & Ready<PathContext<Names> & AOut, BReq>,
  handler: (ctx: PathContext<Names> & AOut & BOut) => HttpResult,
): RouteFn<Names>;

export function route<
  const Names extends readonly string[],
  AReq extends object,
  AOut extends object,
  BReq extends object,
  BOut extends object,
  CReq extends object,
  COut extends object,
>(
  params: Names,
  a: Step<AReq, AOut> & Ready<PathContext<Names>, AReq>,
  b: Step<BReq, BOut> & Ready<PathContext<Names> & AOut, BReq>,
  c: Step<CReq, COut> & Ready<PathContext<Names> & AOut & BOut, CReq>,
  handler: (ctx: PathContext<Names> & AOut & BOut & COut) => HttpResult,
): RouteFn<Names>;

export function route<
  const Names extends readonly string[],
  AReq extends object,
  AOut extends object,
  BReq extends object,
  BOut extends object,
  CReq extends object,
  COut extends object,
  DReq extends object,
  DOut extends object,
>(
  params: Names,
  a: Step<AReq, AOut> & Ready<PathContext<Names>, AReq>,
  b: Step<BReq, BOut> & Ready<PathContext<Names> & AOut, BReq>,
  c: Step<CReq, COut> & Ready<PathContext<Names> & AOut & BOut, CReq>,
  d: Step<DReq, DOut> & Ready<PathContext<Names> & AOut & BOut & COut, DReq>,
  handler: (ctx: PathContext<Names> & AOut & BOut & COut & DOut) => HttpResult,
): RouteFn<Names>;

export function route<
  const Names extends readonly string[],
  AReq extends object,
  AOut extends object,
  BReq extends object,
  BOut extends object,
  CReq extends object,
  COut extends object,
  DReq extends object,
  DOut extends object,
  EReq extends object,
  EOut extends object,
>(
  params: Names,
  a: Step<AReq, AOut> & Ready<PathContext<Names>, AReq>,
  b: Step<BReq, BOut> & Ready<PathContext<Names> & AOut, BReq>,
  c: Step<CReq, COut> & Ready<PathContext<Names> & AOut & BOut, CReq>,
  d: Step<DReq, DOut> & Ready<PathContext<Names> & AOut & BOut & COut, DReq>,
  e: Step<EReq, EOut> & Ready<PathContext<Names> & AOut & BOut & COut & DOut, EReq>,
  handler: (ctx: PathContext<Names> & AOut & BOut & COut & DOut & EOut) => HttpResult,
): RouteFn<Names>;

export function route(
  ...args: readonly unknown[]
): (event: APIGatewayProxyEventV2, ...pathArgs: string[]) => HttpResult {
  const first = args[0];
  const names = isParamList(first) ? first : [];
  const parts = isParamList(first) ? args.slice(1) : args;
  const handler = parts[parts.length - 1] as (ctx: RouteContext) => HttpResult;
  const steps = parts.slice(0, -1) as Step<object, object>[];
  return compose(names, steps, handler);
}
