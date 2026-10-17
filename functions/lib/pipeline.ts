/**
 * HTTP route pipeline for API Gateway HTTP APIs.
 *
 * Handlers list steps instead of nesting wrappers. The first step is the outer
 * one, so error mapping belongs first and catches throws from later steps.
 * Each step may attach fields to the context the final handler receives.
 *
 * The step machinery lives in `@gameplan/pipeline`. This module binds it to
 * API Gateway events and proxy results.
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
  json,
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

type PathContext<Names extends readonly string[]> = RouteContext &
  Record<Names[number], string>;

type RouteHandler<Ctx, Steps extends readonly unknown[]> = Handler<
  Ctx,
  Steps,
  APIGatewayProxyStructuredResultV2
>;

type RouteFn<Names extends readonly string[]> = (
  event: APIGatewayProxyEventV2,
  ...args: { [K in keyof Names]: string }
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

const isParamList = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

/**
 * Composes middleware around a route body.
 *
 * Pass path parameter names first when the dispatcher supplies them after the
 * event (`['teamId']`, `['teamId', 'requestId']`). Omit that array when the
 * route has no path parameters. List the error step first so it wraps the rest.
 *
 * @returns The HTTP handler `(event, ...pathParams)`.
 */
export function route<const Steps extends readonly AnyStep[]>(
  ...args: [...steps: Steps, handler: RouteHandler<RouteContext, Steps>]
): RouteFn<[]>;
export function route<
  const Names extends readonly string[],
  const Steps extends readonly AnyStep[],
>(
  ...args: [
    params: Names,
    ...steps: Steps,
    handler: RouteHandler<PathContext<Names>, Steps>,
  ]
): RouteFn<Names>;

export function route(
  ...args: readonly unknown[]
): (event: APIGatewayProxyEventV2, ...pathArgs: string[]) => HttpResult {
  const first = args[0];
  const names = isParamList(first) ? first : [];
  const parts = isParamList(first) ? args.slice(1) : args;
  const run = compose<RouteContext, APIGatewayProxyStructuredResultV2>(
    parts.slice(0, -1) as AnyStep[],
    parts[parts.length - 1] as (ctx: RouteContext) => HttpResult,
  );

  return (event, ...pathArgs) => {
    const ctx = { event } as RouteContext & Record<string, string>;
    names.forEach((name, index) => {
      ctx[name] = pathArgs[index] as string;
    });
    return run(ctx);
  };
}
