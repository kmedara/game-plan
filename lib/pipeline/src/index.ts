/**
 * Typed middleware pipelines.
 *
 * A pipeline is a list of steps followed by a handler. The first step is the
 * outer one. Each step may attach fields to the context before calling `next`,
 * and the handler receives every field attached along the way. Steps that need
 * a field no earlier step provides are rejected at compile time.
 *
 * Nothing here knows about HTTP. The context and result types are chosen by
 * the caller, so the same steps work for API Gateway, Express, queues, or CLIs.
 */

/**
 * A pipeline step.
 *
 * `Req` must already be on the context. `Out` is attached before `next`.
 * `Res` is the result every step and the handler resolve to.
 * The optional `__step` field exists only so TypeScript can infer `Req` and
 * `Out`. Those parameters otherwise appear only in contravariant positions,
 * and inference falls back to `object`.
 */
export type Step<Req extends object, Out extends object, Res> = ((
  ctx: Req,
  next: (ctx: Req & Out) => Promise<Res>,
) => Promise<Res>) & {
  readonly __step?: { req: Req; out: Out };
};

/** Any step, before inference narrows `Req`, `Out`, and `Res`. */
export type AnyStep = Step<any, any, any>;

/**
 * Types a step function with the context it requires and produces.
 *
 * @param run - The step body.
 * @returns The same function.
 */
export const asStep = <Req extends object, Out extends object, Res>(
  run: Step<Req, Out, Res>,
): Step<Req, Out, Res> => run;

type ReqOf<S> = S extends Step<infer Req, any, any> ? Req : never;
type OutOf<S> = S extends Step<any, infer Out, any> ? Out : never;

/** The context after every step in `Steps` has attached its fields. */
export type Accumulate<Ctx, Steps extends readonly unknown[]> = Steps extends readonly [
  infer Head,
  ...infer Rest,
]
  ? Accumulate<Ctx & OutOf<Head>, Rest>
  : Ctx;

/**
 * `true` when each step's requirements are met by the context built so far.
 * Otherwise describes the first step that is out of order.
 */
export type StepsReady<Ctx, Steps extends readonly unknown[]> = Steps extends readonly [
  infer Head,
  ...infer Rest,
]
  ? Ctx extends ReqOf<Head>
    ? StepsReady<Ctx & OutOf<Head>, Rest>
    : { missing: Exclude<keyof ReqOf<Head>, keyof Ctx>; step: Head }
  : true;

/** The handler type, or the {@link StepsReady} failure when steps are misordered. */
export type Handler<Ctx, Steps extends readonly unknown[], Res> =
  StepsReady<Ctx, Steps> extends true
    ? (ctx: Accumulate<Ctx, Steps>) => Promise<Res>
    : StepsReady<Ctx, Steps>;

/**
 * Chains steps around a handler without compile-time checks.
 *
 * Adapters that build their own typed `route` signature call this at runtime.
 *
 * @param steps - Middleware, outer step first.
 * @param handler - The final function. It sees the accumulated context.
 * @returns A function that runs the chain for one context.
 */
export const compose = <Ctx extends object, Res>(
  steps: ReadonlyArray<AnyStep>,
  handler: (ctx: any) => Promise<Res>,
): ((ctx: Ctx) => Promise<Res>) =>
  steps.reduceRight<(ctx: any) => Promise<Res>>(
    (next, step) => (ctx) => step(ctx, next),
    handler,
  );

/**
 * Fixes the starting context and result type, then returns a typed builder.
 *
 * @returns `(...steps, handler) => (ctx) => Promise<Res>`.
 * @example
 * const pipe = pipeline<{ input: string }, number>();
 * const run = pipe(parseNumber, async ({ value }) => value * 2);
 * await run({ input: "21" }); // 42
 */
export const pipeline =
  <Ctx extends object, Res>() =>
  <const Steps extends readonly Step<any, any, Res>[]>(
    ...args: [...steps: Steps, handler: Handler<Ctx, Steps, Res>]
  ): ((ctx: Ctx) => Promise<Res>) =>
    compose<Ctx, Res>(
      args.slice(0, -1) as AnyStep[],
      args[args.length - 1] as (ctx: Ctx) => Promise<Res>,
    );

/**
 * Catches throws from later steps and turns them into a result.
 *
 * @param onError - Builds the result for a caught error. It also sees the context.
 * @returns A step that leaves the context unchanged.
 */
export const catchErrors = <Req extends object, Res>(
  onError: (error: unknown, ctx: Req) => Res | Promise<Res>,
): Step<Req, object, Res> =>
  asStep<Req, object, Res>(async (ctx, next) => {
    try {
      return await next(ctx);
    } catch (error) {
      return onError(error, ctx);
    }
  });

/** The subset of the Standard Schema v1 interface that validation needs. */
export type StandardSchema<Output = unknown> = {
  readonly "~standard": {
    readonly validate: (
      value: unknown,
    ) => StandardResult<Output> | Promise<StandardResult<Output>>;
    readonly types?: { readonly output: Output };
  };
};

/** One validation problem reported by a Standard Schema. */
export type StandardIssue = {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>;
};

type StandardResult<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: ReadonlyArray<StandardIssue> };

/** The validated output type of a Standard Schema. */
export type SchemaOutput<S> = S extends StandardSchema<infer Output> ? Output : never;

/** Options for {@link validate}. */
export type ValidateOptions<Key extends string, Req extends object, S, Res> = {
  /** Context field that receives the validated value. */
  key: Key;
  /** Any Standard Schema, such as Zod 3.24+, Valibot, or ArkType. */
  schema: S;
  /** Reads the raw value from the context. */
  read: (ctx: Req) => unknown;
  /** Builds the result when validation fails. Later steps do not run. */
  onInvalid: (issues: ReadonlyArray<StandardIssue>, ctx: Req) => Res | Promise<Res>;
};

/**
 * Validates a value read from the context, then attaches it under `key`.
 *
 * @param options - Field name, schema, reader, and failure response.
 * @returns A step that short-circuits with `onInvalid` when validation fails.
 */
export const validate = <
  const Key extends string,
  Req extends object,
  S extends StandardSchema,
  Res,
>(
  options: ValidateOptions<Key, Req, S, Res>,
): Step<Req, Record<Key, SchemaOutput<S>>, Res> =>
  asStep<Req, Record<Key, SchemaOutput<S>>, Res>(async (ctx, next) => {
    const result = await options.schema["~standard"].validate(options.read(ctx));
    if (result.issues !== undefined) return options.onInvalid(result.issues, ctx);
    return next({ ...ctx, [options.key]: result.value } as Req &
      Record<Key, SchemaOutput<S>>);
  });

/**
 * Joins a Standard Schema issue path with dots.
 *
 * @param issue - One validation issue.
 * @returns A path such as `address.city`, or an empty string at the root.
 */
export const issuePath = (issue: StandardIssue): string =>
  (issue.path ?? [])
    .map((segment) =>
      String(typeof segment === "object" && segment !== null ? segment.key : segment),
    )
    .join(".");
